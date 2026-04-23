import { PermissionFlagsBits } from "discord.js";

export function canManageServer(member) {
  if (!member) {
    return false;
  }

  return (
    member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}
