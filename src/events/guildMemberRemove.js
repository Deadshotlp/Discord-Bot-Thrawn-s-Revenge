import { sendLog } from "../features/logging/logDispatcher.js";

export async function handleGuildMemberRemove(member) {
  if (member.user?.bot) {
    return;
  }

  const userTag = member.user?.tag || "Unbekannt";
  await sendLog(member.guild, `:outbox_tray: **Leave** ${userTag} (${member.id}) hat den Server verlassen.`, "member");
}
