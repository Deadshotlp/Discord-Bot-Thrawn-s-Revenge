import { EmbedBuilder } from "discord.js";

export async function postSetupPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle("Bot-Setup (Modulare Basis)")
    .setDescription(
      [
        "Dieser Bot wurde auf eine modulare Basisstruktur zurückgesetzt.",
        "Du kannst ab jetzt Features als eigene Module ergänzen.",
        "Nutze /setup-panel, um dieses Panel jederzeit erneut zu posten."
      ].join("\n")
    )
    .addFields(
      {
        name: "Aktive Basis",
        value: "System-Modul, Setup-Modul"
      },
      {
        name: "Nächster Schritt",
        value: "Neue Module unter src/modules/<name> hinzufügen."
      }
    );

  await channel.send({ embeds: [embed] });
}
