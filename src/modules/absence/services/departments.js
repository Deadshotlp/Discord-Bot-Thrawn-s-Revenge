import { normalizeDepartments } from "../../support/services/config.js";

// Departments werden zentral im Support-Modul gepflegt, damit Tickets,
// Wochenberichte und Abmeldungen dieselbe Struktur nutzen.
export function getDepartments(client, guildId) {
  const moduleState = client.botContext.settingsStore.getModuleState(guildId, "support");
  return normalizeDepartments(moduleState?.config?.departments);
}

export function getDepartmentName(departments, departmentId) {
  if (!departmentId) {
    return "Allgemein";
  }

  return departments.find((department) => department.id === departmentId)?.name || departmentId;
}

// Departments, in denen ein Mitglied über seine Rollen Mitglied ist.
export function getMemberDepartments(member, departments) {
  if (!member) {
    return [];
  }

  return departments.filter((department) => {
    const roleIds = Array.isArray(department.roleIds) ? department.roleIds : [];
    return roleIds.length > 0 && roleIds.some((roleId) => member.roles.cache.has(roleId));
  });
}

export function isDepartmentLeadOf(member, departments, departmentId) {
  const department = departments.find((entry) => entry.id === departmentId);
  if (!department || !member) {
    return false;
  }

  const leadRoleIds = Array.isArray(department.leadRoleIds) ? department.leadRoleIds : [];
  return leadRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
