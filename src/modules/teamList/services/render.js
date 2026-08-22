import { EmbedBuilder } from "discord.js";
import { formatDate } from "../../absence/services/announce.js";

// Discord-Grenzen für Embeds.
const FIELD_VALUE_LIMIT = 1024;
const FIELD_LIMIT = 25;
const EMBED_TOTAL_LIMIT = 6000;

// Puffer für Titel, Beschreibung, Fußzeile und Feldnamen.
const RESERVED = 500;

// Unterhalb dieser Zuteilung lohnt keine Namensliste mehr – dann steht dort
// nur noch eine Zusammenfassung.
const MIN_LIST_BUDGET = 80;

const LEAD_BADGE = "👑";
const MEMBER_BADGE = "•";

/**
 * Eine Zeile je Person. Erwähnungen lösen in Embeds keine Benachrichtigung
 * aus, zeigen aber den aktuellen Servernamen – deshalb Mention statt Klartext.
 */
export function formatMemberLine(entry) {
  const badge = entry.isLead ? LEAD_BADGE : MEMBER_BADGE;
  const parts = [`${badge} <@${entry.id}>`];

  if (entry.isLead) {
    parts.push("*(Leitung)*");
  }

  if (entry.absence) {
    parts.push(`· ${entry.absence.emoji} ${entry.absence.label} bis ${formatDate(entry.absence.endsOn)}`);
  }

  return parts.join(" ");
}

/**
 * Setzt Zeilen zu einem Feldwert zusammen und kürzt am Zeichenlimit sauber
 * ab, statt Discord die ganze Nachricht ablehnen zu lassen.
 */
export function joinLines(lines, limit = FIELD_VALUE_LIMIT) {
  const kept = [];
  let length = 0;

  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    const note = `… und ${remaining} weitere`;
    const needed = line.length + 1;

    // Platz für den Hinweis freihalten, solange noch etwas übrig bleibt.
    if (length + needed > limit - (remaining > 1 ? note.length + 1 : 0)) {
      kept.push(note);
      break;
    }

    kept.push(line);
    length += needed;
  }

  return kept.join("\n") || "–";
}

/**
 * Verteilt das Zeichenbudget des Embeds auf die Departments. Wer wenig
 * braucht, bekommt genau so viel; der Rest wird gleichmäßig unter den
 * verbleibenden aufgeteilt. So verhungert kein Bereich, nur weil ein anderer
 * sehr groß ist.
 */
export function allocateBudgets(needs, budget) {
  const limits = new Array(needs.length).fill(0);
  const ascending = needs
    .map((need, index) => ({ need, index }))
    .sort((a, b) => a.need - b.need);

  let remaining = Math.max(0, budget);
  let open = needs.length;

  for (const { need, index } of ascending) {
    const share = Math.floor(remaining / open);
    const granted = Math.min(need, share, FIELD_VALUE_LIMIT);

    limits[index] = granted;
    remaining -= granted;
    open -= 1;
  }

  return limits;
}

function departmentHeading(group) {
  const details = [`${group.members.length} Mitglieder`];

  if (group.absentCount > 0) {
    details.push(`${group.absentCount} abgemeldet`);
  }

  return `${group.name} · ${details.join(" · ")}`;
}

function summaryValue(group) {
  const parts = [`${group.members.length} Mitglieder`];

  if (group.leadCount > 0) {
    parts.push(`${group.leadCount} in der Leitung`);
  }

  if (group.absentCount > 0) {
    parts.push(`${group.absentCount} abgemeldet`);
  }

  return `*${parts.join(", ")} – zu viele für die Anzeige.*`;
}

export function buildRosterEmbed(roster, { guildName = "", departmentId = "" } = {}) {
  const groups = departmentId
    ? roster.departments.filter((group) => group.id === departmentId)
    : roster.departments;

  const embed = new EmbedBuilder()
    .setTitle(guildName ? `Teamliste · ${guildName}` : "Teamliste")
    .setColor("#5865f2")
    .setTimestamp(new Date());

  if (groups.length === 0) {
    embed.setDescription(
      "Es sind noch keine Departments angelegt. Sie werden im Dashboard unter "
      + "Einstellungen gepflegt."
    );

    return embed;
  }

  const configured = groups.filter((group) => !group.unconfigured);

  if (configured.length === 0) {
    embed.setDescription(
      "Den Departments sind noch keine Rollen zugeordnet. Ohne Rollen lässt sich "
      + "nicht bestimmen, wer zum Team gehört."
    );

    return embed;
  }

  embed.setDescription(
    `**${roster.totals.members}** Personen im Team · **${roster.totals.leads}** in der Leitung`
    + ` · **${roster.totals.absent}** aktuell abgemeldet`
  );

  const shown = configured.slice(0, FIELD_LIMIT);
  const headings = shown.map(departmentHeading);
  const lines = shown.map((group) => group.members.map(formatMemberLine));

  // Feldnamen zählen beim Gesamtlimit mit und werden vorab abgezogen.
  const budget = EMBED_TOTAL_LIMIT
    - RESERVED
    - headings.reduce((sum, heading) => sum + heading.length, 0);

  const needs = lines.map((group) => group.reduce((sum, line) => sum + line.length + 1, 0));
  const limits = allocateBudgets(needs, budget);

  for (const [index, group] of shown.entries()) {
    let value;

    if (group.members.length === 0) {
      value = "*Niemand zugeordnet*";
    } else if (limits[index] < MIN_LIST_BUDGET) {
      value = summaryValue(group);
    } else {
      value = joinLines(lines[index], limits[index]);
    }

    embed.addFields({ name: headings[index], value, inline: false });
  }

  const omitted = configured.length - shown.length;
  embed.setFooter({
    text: omitted > 0
      ? `${LEAD_BADGE} Leitung · ${omitted} weitere Departments nicht dargestellt`
      : `${LEAD_BADGE} Leitung`
  });

  return embed;
}
