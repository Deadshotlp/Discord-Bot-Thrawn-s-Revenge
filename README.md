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
    voiceStateUpdate.js
  modules/
    index.js
    support/
      index.js
      commands/
        supportDepartment.js
      services/
        cases.js
        config.js
        panel.js
        provisioning.js
    verify/
      index.js
      commands/
        verifyPanel.js
      services/
        panel.js
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
- `/verify-panel`
- `/support-department`

## Modulverwaltung

- Mit `/setup-panel` öffnest du die zentrale Modulverwaltung.
- Module können pro Server individuell ein- oder ausgeschaltet werden.
- Für aktive Module gibt es Konfigurationsoptionen (Verify und Support).
- Basiswerte sind hinterlegt; fehlende Rollen/Channel werden automatisch erstellt.

## Verhalten beim Guild-Join

Wenn `AUTO_SETUP_CHANNEL_ON_GUILD_JOIN=true` gesetzt ist:

- Der Bot erstellt (falls nötig) den Setup-Channel aus `SETUP_CHANNEL_NAME`.
- Anschließend postet er dort die zentrale Modulverwaltung.
- Verify-Standardwerte (Rolle/Channel) werden nur erstellt, wenn das Verify-Modul aktiviert ist.
- Support-Standardwerte (Warteraum/Verwaltung/Talks) werden nur erstellt, wenn das Support-Modul aktiviert ist.

## Verifizierung

- Im Verify-Channel steht ein Regeltext.
- Das Verify-Panel enthält den Button `Regeln akzeptieren und verifizieren`.
- Beim Klick auf den Button wird die konfigurierte Verify-Rolle vergeben.
- Wenn Verify aktiviert ist und keine IDs gesetzt sind, erstellt der Bot automatisch:
- eine Rolle mit `VERIFY_DEFAULT_ROLE_NAME`
- einen Text-Channel mit `VERIFY_DEFAULT_CHANNEL_NAME`

## Support

- Ein Support-Department besteht aus mehreren Rollen.
- Bei Join in den Support-Warteraum wird automatisch ein Fall im Verwaltungschannel erstellt.
- Dort kann ein Supporter den Fall claimen.
- Beim Claim werden Supporter und Nutzer in einen freien Support-Talk verschoben.
- Während des Falls gibt es Aktionen über das Panel:
- Eskalieren (pingt ein anderes Department)
- Fall schließen (beide werden aus Voice entfernt)
- Transkript (erstellt eine Falldatei im Verwaltungschannel)
- Departments können mit `/support-department` verwaltet werden (`add`, `add-role`, `remove`, `set-default`, `list`).

## Module erweitern

1. Neues Modul unter `src/modules/<modulname>` anlegen.
2. `commands` und optional `events` exportieren.
3. Modul in `src/modules/index.js` registrieren.

So bleibt die Struktur klar getrennt und skalierbar.
