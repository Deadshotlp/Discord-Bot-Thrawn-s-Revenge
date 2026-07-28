// Umrechnung zwischen den gängigen SteamID-Formaten.
// SteamID64 = 76561197960265728 + AccountID
const STEAM64_BASE = 76561197960265728n;

export function parseSteamId(input) {
  const text = String(input || "").trim();
  if (!text) {
    return null;
  }

  // SteamID64: 17 Ziffern
  if (/^\d{17}$/.test(text)) {
    const value = BigInt(text);
    if (value < STEAM64_BASE) {
      return null;
    }

    return text;
  }

  // Klassisch: STEAM_0:1:12345678
  const classic = text.match(/^STEAM_([0-5]):([01]):(\d+)$/i);
  if (classic) {
    const accountId = BigInt(classic[3]) * 2n + BigInt(classic[2]);
    return (STEAM64_BASE + accountId).toString();
  }

  // Steam3: [U:1:12345678] oder U:1:12345678
  const steam3 = text.match(/^\[?U:1:(\d+)\]?$/i);
  if (steam3) {
    return (STEAM64_BASE + BigInt(steam3[1])).toString();
  }

  // Profil-Links mit numerischer ID
  const profileUrl = text.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profileUrl) {
    return profileUrl[1];
  }

  return null;
}

export function toClassicSteamId(steamId64) {
  const value = BigInt(String(steamId64 || "0"));
  if (value < STEAM64_BASE) {
    return "";
  }

  const accountId = value - STEAM64_BASE;
  const authServer = accountId % 2n;
  const accountNumber = accountId / 2n;

  return `STEAM_0:${authServer}:${accountNumber}`;
}

export function toSteam3(steamId64) {
  const value = BigInt(String(steamId64 || "0"));
  if (value < STEAM64_BASE) {
    return "";
  }

  return `[U:1:${value - STEAM64_BASE}]`;
}

export function steamProfileUrl(steamId64) {
  return `https://steamcommunity.com/profiles/${steamId64}`;
}

export function describeSteamId(steamId64) {
  return {
    steamId64: String(steamId64),
    classic: toClassicSteamId(steamId64),
    steam3: toSteam3(steamId64),
    profileUrl: steamProfileUrl(steamId64)
  };
}
