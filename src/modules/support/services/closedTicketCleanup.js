import { getSupportTicket, listClosedSupportTickets } from "./tickets.js";
import { resolveTextChannel } from "./channelResolvers.js";

const CLOSED_TICKET_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
const closedTicketDeleteTimers = new Map();

function getClosedTicketTimerKey(guildId, ticketId) {
  return `${guildId}:${ticketId}`;
}

function clearClosedTicketTimer(guildId, ticketId) {
  const key = getClosedTicketTimerKey(guildId, ticketId);
  const timer = closedTicketDeleteTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    closedTicketDeleteTimers.delete(key);
  }
}

async function deleteClosedTicketChannel({ client, guildId, ticketId, channelId }) {
  const latestTicket = getSupportTicket(guildId, ticketId);
  if (!latestTicket || latestTicket.status !== "closed") {
    return;
  }

  const guild = client.guilds.cache.get(guildId)
    || (await client.guilds.fetch(guildId).catch(() => null));

  if (!guild) {
    return;
  }

  const ticketChannel = await resolveTextChannel(guild, channelId || latestTicket.channelId);
  if (!ticketChannel) {
    return;
  }

  await ticketChannel.delete("Ticket seit mehr als 24 Stunden geschlossen").catch((error) => {
    client.botContext.logger.warn("Geschlossener Ticket-Channel konnte nicht automatisch geloescht werden", {
      guildId,
      ticketId,
      channelId: ticketChannel.id,
      error: String(error)
    });
  });
}

export function scheduleClosedTicketChannelDeletion({ client, ticket }) {
  if (!ticket || ticket.status !== "closed" || !ticket.guildId || !ticket.id || !ticket.channelId) {
    return;
  }

  clearClosedTicketTimer(ticket.guildId, ticket.id);

  const closedAt = Number(ticket.closedAt || 0);
  const deleteAt = (Number.isFinite(closedAt) && closedAt > 0)
    ? closedAt + CLOSED_TICKET_DELETE_DELAY_MS
    : Date.now();
  const waitMs = Math.max(0, deleteAt - Date.now());

  const key = getClosedTicketTimerKey(ticket.guildId, ticket.id);
  const runDeletion = async () => {
    closedTicketDeleteTimers.delete(key);
    await deleteClosedTicketChannel({
      client,
      guildId: ticket.guildId,
      ticketId: ticket.id,
      channelId: ticket.channelId
    });
  };

  if (waitMs === 0) {
    void runDeletion();
    return;
  }

  const timer = setTimeout(() => {
    void runDeletion();
  }, waitMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  closedTicketDeleteTimers.set(key, timer);
}

export function scheduleClosedTicketDeletionsForGuild(client, guildId) {
  const closedTickets = listClosedSupportTickets(guildId);
  for (const ticket of closedTickets) {
    scheduleClosedTicketChannelDeletion({ client, ticket });
  }
}
