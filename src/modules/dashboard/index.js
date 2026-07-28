import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../core/permissions.js";

const dashboardCommand = {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Link zum Web-Dashboard (dort wird der Bot konfiguriert)")
    .setDMPermission(false),

  alwaysAvailable: true,

  async execute({ client, interaction }) {
    const { env } = client.botContext;
    const guildUrl = `${env.webBaseUrl}/#/g/${interaction.guildId}`;

    const embed = new EmbedBuilder()
      .setTitle("🛠️ Bot-Dashboard")
      .setColor(0x5865f2)
      .setDescription([
        "Die komplette Konfiguration läuft über das Web-Dashboard:",
        "Module, Departments, Server-Monitoring, Tickets, Meetings, Abmeldungen und Statistiken.",
        "",
        "Die Anmeldung erfolgt mit deinem Discord-Account – du siehst genau das,",
        "wofür deine Rollen dich berechtigen."
      ].join("\n"))
      .setFooter({ text: env.webBaseUrl.replace(/^https?:\/\//, "") });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Dashboard öffnen")
        .setURL(guildUrl)
    );

    await interaction.reply({
      embeds: [embed],
      components: /^https?:\/\//.test(guildUrl) ? [row] : [],
      flags: canManageServer(interaction.member) ? undefined : MessageFlags.Ephemeral
    });
  }
};

export const dashboardModule = {
  name: "dashboard",
  label: "Dashboard-Zugang",
  description: "Stellt den Link zum Web-Dashboard bereit. Ersetzt das frühere Setup-Panel in Discord.",
  defaultEnabled: true,
  defaultConfig: {},
  commands: [dashboardCommand],
  events: {}
};
