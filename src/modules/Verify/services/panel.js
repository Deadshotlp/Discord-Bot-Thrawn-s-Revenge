import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

export const VERIFY_ACCEPT_BUTTON_ID = "verify_accept_rules";

export const DEFAULT_VERIFY_RULES_TEXT = [
  "1) Sei respektvoll gegenüber allen Mitgliedern.",
  "2) Kein Spam, keine Werbung und keine beleidigenden Inhalte.",
  "3) Folge den Anweisungen des Teams."
].join("\n");

export function buildVerifyPanelPayload(rulesText = DEFAULT_VERIFY_RULES_TEXT) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Regeln und Verifizierung")
    .setDescription(
      [
        "Bitte lies die Regeln aufmerksam durch.",
        "Mit dem Button bestätigst du die Regeln und erhältst die Verify-Rolle.",
        "",
        rulesText || DEFAULT_VERIFY_RULES_TEXT
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
