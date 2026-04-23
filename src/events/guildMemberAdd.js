import { sendLog } from "../features/logging/logDispatcher.js";

export async function handleGuildMemberAdd(member) {
  if (member.user.bot) {
    return;
  }

  await sendLog(member.guild, `:inbox_tray: **Join** ${member.user.tag} (${member.id}) ist dem Server beigetreten.`, "member");
}
