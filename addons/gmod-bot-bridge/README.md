# Bot-Bridge (Garry's Mod)

Meldet die Spielerliste mit SteamID64 an den Discord-Bot und erlaubt das
Verknüpfen von Steam und Discord direkt im Spiel.

Ohne dieses Addon kennt der Bot über die A2S-Abfrage nur Spielernamen – für die
SteamID-genaue Spielzeit ist es notwendig. FiveM-Server brauchen es nicht, dort
liefert die HTTP-Schnittstelle die Identifier bereits mit.

## Installation

1. Den Ordner `gmod-bot-bridge` nach `garrysmod/addons/` kopieren.
2. Im Dashboard unter **Server-Monitoring → Ingest-Token** einen Token erzeugen.
3. In der `server.cfg` ergänzen:

   ```cfg
   botbridge_url   "https://dashboard.example.de"
   botbridge_token "hier-den-token-einsetzen"
   ```

4. Server neu starten. In der Konsole erscheint `[BotBridge] Aktiv – meldet an …`.

## Verknüpfung durch Spieler

1. In Discord `/steam verknuepfen` ausführen → Code erscheint.
2. Auf dem Server in den Chat schreiben: `!discord ABC123`.
3. Der Bot bestätigt per Direktnachricht.

Der Chat-Befehl lässt sich im Dashboard unter **Einstellungen → Steam-Verknüpfung**
ändern; passe ihn dann auch in `CONFIG.command` in der Lua-Datei an.

## Übertragene Daten

| Feld | Zweck |
| --- | --- |
| SteamID64 | Zuordnung zu Discord, Spielzeit |
| Spielername | Anzeige in Dashboard und Statistiken |
| Verbindungsdauer | Spielzeitberechnung |
| Frags | optionale Anzeige |

Mehr wird nicht gesendet. Der Ingest-Token gilt nur für genau einen Server und
kann im Dashboard jederzeit zurückgezogen werden.
