import { EmbedBuilder } from "discord.js";
import { formatDate } from "../../absence/services/announce.js";

// Discord-Grenzen.
const DESCRIPTION_LIMIT = 4096;
const EMBED_TOTAL_LIMIT = 6000;
const MAX_EMBEDS = 10;

// Puffer für Titel, Kopfzeile, Fußzeile und die kleinen Metazeilen.
const RESERVED = 600;

// Unterhalb dieser Zuteilung passt keine sinnvolle Namensliste mehr – dann
// steht dort nur eine Zusammenfassung. Greift nur, wenn der Bereich mehr
// bräuchte, als er bekommen hat.
const MIN_LIST_BUDGET = 90;

const ACCENT = "#5865f2";
const LEAD_BADGE = "👑";
const MEMBER_BADGE = "•";

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Eine Zeile je Person. Erwähnungen lösen in Embeds keine Benachrichtigung
 * aus, zeigen aber den aktuellen Servernamen – deshalb Mention statt Klartext.
 * Ist jemand abgemeldet, ersetzt das Symbol der Abwesenheit den Aufzählungs-
 * punkt: so ist die Zeile auf einen Blick lesbar, ohne länger zu werden.
 */
export function formatMemberLine(entry) {
  const badge = entry.isLead ? LEAD_BADGE : (entry.absence?.emoji || MEMBER_BADGE);
  const parts = [`${badge} <@${entry.id}>`];

  if (entry.isLead) {
    parts.push("**Leitung**");
  }

  if (entry.absence) {
    parts.push(`${entry.absence.emoji} ${entry.absence.label} bis ${formatDate(entry.absence.endsOn)}`);
  }

  return parts.join(" · ");
}

/**
 * Setzt Zeilen zu einem Textblock zusammen und kürzt am Zeichenlimit sauber
 * ab, statt Discord die ganze Nachricht ablehnen zu lassen.
 */
export function joinLines(lines, limit = DESCRIPTION_LIMIT) {
  const full = lines.join("\n");

  // Passt alles, wird nichts gekürzt – sonst würde der reservierte Platz für
  // den Hinweis Zeilen verdrängen, die problemlos hineingepasst hätten.
  if (full.length <= limit) {
    return full || "–";
  }

  const kept = [];
  let length = 0;

  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    const note = `-# … und ${remaining} weitere`;
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
 * Verteilt das Zeichenbudget auf die Departments. Wer wenig braucht, bekommt
 * genau so viel; der Rest wird gleichmäßig unter den verbleibenden aufgeteilt.
 * So verhungert kein Bereich, nur weil ein anderer sehr groß ist.
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
    const granted = Math.min(need, share, DESCRIPTION_LIMIT);

    limits[index] = granted;
    remaining -= granted;
    open -= 1;
  }

  return limits;
}

function metaLine(group) {
  const parts = [plural(group.members.length, "Mitglied", "Mitglieder")];

  if (group.leadCount > 0) {
    parts.push(`${group.leadCount} in der Leitung`);
  }

  if (group.absentCount > 0) {
    parts.push(`${group.absentCount} abgemeldet`);
  }

  // "-# " ist Discords Kleinschrift und setzt die Zeile optisch ab.
  return `-# ${parts.join(" · ")}`;
}

function summaryBody() {
  return "-# Zu viele Einträge für die Anzeige – die vollständige Liste steht im Dashboard.";
}

/**
 * Baut die Nachricht als mehrere Embeds: eine Kopfzeile mit den Kennzahlen
 * und je ein Embed pro Department. Discord setzt Embeds mit Abstand und
 * eigenem Farbbalken untereinander – dadurch stehen die Bereiche deutlich
 * getrennt statt als ein gedrängter Block.
 *
 * @returns {import("discord.js").EmbedBuilder[]}
 */
export function buildRosterEmbeds(roster, { guildName = "", departmentId = "" } = {}) {
  const groups = departmentId
    ? roster.departments.filter((group) => group.id === departmentId)
    : roster.departments;

  const title = guildName ? `Teamliste · ${guildName}` : "Teamliste";

  if (groups.length === 0) {
    return [new EmbedBuilder().setTitle(title).setColor(ACCENT).setDescription(
      "Es sind noch keine Departments angelegt. Sie werden im Dashboard unter "
      + "Einstellungen gepflegt."
    )];
  }

  const configured = groups.filter((group) => !group.unconfigured);

  if (configured.length === 0) {
    return [new EmbedBuilder().setTitle(title).setColor(ACCENT).setDescription(
      "Den Departments sind noch keine Rollen zugeordnet. Ohne Rollen lässt sich "
      + "nicht bestimmen, wer zum Team gehört."
    )];
  }

  const header = new EmbedBuilder()
    .setTitle(title)
    .setColor(ACCENT)
    .setDescription(
      `**${roster.totals.members}** Personen im Team`
      + ` · **${roster.totals.leads}** in der Leitung`
      + ` · **${roster.totals.absent}** aktuell abgemeldet`
    );

  // Ein Platz geht an die Kopfzeile.
  const shown = configured.slice(0, MAX_EMBEDS - 1);
  const omitted = configured.length - shown.length;

  const metas = shown.map(metaLine);
  const lines = shown.map((group) => group.members.map(formatMemberLine));
  const needs = lines.map((group) => group.reduce((sum, line) => sum + line.length + 1, 0));

  const fixed = shown.reduce((sum, group, index) => sum + group.name.length + metas[index].length, 0);
  const budget = EMBED_TOTAL_LIMIT - RESERVED - header.data.description.length - fixed;
  const limits = allocateBudgets(needs, budget);

  const embeds = [header];

  for (const [index, group] of shown.entries()) {
    let body;

    if (group.members.length === 0) {
      body = "*Niemand zugeordnet*";
    } else if (limits[index] < needs[index] && limits[index] < MIN_LIST_BUDGET) {
      // Nur wenn die Zuteilung wirklich nicht reicht – wer wenig braucht und
      // genau so viel bekommt, wird vollständig angezeigt.
      body = summaryBody();
    } else {
      body = joinLines(lines[index], limits[index]);
    }

    embeds.push(
      new EmbedBuilder()
        .setTitle(group.name)
        .setColor(ACCENT)
        .setDescription(`${metas[index]}\n\n${body}`)
    );
  }

  const last = embeds.at(-1);
  last.setFooter({
    text: omitted > 0
      ? `${LEAD_BADGE} Leitung · ${omitted} weitere Departments nicht dargestellt`
      : `${LEAD_BADGE} Leitung`
  });
  last.setTimestamp(new Date());

  return embeds;
}
