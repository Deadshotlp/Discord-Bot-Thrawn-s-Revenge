import dgram from "node:dgram";

const A2S_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const A2S_INFO_PAYLOAD = Buffer.from("Source Engine Query\0", "ascii");
const A2S_INFO_REQUEST = 0x54;
const A2S_PLAYER_REQUEST = 0x55;
const A2S_INFO_TYPE = 0x49;
const A2S_PLAYER_TYPE = 0x44;
const A2S_CHALLENGE_TYPE = 0x41;

function buildInfoRequest(challenge) {
  const base = Buffer.concat([A2S_HEADER, Buffer.from([A2S_INFO_REQUEST]), A2S_INFO_PAYLOAD]);
  return challenge ? Buffer.concat([base, challenge]) : base;
}

function buildPlayerRequest(challenge) {
  const suffix = challenge || Buffer.from([0xff, 0xff, 0xff, 0xff]);
  return Buffer.concat([A2S_HEADER, Buffer.from([A2S_PLAYER_REQUEST]), suffix]);
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0x00, offset);
  if (end === -1) {
    return { value: "", nextOffset: buffer.length };
  }

  return { value: buffer.toString("utf8", offset, end), nextOffset: end + 1 };
}

// body = Antwort-Bytes nach dem 4-Byte-Header 0xFFFFFFFF (erstes Byte = Typ).
export function parseA2SInfoResponse(body) {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.readUInt8(0) !== A2S_INFO_TYPE) {
    return null;
  }

  let offset = 1; // Typ-Byte
  offset += 1; // Protokoll-Version

  const name = readCString(body, offset);
  offset = name.nextOffset;

  const map = readCString(body, offset);
  offset = map.nextOffset;

  const folder = readCString(body, offset);
  offset = folder.nextOffset;

  const game = readCString(body, offset);
  offset = game.nextOffset;

  offset += 2; // Steam App-ID

  if (offset + 3 > body.length) {
    return null;
  }

  const players = body.readUInt8(offset);
  offset += 1;
  const maxPlayers = body.readUInt8(offset);
  offset += 1;
  const bots = body.readUInt8(offset);
  offset += 1;

  // serverType, environment, visibility, vac
  offset += 4;

  const version = readCString(body, offset);

  return {
    name: name.value,
    map: map.value,
    folder: folder.value,
    game: game.value,
    players,
    maxPlayers,
    bots,
    version: version.value || ""
  };
}

export function parseA2SPlayerResponse(body) {
  if (!Buffer.isBuffer(body) || body.length < 2 || body.readUInt8(0) !== A2S_PLAYER_TYPE) {
    return null;
  }

  const count = body.readUInt8(1);
  let offset = 2;
  const players = [];

  for (let index = 0; index < count; index += 1) {
    if (offset + 1 > body.length) {
      break;
    }

    offset += 1; // Slot-Index (von Source nicht zuverlässig gefüllt)
    const name = readCString(body, offset);
    offset = name.nextOffset;

    if (offset + 8 > body.length) {
      break;
    }

    const score = body.readInt32LE(offset);
    offset += 4;
    const duration = body.readFloatLE(offset);
    offset += 4;

    players.push({
      name: name.value,
      score,
      durationSeconds: Math.max(0, Math.round(duration))
    });
  }

  return players;
}

function sendUdpQuery({ host, port, timeoutMs, buildRequest, responseType }) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const startedAt = Date.now();
    let settled = false;
    let challengeUsed = false;

    const timer = setTimeout(() => {
      finish(null, new Error("Zeitüberschreitung bei der Server-Abfrage"));
    }, timeoutMs);

    function finish(result, error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.close();

      if (error) {
        reject(error);
        return;
      }

      resolve({ body: result, latencyMs: Date.now() - startedAt });
    }

    socket.on("error", (error) => finish(null, error));

    socket.on("message", (message) => {
      if (message.length < 5 || !message.subarray(0, 4).equals(A2S_HEADER)) {
        return;
      }

      const type = message.readUInt8(4);

      if (type === A2S_CHALLENGE_TYPE && !challengeUsed && message.length >= 9) {
        challengeUsed = true;
        socket.send(buildRequest(message.subarray(5, 9)), port, host, (error) => {
          if (error) {
            finish(null, error);
          }
        });
        return;
      }

      if (type === responseType) {
        finish(message.subarray(4));
      }
    });

    socket.send(buildRequest(null), port, host, (error) => {
      if (error) {
        finish(null, error);
      }
    });
  });
}

export async function queryA2S({ host, port, timeoutMs = 3000, withPlayers = true }) {
  const info = await sendUdpQuery({
    host,
    port,
    timeoutMs,
    buildRequest: buildInfoRequest,
    responseType: A2S_INFO_TYPE
  });

  const parsed = parseA2SInfoResponse(info.body);
  if (!parsed) {
    return { online: false, latencyMs: info.latencyMs };
  }

  let playerList = [];
  if (withPlayers && parsed.players > 0) {
    const players = await sendUdpQuery({
      host,
      port,
      timeoutMs,
      buildRequest: buildPlayerRequest,
      responseType: A2S_PLAYER_TYPE
    }).catch(() => null);

    if (players) {
      playerList = parseA2SPlayerResponse(players.body) || [];
    }
  }

  return {
    online: true,
    name: parsed.name,
    map: parsed.map,
    game: parsed.game,
    version: parsed.version,
    players: parsed.players,
    maxPlayers: parsed.maxPlayers,
    bots: parsed.bots,
    latencyMs: info.latencyMs,
    playerList
  };
}
