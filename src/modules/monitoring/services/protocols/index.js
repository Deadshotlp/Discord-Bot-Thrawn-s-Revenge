import { queryA2S } from "./a2s.js";
import { queryMinecraft } from "./minecraft.js";
import { queryFiveM, queryHttp, queryTcp } from "./http.js";

export const SERVER_KINDS = Object.freeze({
  source: {
    id: "source",
    label: "Source / GMod (A2S)",
    defaultPort: 27015,
    supportsPlayers: true,
    connectScheme: "steam"
  },
  minecraft: {
    id: "minecraft",
    label: "Minecraft (Server List Ping)",
    defaultPort: 25565,
    supportsPlayers: true,
    connectScheme: "none"
  },
  fivem: {
    id: "fivem",
    label: "FiveM / alt:V (HTTP)",
    defaultPort: 30120,
    supportsPlayers: true,
    connectScheme: "fivem"
  },
  http: {
    id: "http",
    label: "HTTP / Website",
    defaultPort: 443,
    supportsPlayers: false,
    connectScheme: "url"
  },
  tcp: {
    id: "tcp",
    label: "TCP-Port",
    defaultPort: 27015,
    supportsPlayers: false,
    connectScheme: "none"
  }
});

export function listServerKinds() {
  return Object.values(SERVER_KINDS).map((kind) => ({
    id: kind.id,
    label: kind.label,
    defaultPort: kind.defaultPort,
    supportsPlayers: kind.supportsPlayers
  }));
}

const emptyResult = (latencyMs = 0) => ({
  online: false,
  name: "",
  map: "",
  game: "",
  version: "",
  players: 0,
  maxPlayers: 0,
  bots: 0,
  latencyMs,
  playerList: []
});

/**
 * Fragt einen Server unabhängig vom Protokoll ab.
 * Wirft nie – ein nicht erreichbarer Server ist ein normales Ergebnis (online: false).
 */
export async function queryServer(server, { timeoutMs = 4000 } = {}) {
  const host = String(server?.host || "").trim();
  const queryPort = Number(server?.queryPort || server?.port || 0);
  const meta = server?.meta || {};

  try {
    switch (server?.kind) {
      case "minecraft": {
        const result = await queryMinecraft({ host, port: queryPort || 25565, timeoutMs });
        return { ...emptyResult(), ...result };
      }

      case "fivem": {
        const result = await queryFiveM({ host, port: queryPort || 30120, timeoutMs });
        return { ...emptyResult(), ...result };
      }

      case "http": {
        const url = meta.url || `https://${host}`;
        const result = await queryHttp({ url, timeoutMs, expectStatus: Number(meta.expectStatus || 0) });
        return { ...emptyResult(), ...result };
      }

      case "tcp": {
        const result = await queryTcp({ host, port: queryPort, timeoutMs });
        return { ...emptyResult(), ...result };
      }

      case "source":
      default: {
        const result = await queryA2S({ host, port: queryPort || 27015, timeoutMs, withPlayers: true });
        return { ...emptyResult(), ...result };
      }
    }
  } catch {
    return emptyResult();
  }
}

export function buildConnectLink(server) {
  if (server?.connectUrl) {
    return server.connectUrl;
  }

  const address = `${server?.host}:${server?.port}`;

  switch (server?.kind) {
    case "source":
      return `steam://connect/${address}`;
    case "fivem":
      return `fivem://connect/${address}`;
    case "http":
      return server?.meta?.url || `https://${server?.host}`;
    default:
      return "";
  }
}
