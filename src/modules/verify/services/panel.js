import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

export const VERIFY_ACCEPT_BUTTON_ID = "verify_accept_rules";
export const VERIFY_RULES_TEXT_MAX_LENGTH = 3500;
const EMBED_DESCRIPTION_MAX_LENGTH = 4096;

export const DEFAULT_VERIFY_RULES_TEXT = [
  "1) Sei respektvoll gegenüber allen Mitgliedern.",
  "2) Kein Spam, keine Werbung und keine beleidigenden Inhalte.",
  "3) Folge den Anweisungen des Teams."
].join("\n");

function normalizeRulesText(input) {
  const raw = String(input || DEFAULT_VERIFY_RULES_TEXT).trim() || DEFAULT_VERIFY_RULES_TEXT;
  if (raw.length <= VERIFY_RULES_TEXT_MAX_LENGTH) {
    return raw;
  }

  return raw.slice(0, VERIFY_RULES_TEXT_MAX_LENGTH);
}

export function buildVerifyPanelPayload(rulesText = DEFAULT_VERIFY_RULES_TEXT) {
  const introLines = [
    "Bitte lies die Regeln aufmerksam durch.",
    "Mit dem Button bestätigst du die Regeln und erhältst die Verify-Rolle.",
    ""
  ];
  const introText = introLines.join("\n");
  const safeMaxRulesLength = Math.max(
    1,
    Math.min(
      VERIFY_RULES_TEXT_MAX_LENGTH,
      EMBED_DESCRIPTION_MAX_LENGTH - introText.length
    )
  );
  const normalizedRules = normalizeRulesText(rulesText).slice(0, safeMaxRulesLength);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Regeln und Verifizierung")
    .setDescription(
      [
        ...introLines,
        normalizedRules
      ].join("\n")
    )
    .setFooter({ text: "Nur einmal klicken. Bei Problemen beim Team melden." });

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_ACCEPT_BUTTON_ID)
      .setLabel("Regeln akzeptieren und verifizieren")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [buttonRow]
  };
}

export async function upsertVerifyPanel(channel, existingMessageId = "", rulesText = DEFAULT_VERIFY_RULES_TEXT) {
  const payload = buildVerifyPanelPayload(rulesText);

  if (existingMessageId) {
    const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  }

  return channel.send(payload);
}

export async function postVerifyPanel(channel, rulesText = DEFAULT_VERIFY_RULES_TEXT) {
  return upsertVerifyPanel(channel, "", rulesText);
}
