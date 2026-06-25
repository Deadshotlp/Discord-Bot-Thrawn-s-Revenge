import { canManageServer } from "../../../core/permissions.js";
import { hasDepartmentAccess } from "./config.js";

export function canHandleCase(interaction, caseData) {
  if (!interaction.member || !caseData) {
    return false;
  }

  if (canManageServer(interaction.member)) {
    return true;
  }

  return caseData.supporterId === interaction.user.id;
}

export function canHandleTicket(interaction, ticket, department) {
  if (!interaction.member || !ticket) {
    return false;
  }

  if (canManageServer(interaction.member)) {
    return true;
  }

  if (ticket.userId === interaction.user.id) {
    return true;
  }

  if (!department) {
    return false;
  }

  return hasDepartmentAccess(interaction.member, department);
}

export function canEscalateCase(interaction, department) {
  if (!interaction.member || !department) {
    return false;
  }

  return hasDepartmentAccess(interaction.member, department);
}

export const canEscalateTicket = canEscalateCase;
