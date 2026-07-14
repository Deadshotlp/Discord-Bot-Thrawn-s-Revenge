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

export function hasAnyRole(member, roleIds) {
  if (!member || !Array.isArray(roleIds) || roleIds.length === 0) {
    return false;
  }

  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}
