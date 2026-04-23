import crypto from "node:crypto";

function safeParseJson(raw) {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDepartmentName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sanitizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) {
    return [];
  }

  return [...new Set(roleIds.filter((id) => typeof id === "string" && id.length > 0))];
}

function normalizeDepartmentEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = String(entry.name || "").trim();
  if (!name) {
    return null;
  }

  const id = String(entry.id || "").trim() || crypto.randomUUID();

  return {
    id,
    name,
    roleIds: sanitizeRoleIds(entry.roleIds)
  };
}

function saveDepartments(guildSettingsRepository, guildId, departments) {
  const normalized = departments
    .map((department) => normalizeDepartmentEntry(department))
    .filter(Boolean);

  guildSettingsRepository.setField(guildId, "departments_json", JSON.stringify(normalized));

  return normalized;
}

function findDepartmentIndex(departments, query) {
  const normalizedQuery = normalizeDepartmentName(query);

  return departments.findIndex((department) => {
    if (department.id === query) {
      return true;
    }

    return normalizeDepartmentName(department.name) === normalizedQuery;
  });
}

export function getDepartmentsFromSettings(settings) {
  return safeParseJson(settings?.departments_json)
    .map((entry) => normalizeDepartmentEntry(entry))
    .filter(Boolean);
}

export function getDepartmentById(settings, departmentId) {
  return getDepartmentsFromSettings(settings).find((department) => department.id === departmentId) || null;
}

export function getAllDepartmentRoleIds(settings) {
  const allRoles = getDepartmentsFromSettings(settings).flatMap((department) => department.roleIds || []);
  return [...new Set(allRoles)];
}

export function createDepartment(guildSettingsRepository, guildId, settings, name) {
  const departmentName = String(name || "").trim();
  if (departmentName.length < 2) {
    throw new Error("Department-Name ist zu kurz.");
  }

  const departments = getDepartmentsFromSettings(settings);
  const normalizedTarget = normalizeDepartmentName(departmentName);

  const exists = departments.some(
    (department) => normalizeDepartmentName(department.name) === normalizedTarget
  );

  if (exists) {
    throw new Error("Department existiert bereits.");
  }

  departments.push({
    id: crypto.randomUUID(),
    name: departmentName,
    roleIds: []
  });

  return saveDepartments(guildSettingsRepository, guildId, departments);
}

export function deleteDepartment(guildSettingsRepository, guildId, settings, query) {
  const departments = getDepartmentsFromSettings(settings);
  const index = findDepartmentIndex(departments, query);

  if (index === -1) {
    throw new Error("Department wurde nicht gefunden.");
  }

  departments.splice(index, 1);
  return saveDepartments(guildSettingsRepository, guildId, departments);
}

export function addRoleToDepartment(guildSettingsRepository, guildId, settings, query, roleId) {
  const departments = getDepartmentsFromSettings(settings);
  const index = findDepartmentIndex(departments, query);

  if (index === -1) {
    throw new Error("Department wurde nicht gefunden.");
  }

  const nextRoles = new Set(departments[index].roleIds || []);
  nextRoles.add(roleId);
  departments[index].roleIds = [...nextRoles];

  return saveDepartments(guildSettingsRepository, guildId, departments);
}

export function removeRoleFromDepartment(guildSettingsRepository, guildId, settings, query, roleId) {
  const departments = getDepartmentsFromSettings(settings);
  const index = findDepartmentIndex(departments, query);

  if (index === -1) {
    throw new Error("Department wurde nicht gefunden.");
  }

  departments[index].roleIds = (departments[index].roleIds || []).filter((id) => id !== roleId);

  return saveDepartments(guildSettingsRepository, guildId, departments);
}

export function formatDepartmentList(departments) {
  if (!departments || departments.length === 0) {
    return "Keine Departments konfiguriert.";
  }

  return departments
    .map((department) => {
      const roleMentions = (department.roleIds || []).map((id) => `<@&${id}>`).join(" ");
      const rolesText = roleMentions || "(keine Rollen)";
      return `- ${department.name} [${department.id}] -> ${rolesText}`;
    })
    .join("\n");
}
