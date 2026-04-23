# Thrawn's Revenge Discord Bot

Der Bot wurde vollständig zurückgesetzt und als modulare Basisstruktur neu aufgebaut.

## Ziel

Ein sauberer Startpunkt, auf dem neue Features als eigenständige Module entwickelt werden können.

## Neue Struktur

```text
src/
  config/
    env.js
  core/
    logger.js
    moduleRuntime.js
    permissions.js
  events/
    registerEvents.js
    ready.js
    interactionCreate.js
    guildCreate.js
  modules/
    index.js
    system/
      index.js
      commands/
        ping.js
        botInfo.js
    setup/
      index.js
      commands/
        setupPanel.js
      services/
        ensureSetupChannel.js
        panel.js
  index.js
```

## Schnellstart

1. `.env` aus `.env.example` erstellen.
2. `DISCORD_TOKEN` eintragen.
3. Abhängigkeiten installieren:

```bash
npm install
```

4. Bot starten:

```bash
npm run start
```

## Verfügbare Commands

- `/ping`
- `/bot-info`
- `/setup-panel`

## Verhalten beim Guild-Join

Wenn `AUTO_SETUP_CHANNEL_ON_GUILD_JOIN=true` gesetzt ist:

- Der Bot erstellt (falls nötig) den Setup-Channel aus `SETUP_CHANNEL_NAME`.
- Anschließend postet er dort ein Setup-Panel.

## Module erweitern

1. Neues Modul unter `src/modules/<modulname>` anlegen.
2. `commands` und optional `events` exportieren.
3. Modul in `src/modules/index.js` registrieren.

So bleibt die Struktur klar getrennt und skalierbar.
