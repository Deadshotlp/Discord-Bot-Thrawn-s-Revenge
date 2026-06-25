import dgram from "node:dgram";

const A2S_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const A2S_INFO_PAYLOAD = Buffer.from("Source Engine Query\0", "ascii");
const A2S_INFO_TYPE = 0x49;
const A2S_CHALLENGE_TYPE = 0x41;

function buildInfoRequest(challenge) {
  const base = Buffer.concat([A2S_HEADER, Buffer.from([0x54]), A2S_INFO_PAYLOAD]);
  return challenge ? Buffer.concat([base, challenge]) : base;
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0x00, offset);
  if (end === -1) {
    return { value: "", nextOffset: buffer.length };
  }

  return { value: buffer.toString("utf8", offset, end), nextOffset: end + 1 };
}

// body = response bytes after the 4-byte 0xFFFFFFFF header (first byte is the type byte).
export function parseA2SInfoResponse(body) {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.readUInt8(0) !== A2S_INFO_TYPE) {
    return null;
  }

  let offset = 1; // type byte
  offset += 1; // protocol version

  const name = readCString(body, offset);
  offset = name.nextOffset;

  const map = readCString(body, offset);
  offset = map.nextOffset;

  const folder = readCString(body, offset);
  offset = folder.nextOffset;

  const game = readCString(body, offset);
  offset = game.nextOffset;

  offset += 2; // Steam app id

  if (offset + 3 > body.length) {
    return null;
  }

  const players = body.readUInt8(offset);
  offset += 1;
  const maxPlayers = body.readUInt8(offset);
  offset += 1;
  const bots = body.readUInt8(offset);
  offset += 1;

  return {
    name: name.value,
    map: map.value,
    folder: folder.value,
    game: game.value,
    players,
    maxPlayers,
    bots
  };
}

export function queryGameServerInfo(host, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    let challengeRequested = false;

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

      resolve(result);
    }

    socket.on("error", (error) => finish(null, error));

    socket.on("message", (message) => {
      if (message.length < 5 || !message.subarray(0, 4).equals(A2S_HEADER)) {
        return;
      }

      const type = message.readUInt8(4);

      if (type === A2S_CHALLENGE_TYPE && !challengeRequested && message.length >= 9) {
        challengeRequested = true;
        const challenge = message.subarray(5, 9);
        socket.send(buildInfoRequest(challenge), port, host, (error) => {
          if (error) {
            finish(null, error);
          }
        });
        return;
      }

      if (type === A2S_INFO_TYPE) {
        finish(parseA2SInfoResponse(message.subarray(4)));
      }
    });

    socket.send(buildInfoRequest(), port, host, (error) => {
      if (error) {
        finish(null, error);
      }
    });
  });
}

export async function fetchGameServerStatus(host, port, timeoutMs = 3000) {
  try {
    const info = await queryGameServerInfo(host, port, timeoutMs);
    if (!info) {
      return { online: false };
    }

    return {
      online: true,
      name: info.name,
      map: info.map,
      game: info.game,
      players: info.players,
      maxPlayers: info.maxPlayers,
      bots: info.bots
    };
  } catch {
    return { online: false };
  }
}
