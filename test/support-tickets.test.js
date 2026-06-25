import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "support-tickets-test-"));
process.chdir(tempDir);

const {
  closeSupportTicket,
  createSupportTicket,
  escalateSupportTicket,
  getOpenTicketByUser,
  getSupportTicket,
  listClosedSupportTickets
} = await import("../src/modules/support/services/tickets.js");

function openTicket(guildId, userId, channelId) {
  return createSupportTicket({
    guildId,
    channelId,
    userId,
    departmentId: "default",
    ticketName: "Testanliegen",
    ticketDescription: "Beschreibung"
  });
}

test("createSupportTicket opens a new ticket for a user", () => {
  const { ticket, created } = openTicket("g1", "u1", "c1");
  assert.equal(created, true);
  assert.equal(ticket.status, "open");
  assert.equal(ticket.userId, "u1");
});

test("createSupportTicket does not duplicate an open ticket for the same user", () => {
  const first = openTicket("g2", "u2", "c2");
  const second = openTicket("g2", "u2", "c3");
  assert.equal(second.created, false);
  assert.equal(second.ticket.id, first.ticket.id);
});

test("closeSupportTicket marks the ticket closed and sets closedById", () => {
  const { ticket } = openTicket("g3", "u3", "c4");
  const closed = closeSupportTicket("g3", ticket.id, "mod1");
  assert.equal(closed.status, "closed");
  assert.equal(closed.closedById, "mod1");
  assert.equal(getSupportTicket("g3", ticket.id).status, "closed");
});

test("closeSupportTicket refuses to close an already-closed ticket", () => {
  const { ticket } = openTicket("g4", "u4", "c5");
  closeSupportTicket("g4", ticket.id, "mod1");
  const secondClose = closeSupportTicket("g4", ticket.id, "mod2");
  assert.equal(secondClose, null);
});

test("escalateSupportTicket updates the department of an open ticket", () => {
  const { ticket } = openTicket("g5", "u5", "c6");
  const escalated = escalateSupportTicket("g5", ticket.id, "billing");
  assert.equal(escalated.departmentId, "billing");
});

test("getOpenTicketByUser only returns tickets that are still open", () => {
  const { ticket } = openTicket("g6", "u6", "c7");
  assert.equal(getOpenTicketByUser("g6", "u6").id, ticket.id);
  closeSupportTicket("g6", ticket.id, "mod1");
  assert.equal(getOpenTicketByUser("g6", "u6"), null);
});

test("listClosedSupportTickets returns only closed tickets for the guild", () => {
  const { ticket } = openTicket("g7", "u7", "c8");
  closeSupportTicket("g7", ticket.id, "mod1");
  const closedTickets = listClosedSupportTickets("g7");
  assert.equal(closedTickets.length, 1);
  assert.equal(closedTickets[0].id, ticket.id);
});
