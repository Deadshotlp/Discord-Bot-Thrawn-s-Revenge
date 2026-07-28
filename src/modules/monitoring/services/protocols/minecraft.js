import net from "node:net";

// Minecraft Server List Ping (Protokoll ab 1.7, JSON-Status).
function writeVarInt(value) {
  const bytes = [];
  let remaining = value;

  do {
    let temp = remaining & 0b0111_1111;
    remaining >>>= 7;
    if (remaining !== 0) {
      temp |= 0b1000_0000;
    }

    bytes.push(temp);
  } while (remaining !== 0);

  return Buffer.from(bytes);
}

function readVarInt(buffer, startOffset) {
  let numRead = 0;
  let result = 0;
  let offset = startOffset;

  while (offset < buffer.length) {
    const byte = buffer.readUInt8(offset);
    offset += 1;
    result |= (byte & 0b0111_1111) << (7 * numRead);
    numRead += 1;

    if (numRead > 5) {
      throw new Error("VarInt zu lang");
    }

    if ((byte & 0b1000_0000) === 0) {
      return { value: result, nextOffset: offset };
    }
  }

  return null;
}

function buildPacket(packetId, payload) {
  const body = Buffer.concat([writeVarInt(packetId), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function buildHandshake(host, port) {
  const hostBuffer = Buffer.from(host, "utf8");
  const payload = Buffer.concat([
    writeVarInt(-1), // Protokollversion: -1 = Ping
    writeVarInt(hostBuffer.length),
    hostBuffer,
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    writeVarInt(1) // nächster Status: 1 = Status
  ]);

  return buildPacket(0x00, payload);
}

function stripMotd(description) {
  if (typeof description === "string") {
    return description.replace(/§./g, "").trim();
  }

  if (!description || typeof description !== "object") {
    return "";
  }

  const parts = [];
  if (typeof description.text === "string") {
    parts.push(description.text);
  }

  if (Array.isArray(description.extra)) {
    for (const child of description.extra) {
      parts.push(stripMotd(child));
    }
  }

  return parts.join("").replace(/§./g, "").trim();
}

export function queryMinecraft({ host, port = 25565, timeoutMs = 3000 }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let chunks = Buffer.alloc(0);
    let settled = false;

    socket.setTimeout(timeoutMs);

    function finish(result, error) {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    }

    socket.on("timeout", () => finish(null, new Error("Zeitüberschreitung (Minecraft-Ping)")));
    socket.on("error", (error) => finish(null, error));

    socket.on("connect", () => {
      socket.write(buildHandshake(host, port));
      socket.write(buildPacket(0x00, Buffer.alloc(0))); // Status-Request
    });

    socket.on("data", (chunk) => {
      chunks = Buffer.concat([chunks, chunk]);

      let header;
      try {
        header = readVarInt(chunks, 0);
      } catch (error) {
        finish(null, error);
        return;
      }

      if (!header) {
        return;
      }

      const packetEnd = header.nextOffset + header.value;
      if (chunks.length < packetEnd) {
        return;
      }

      const packetIdRead = readVarInt(chunks, header.nextOffset);
      const lengthRead = readVarInt(chunks, packetIdRead.nextOffset);
      const jsonStart = lengthRead.nextOffset;
      const json = chunks.toString("utf8", jsonStart, jsonStart + lengthRead.value);

      try {
        const status = JSON.parse(json);
        finish({
          online: true,
          name: stripMotd(status.description),
          map: "",
          version: status.version?.name || "",
          players: Number(status.players?.online || 0),
          maxPlayers: Number(status.players?.max || 0),
          bots: 0,
          latencyMs: Date.now() - startedAt,
          playerList: Array.isArray(status.players?.sample)
            ? status.players.sample.map((entry) => ({
              name: String(entry?.name || ""),
              steamId: "",
              score: 0,
              durationSeconds: 0
            }))
            : []
        });
      } catch (error) {
        finish(null, error);
      }
    });
  });
}
