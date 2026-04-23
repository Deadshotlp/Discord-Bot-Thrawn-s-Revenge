import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder
} from "discord.js";

function createInfoEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(0x003366)
    .setTitle("Bot-Setup")
    .setDescription(
      [
        `Dieses Setup konfiguriert den Bot fuer **${guildName}**.`,
        "Waehle unten die Kanaele und Rollen aus.",
        "Aenderungen werden erst mit dem Button \"Konfiguration anwenden\" aktiv umgesetzt.",
        "Nur Admins oder Mitglieder mit Server-verwalten duerfen diese Werte aendern."
      ].join("\n")
    );
}

function createChannelEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle("1) Kanal-Konfiguration")
    .setDescription("Definiere Welcome, Log-Kategorie, Ticket-Panel und Support-Warteraum. Log-Kanaele werden automatisch erstellt.");
}

function createRoleEmbed() {
  return new EmbedBuilder()
    .setColor(0xb45f06)
    .setTitle("2) Rollen-Konfiguration")
    .setDescription("Definiere Verifiziert-Rolle und Standard-Teamrolle (fuer Ticket schliessen/eskalieren). Departments verwaltest du manuell mit /department.");
}

function createChannelRows() {
  const adminCategoryRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup_channel_admin_category")
      .setPlaceholder("Log-Kategorie auswaehlen (erstellt Log- und Ping-Kanaele)")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const welcomeRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup_channel_welcome")
      .setPlaceholder("Willkommens-Channel auswaehlen")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const ticketPanelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup_channel_ticket_panel")
      .setPlaceholder("Ticket-Panel-Channel auswaehlen")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const supportWaitingRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup_channel_support_waiting")
      .setPlaceholder("Support-Warteraum (Voice) auswaehlen")
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
      .setMinValues(1)
      .setMaxValues(1)
  );

  return [adminCategoryRow, welcomeRow, ticketPanelRow, supportWaitingRow];
}

function createRoleRows() {
  const verifiedRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup_role_verified")
      .setPlaceholder("Verifiziert-Rolle auswaehlen")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const standardTeamRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup_role_team_standard")
      .setPlaceholder("Standard-Teamrolle auswaehlen (Ticket schliessen/eskalieren)")
      .setMinValues(1)
      .setMaxValues(1)
  );

  return [verifiedRow, standardTeamRow];
}

function createSummaryButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("setup_apply_configuration")
      .setLabel("Konfiguration anwenden")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("setup_show_summary")
      .setLabel("Aktuelle Konfiguration anzeigen")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function postSetupPanels(channel) {
  const guildName = channel.guild?.name || "Server";

  await channel.send({
    embeds: [createInfoEmbed(guildName)]
  });

  await channel.send({
    embeds: [createChannelEmbed()],
    components: createChannelRows()
  });

  await channel.send({
    embeds: [createRoleEmbed()],
    components: createRoleRows()
  });

  await channel.send({
    content: "Speichere die Auswahl, verwalte Departments mit /department und klicke danach auf Konfiguration anwenden.",
    components: [createSummaryButtonRow()]
  });
}
