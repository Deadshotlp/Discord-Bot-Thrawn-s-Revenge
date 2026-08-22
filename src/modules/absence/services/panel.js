import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import { resolveTextAnnouncementChannel } from "../../../core/discordUtil.js";
import { normalizeAbsenceConfig } from "./config.js";
import { ABSENCE_KINDS } from "./store.js";
import { formatDate } from "./announce.js";

export const ABSENCE_PANEL_OPEN_BUTTON_ID = "absence_panel_open_button";
export const ABSENCE_PANEL_MINE_BUTTON_ID = "absence_panel_mine_button";
export const ABSENCE_PANEL_KIND_SELECT_ID = "absence_panel_kind_select";
export const ABSENCE_PANEL_WITHDRAW_SELECT_ID = "absence_panel_withdraw_select";
export const ABSENCE_PANEL_MODAL_PREFIX = "absence_panel_modal:";

export const ABSENCE_FROM_INPUT_ID = "absence_from";
export const ABSENCE_TO_INPUT_ID = "absence_to";
export const ABSENCE_REASON_INPUT_ID = "absence_reason";

const REASON_MAX_LENGTH = 300;

export function buildAbsencePanelPayload(config) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Abmeldung eintragen")
    .setDescription([
      "Trag hier ein, wenn du vorübergehend nicht verfügbar bist.",
      "",
      "**Abmelden** – Art wählen, danach Zeitraum im Formular angeben.",
      "**Meine Abmeldungen** – eigene Einträge ansehen und zurückziehen.",
      "",
      "Dein Bereich wird automatisch aus deinen Rollen übernommen."
    ].join("\n"))
    .setFooter({
      text: config?.requireApproval
        ? "Einträge werden von der Bereichsleitung freigegeben."
        : "Einträge gelten sofort."
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ABSENCE_PANEL_OPEN_BUTTON_ID)
      .setLabel("Abmelden")
      .setEmoji("🌴")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ABSENCE_PANEL_MINE_BUTTON_ID)
      .setLabel("Meine Abmeldungen")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export function buildKindSelectPayload() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ABSENCE_PANEL_KIND_SELECT_ID)
    .setPlaceholder("Art der Abwesenheit wählen")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(Object.values(ABSENCE_KINDS).map((kind) => ({
      label: kind.label.slice(0, 100),
      value: kind.id,
      emoji: kind.emoji
    })));

  return {
    content: "Worum geht es?",
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

export function buildAbsenceModal(kindId) {
  const kind = ABSENCE_KINDS[kindId];

  const modal = new ModalBuilder()
    .setCustomId(`${ABSENCE_PANEL_MODAL_PREFIX}${kindId}`)
    .setTitle(`Abmeldung: ${kind?.label || kindId}`.slice(0, 45));

  const from = new TextInputBuilder()
    .setCustomId(ABSENCE_FROM_INPUT_ID)
    .setLabel("Von")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10)
    .setPlaceholder("z. B. 24.12.2026");

  const to = new TextInputBuilder()
    .setCustomId(ABSENCE_TO_INPUT_ID)
    .setLabel("Bis (leer = gleicher Tag)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10)
    .setPlaceholder("z. B. 02.01.2027");

  const reason = new TextInputBuilder()
    .setCustomId(ABSENCE_REASON_INPUT_ID)
    .setLabel("Hinweis für das Team (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(REASON_MAX_LENGTH);

  modal.addComponents(
    new ActionRowBuilder().addComponents(from),
    new ActionRowBuilder().addComponents(to),
    new ActionRowBuilder().addComponents(reason)
  );

  return modal;
}

export function buildOwnAbsencesPayload(absences) {
  if (absences.length === 0) {
    return { content: "Du hast keine offenen Abmeldungen.", components: [] };
  }

  const lines = absences.map((absence) => {
    const kind = ABSENCE_KINDS[absence.kind];
    const status = absence.status === "pending" ? " · wartet auf Freigabe" : "";
    return `${kind?.emoji || "🚫"} **${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}**`
      + ` · ${kind?.label || absence.kind}${status}`;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(ABSENCE_PANEL_WITHDRAW_SELECT_ID)
    .setPlaceholder("Eintrag zurückziehen")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(absences.slice(0, 25).map((absence) => ({
      label: `${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}`.slice(0, 100),
      value: absence.id,
      description: (ABSENCE_KINDS[absence.kind]?.label || absence.kind).slice(0, 100)
    })));

  return {
    content: lines.join("\n"),
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

/**
 * Stellt das Panel im konfigurierten Channel bereit. Anders als die Übersicht
 * enthält es keine Daten, es muss also nur bei Konfigurationsänderungen neu
 * geschrieben werden.
 */
export async function refreshAbsencePanel(client, guildId) {
  const { settingsStore, logger } = client.botContext;
  const config = normalizeAbsenceConfig(settingsStore.getModuleState(guildId, "absence")?.config);

  if (!config.panelChannelId) {
    return null;
  }

  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  const channel = await resolveTextAnnouncementChannel(guild, config.panelChannelId);
  if (!channel) {
    logger.warn("Abmelde-Panel: Channel nicht erreichbar", { guildId, channelId: config.panelChannelId });
    return null;
  }

  const payload = buildAbsencePanelPayload(config);

  try {
    if (config.panelMessageId) {
      const existing = await channel.messages.fetch(config.panelMessageId).catch(() => null);
      if (existing) {
        return await existing.edit(payload);
      }
    }

    const message = await channel.send(payload);
    settingsStore.setModuleConfig(guildId, "absence", { panelMessageId: message.id });
    return message;
  } catch (error) {
    logger.warn("Abmelde-Panel konnte nicht gesetzt werden", { guildId, error: String(error) });
    return null;
  }
}
