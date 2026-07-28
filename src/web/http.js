import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".lua": "text/plain; charset=utf-8"
};

const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(text);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }

    const name = part.slice(0, index).trim();
    if (name) {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }

  parts.push(`Path=${options.path || "/"}`);

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

export function appendCookie(res, cookie) {
  const existing = res.getHeader("set-cookie");
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader("set-cookie", [...list, cookie]);
}

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Anfrage zu groß");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Ungültiges JSON");
  }
}

/**
 * Sehr kleiner Router mit Pfad-Parametern (:name).
 * Reicht für eine überschaubare REST-API und spart eine Framework-Abhängigkeit,
 * die im Pterodactyl-Container zusätzlich installiert werden müsste.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regexSource = pattern
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          keys.push(segment.slice(1));
          return "([^/]+)";
        }

        if (segment === "*") {
          keys.push("wildcard");
          return "(.*)";
        }

        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");

    this.routes.push({
      method,
      regex: new RegExp(`^${regexSource}/?$`),
      keys,
      handler
    });

    return this;
  }

  get(pattern, handler) {
    return this.add("GET", pattern, handler);
  }

  post(pattern, handler) {
    return this.add("POST", pattern, handler);
  }

  patch(pattern, handler) {
    return this.add("PATCH", pattern, handler);
  }

  put(pattern, handler) {
    return this.add("PUT", pattern, handler);
  }

  delete(pattern, handler) {
    return this.add("DELETE", pattern, handler);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const match = route.regex.exec(pathname);
      if (!match) {
        continue;
      }

      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] || "");
      });

      return { handler: route.handler, params };
    }

    return null;
  }
}

export function createStaticHandler(rootDir, { fallback = "index.html" } = {}) {
  const etagCache = new Map();

  return function serveStatic(req, res, pathname) {
    const relative = pathname.replace(/^\/+/, "");
    let filePath = path.join(rootDir, relative);

    // Pfad-Traversal verhindern.
    if (!filePath.startsWith(rootDir)) {
      sendText(res, 403, "Forbidden");
      return true;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const fallbackPath = path.join(rootDir, fallback);
      if (!fs.existsSync(fallbackPath)) {
        return false;
      }

      filePath = fallbackPath;
    }

    const stat = fs.statSync(filePath);
    const cached = etagCache.get(filePath);
    let etag = cached?.mtimeMs === stat.mtimeMs ? cached.etag : null;

    if (!etag) {
      etag = `W/"${createHash("sha1").update(`${filePath}:${stat.mtimeMs}:${stat.size}`).digest("hex").slice(0, 16)}"`;
      etagCache.set(filePath, { mtimeMs: stat.mtimeMs, etag });
    }

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return true;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[extension] || "application/octet-stream",
      "content-length": stat.size,
      etag,
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });

    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}
