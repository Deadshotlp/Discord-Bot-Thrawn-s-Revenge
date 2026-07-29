import net from "node:net";

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// FiveM / RedM / alt:V melden ihren Status über HTTP-Endpunkte.
export async function queryFiveM({ host, port = 30120, timeoutMs = 4000 }) {
  const base = `http://${host}:${port}`;
  const startedAt = Date.now();

  const [dynamic, info, players] = await Promise.all([
    fetchJson(`${base}/dynamic.json`, timeoutMs),
    fetchJson(`${base}/info.json`, timeoutMs),
    fetchJson(`${base}/players.json`, timeoutMs)
  ]);

  if (!dynamic && !info) {
    return { online: false, latencyMs: Date.now() - startedAt };
  }

  const playerList = Array.isArray(players)
    ? players.map((entry) => ({
      name: String(entry?.name || ""),
      score: Number(entry?.ping || 0),
      durationSeconds: 0,
      steamId: extractSteamIdFromIdentifiers(entry?.identifiers)
    }))
    : [];

  return {
    online: true,
    name: String(dynamic?.hostname || info?.vars?.sv_projectName || "").replace(/\^\d/g, ""),
    map: String(dynamic?.mapname || ""),
    game: String(dynamic?.gametype || ""),
    version: String(info?.server || ""),
    players: Number(dynamic?.clients ?? playerList.length),
    maxPlayers: Number(dynamic?.sv_maxclients || info?.vars?.sv_maxClients || 0),
    bots: 0,
    latencyMs: Date.now() - startedAt,
    playerList
  };
}

function extractSteamIdFromIdentifiers(identifiers) {
  if (!Array.isArray(identifiers)) {
    return "";
  }

  const steamEntry = identifiers.find((value) => String(value).startsWith("steam:"));
  if (!steamEntry) {
    return "";
  }

  const hex = String(steamEntry).slice("steam:".length);
  try {
    return BigInt(`0x${hex}`).toString();
  } catch {
    return "";
  }
}

// Generischer HTTP-Check: online = Antwort mit erwartetem Statuscode.
export async function queryHttp({ url, timeoutMs = 5000, expectStatus = 0 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const ok = expectStatus > 0 ? response.status === expectStatus : response.ok;

    return {
      online: ok,
      name: "",
      map: "",
      version: String(response.status),
      players: 0,
      maxPlayers: 0,
      bots: 0,
      latencyMs: Date.now() - startedAt,
      playerList: []
    };
  } catch {
    return { online: false, latencyMs: Date.now() - startedAt, playerList: [] };
  } finally {
    clearTimeout(timer);
  }
}

// Generischer Port-Check (z. B. Datenbank, Web-Panel, Teamspeak-Filetransfer).
export function queryTcp({ host, port, timeoutMs = 4000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    socket.setTimeout(timeoutMs);

    const finish = (online) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({
        online,
        players: 0,
        maxPlayers: 0,
        bots: 0,
        map: "",
        latencyMs: Date.now() - startedAt,
        playerList: []
      });
    };

    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}
