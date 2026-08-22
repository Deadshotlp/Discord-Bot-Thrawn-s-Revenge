import { ABSENCE_KINDS, ABSENCE_STATUS, listAbsences, todayIso } from "../../absence/services/store.js";
import { normalizeDepartments } from "../../support/services/config.js";

// Discord liefert je Abruf höchstens 1000 Mitglieder.
const PAGE_SIZE = 1000;
const MAX_PAGES = 25;

// Die Mitgliederliste ändert sich selten, der Abruf ist aber teuer. Eine
// Minute Zwischenspeicher reicht, damit mehrere Aufrufe hintereinander
// (Befehl, Dashboard, Aktualisieren) nicht jedes Mal alles neu laden.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

/**
 * Wird geworfen, wenn Discord die Mitgliederliste verweigert. Das passiert
 * genau dann, wenn das privilegierte Intent GUILD_MEMBERS fehlt.
 */
export class MemberIntentError extends Error {
  constructor() {
    super(
      "Die Mitgliederliste ist nicht abrufbar. Dafür muss im Discord Developer Portal "
      + "unter Bot → Privileged Gateway Intents der Schalter \"Server Members Intent\" "
      + "aktiv sein und in der .env GUILD_MEMBERS_INTENT=true stehen."
    );
    this.name = "MemberIntentError";
  }
}

function isMissingIntent(error) {
  // 403 Missing Access kommt zurück, wenn das Intent nicht freigeschaltet ist.
  return error?.status === 403 || error?.code === 50001;
}

async function listAllMembers(guild) {
  const collected = new Map();
  let after;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let batch;

    try {
      // cache: false – die Momentaufnahme unten reicht uns. Sonst würde ein
      // Aufruf den Mitglieder-Cache des Clients mit dem ganzen Server füllen.
      batch = await guild.members.list({ limit: PAGE_SIZE, after, cache: false });
    } catch (error) {
      if (isMissingIntent(error)) {
        throw new MemberIntentError();
      }

      throw error;
    }

    if (batch.size === 0) {
      break;
    }

    for (const [id, member] of batch) {
      collected.set(id, member);
    }

    if (batch.size < PAGE_SIZE) {
      break;
    }

    after = batch.lastKey();
  }

  return [...collected.values()];
}

function toPlainMember(member) {
  return {
    id: member.id,
    displayName: member.displayName || member.user?.username || member.id,
    username: member.user?.username || "",
    avatarUrl: member.displayAvatarURL?.({ size: 64 }) || "",
    bot: Boolean(member.user?.bot),
    roleIds: [...member.roles.cache.keys()]
  };
}

export async function fetchGuildMembers(guild, { force = false } = {}) {
  const cached = cache.get(guild.id);

  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.members;
  }

  const members = (await listAllMembers(guild)).map(toPlainMember);
  cache.set(guild.id, { members, expiresAt: Date.now() + CACHE_TTL_MS });

  return members;
}

export function clearMemberCache(guildId) {
  if (guildId) {
    cache.delete(String(guildId));
    return;
  }

  cache.clear();
}

function describeAbsence(absence) {
  const kind = ABSENCE_KINDS[absence.kind];

  return {
    id: absence.id,
    kind: absence.kind,
    label: kind?.label || absence.kind,
    emoji: kind?.emoji || "🚫",
    startsOn: absence.startsOn,
    endsOn: absence.endsOn,
    reason: absence.reason || ""
  };
}

function compareMembers(a, b) {
  // Leitung zuerst, danach alphabetisch – so steht oben, wer ansprechbar ist.
  return Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name, "de");
}

/**
 * Baut die Teamliste aus reinen Daten – bewusst ohne discord.js-Objekte,
 * damit die Zuordnung von Rollen, Leitung und Abmeldungen testbar bleibt.
 *
 * Mitglied eines Departments ist, wer eine seiner Rollen ODER eine seiner
 * Leitungsrollen trägt: eine Leitung ohne die normale Bereichsrolle gehört
 * trotzdem zum Bereich.
 */
export function buildRoster({ members = [], departments = [], absences = [], today = todayIso() }) {
  const currentAbsences = new Map();

  for (const absence of absences) {
    if (absence.status !== ABSENCE_STATUS.active) {
      continue;
    }

    if (absence.startsOn > today || absence.endsOn < today) {
      continue;
    }

    // Bei mehreren gleichzeitigen Einträgen zählt der, der später endet.
    const existing = currentAbsences.get(absence.userId);
    if (!existing || absence.endsOn > existing.endsOn) {
      currentAbsences.set(absence.userId, absence);
    }
  }

  const people = members.filter((member) => !member.bot);
  const groups = [];
  const everyone = new Set();

  for (const department of departments) {
    const roleIds = new Set(department.roleIds || []);
    const leadRoleIds = new Set(department.leadRoleIds || []);

    if (roleIds.size === 0 && leadRoleIds.size === 0) {
      groups.push({ id: department.id, name: department.name, members: [], leadCount: 0, absentCount: 0, unconfigured: true });
      continue;
    }

    const entries = people
      .filter((member) => member.roleIds.some((roleId) => roleIds.has(roleId) || leadRoleIds.has(roleId)))
      .map((member) => {
        const absence = currentAbsences.get(member.id);

        return {
          id: member.id,
          name: member.displayName,
          username: member.username,
          avatarUrl: member.avatarUrl,
          isLead: member.roleIds.some((roleId) => leadRoleIds.has(roleId)),
          absence: absence ? describeAbsence(absence) : null
        };
      })
      .sort(compareMembers);

    for (const entry of entries) {
      everyone.add(entry.id);
    }

    groups.push({
      id: department.id,
      name: department.name,
      members: entries,
      leadCount: entries.filter((entry) => entry.isLead).length,
      absentCount: entries.filter((entry) => entry.absence).length,
      unconfigured: false
    });
  }

  const absentPeople = new Set();
  const leadPeople = new Set();

  for (const group of groups) {
    for (const entry of group.members) {
      if (entry.absence) {
        absentPeople.add(entry.id);
      }

      if (entry.isLead) {
        leadPeople.add(entry.id);
      }
    }
  }

  return {
    departments: groups,
    totals: {
      // Personen, nicht Einträge: wer in zwei Bereichen ist, zählt einmal.
      members: everyone.size,
      absent: absentPeople.size,
      leads: leadPeople.size
    },
    today
  };
}

/**
 * Teamliste für einen Server: holt Mitglieder, Departments und Abmeldungen
 * und setzt sie zusammen.
 */
export async function collectRoster(client, guildId, { force = false, today = todayIso() } = {}) {
  const guild = client.guilds.cache.get(String(guildId));

  if (!guild) {
    throw new Error("Server nicht gefunden");
  }

  const supportConfig = client.botContext.settingsStore.getModuleState(guild.id, "support")?.config;
  const departments = normalizeDepartments(supportConfig?.departments);
  const members = await fetchGuildMembers(guild, { force });

  return buildRoster({
    members,
    departments,
    absences: listAbsences(guild.id),
    today
  });
}
