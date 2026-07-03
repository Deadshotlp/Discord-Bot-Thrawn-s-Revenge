import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getLeadDepartments,
  isDepartmentLead,
  normalizeDepartment
} from "../src/modules/support/services/config.js";

function makeMember(roleIds) {
  return {
    roles: {
      cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }]))
    }
  };
}

test("normalizeDepartment preserves lead role ids and deduplicates", () => {
  const department = normalizeDepartment({
    name: "Technik",
    roleIds: ["1".repeat(18)],
    leadRoleIds: ["2".repeat(18), "2".repeat(18), ""]
  });

  assert.deepEqual(department.leadRoleIds, ["2".repeat(18)]);
});

test("normalizeDepartment defaults lead roles to an empty list", () => {
  const department = normalizeDepartment({ name: "Technik" });
  assert.deepEqual(department.leadRoleIds, []);
});

test("isDepartmentLead requires a matching lead role", () => {
  const department = { id: "d1", name: "Technik", roleIds: [], leadRoleIds: ["111"] };

  assert.equal(isDepartmentLead(makeMember(["111"]), department), true);
  assert.equal(isDepartmentLead(makeMember(["222"]), department), false);
  assert.equal(isDepartmentLead(null, department), false);
});

test("isDepartmentLead is false when no lead roles are configured", () => {
  const department = { id: "d1", name: "Technik", roleIds: ["111"], leadRoleIds: [] };
  assert.equal(isDepartmentLead(makeMember(["111"]), department), false);
});

test("getLeadDepartments filters to departments the member leads", () => {
  const departments = [
    { id: "d1", name: "Technik", roleIds: [], leadRoleIds: ["1".repeat(18)] },
    { id: "d2", name: "Events", roleIds: [], leadRoleIds: ["2".repeat(18)] }
  ];

  const result = getLeadDepartments(makeMember(["1".repeat(18)]), departments);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "d1");
});
