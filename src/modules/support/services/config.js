export const SUPPORT_DEFAULT_DEPARTMENT_ID = "default";

function safeString(value) {
  return String(value || "").trim();
}

export function extractRoleIds(raw) {
  const text = safeString(raw);
  if (!text) {
    return [];
  }

  const matches = text.match(/\d{16,20}/g) || [];
  return [...new Set(matches)];
}

function slugifyDepartmentName(name) {
  const slug = safeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return slug || "department";
}

export function normalizeDepartment(rawDepartment) {
  if (!rawDepartment || typeof rawDepartment !== "object") {
    return null;
  }

  const name = safeString(rawDepartment.name);
  const id = safeString(rawDepartment.id) || slugifyDepartmentName(name);
  if (!name || !id) {
    return null;
  }

  const roleIds = Array.isArray(rawDepartment.roleIds)
    ? rawDepartment.roleIds.map((roleId) => safeString(roleId)).filter(Boolean)
    : [];

  return {
    id,
    name,
    roleIds: [...new Set(roleIds)]
  };
}

export function normalizeDepartments(rawDepartments) {
  if (!Array.isArray(rawDepartments)) {
    return [];
  }

  const unique = new Map();
  for (const rawDepartment of rawDepartments) {
    const normalized = normalizeDepartment(rawDepartment);
    if (!normalized) {
      continue;
    }

    if (!unique.has(normalized.id)) {
      unique.set(normalized.id, normalized);
    }
  }

  return Array.from(unique.values());
}

export function ensureDefaultDepartment(departments, defaultDepartmentName, defaultRoleIds = []) {
  const normalized = normalizeDepartments(departments);

  if (normalized.length === 0) {
    normalized.push({
      id: SUPPORT_DEFAULT_DEPARTMENT_ID,
      name: safeString(defaultDepartmentName) || "Support",
      roleIds: [...new Set(defaultRoleIds.map((roleId) => safeString(roleId)).filter(Boolean))]
    });
    return normalized;
  }

  const hasDefault = normalized.some((department) => department.id === SUPPORT_DEFAULT_DEPARTMENT_ID);
  if (!hasDefault) {
    normalized.unshift({
      id: SUPPORT_DEFAULT_DEPARTMENT_ID,
      name: safeString(defaultDepartmentName) || "Support",
      roleIds: [...new Set(defaultRoleIds.map((roleId) => safeString(roleId)).filter(Boolean))]
    });
  }

  return normalized;
}

export function getDepartmentById(departments, departmentId) {
  const targetId = safeString(departmentId);
  return normalizeDepartments(departments).find((department) => department.id === targetId) || null;
}

export function ensureValidDefaultDepartmentId(departments, defaultDepartmentId) {
  const normalized = normalizeDepartments(departments);
  const preferred = safeString(defaultDepartmentId);

  if (preferred && normalized.some((department) => department.id === preferred)) {
    return preferred;
  }

  return normalized[0]?.id || SUPPORT_DEFAULT_DEPARTMENT_ID;
}

export function createUniqueDepartmentId(existingDepartments, name) {
  const existingIds = new Set(normalizeDepartments(existingDepartments).map((department) => department.id));
  const base = slugifyDepartmentName(name);

  if (!existingIds.has(base)) {
    return base;
  }

  for (let index = 2; index < 999; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

export function formatDepartmentRoleMentions(department) {
  const roleIds = Array.isArray(department?.roleIds) ? department.roleIds : [];
  if (roleIds.length === 0) {
    return "(keine Rollen hinterlegt)";
  }

  return roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
}

export function hasDepartmentAccess(member, department) {
  if (!member) {
    return false;
  }

  const roleIds = Array.isArray(department?.roleIds) ? department.roleIds : [];
  if (roleIds.length === 0) {
    return true;
  }

  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}
