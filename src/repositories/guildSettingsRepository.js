const ALLOWED_SETTING_FIELDS = new Set([
  "setup_channel_id",
  "admin_category_id",
  "welcome_channel_id",
  "rules_channel_id",
  "rules_message_id",
  "rules_text",
  "log_channel_id",
  "log_member_channel_id",
  "log_message_channel_id",
  "log_voice_channel_id",
  "bot_ping_channel_id",
  "ticket_panel_channel_id",
  "ticket_panel_message_id",
  "support_waiting_voice_channel_id",
  "verified_role_id",
  "standard_team_role_id",
  "ticket_counter",
  "departments_json",
  "team_mod_role_id",
  "team_dev_role_id",
  "team_event_role_id",
  "team_media_role_id"
]);

export class GuildSettingsRepository {
  constructor(db) {
    this.db = db;
    this.ensureGuildStmt = db.prepare(`
      INSERT INTO guild_settings (guild_id)
      VALUES (?)
      ON CONFLICT(guild_id) DO NOTHING
    `);
    this.getByGuildIdStmt = db.prepare(`
      SELECT *
      FROM guild_settings
      WHERE guild_id = ?
    `);
    this.incrementTicketCounterStmt = db.prepare(`
      UPDATE guild_settings
      SET ticket_counter = COALESCE(ticket_counter, 0) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ?
    `);
    this.getTicketCounterStmt = db.prepare(`
      SELECT ticket_counter
      FROM guild_settings
      WHERE guild_id = ?
    `);
  }

  ensureGuild(guildId) {
    this.ensureGuildStmt.run(guildId);
  }

  getByGuildId(guildId) {
    return this.getByGuildIdStmt.get(guildId) || null;
  }

  setField(guildId, field, value) {
    if (!ALLOWED_SETTING_FIELDS.has(field)) {
      throw new Error(`Ungueltiges Konfigurationsfeld: ${field}`);
    }

    this.ensureGuild(guildId);

    const stmt = this.db.prepare(`
      UPDATE guild_settings
      SET ${field} = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ?
    `);

    stmt.run(value, guildId);

    return this.getByGuildId(guildId);
  }

  setFields(guildId, fields) {
    this.ensureGuild(guildId);

    for (const [field, value] of Object.entries(fields)) {
      if (!ALLOWED_SETTING_FIELDS.has(field)) {
        throw new Error(`Ungueltiges Konfigurationsfeld: ${field}`);
      }

      const stmt = this.db.prepare(`
        UPDATE guild_settings
        SET ${field} = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ?
      `);

      stmt.run(value, guildId);
    }

    return this.getByGuildId(guildId);
  }

  getNextTicketNumber(guildId) {
    this.ensureGuild(guildId);
    this.incrementTicketCounterStmt.run(guildId);
    const row = this.getTicketCounterStmt.get(guildId);
    return Number(row?.ticket_counter || 1);
  }
}
