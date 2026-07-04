# Thrawn's Revenge Discord Bot

Der Bot wurde vollständig zurückgesetzt und als modulare Basisstruktur neu aufgebaut.

## Ziel

Ein sauberer Startpunkt, auf dem neue Features als eigenständige Module entwickelt werden können.

## Struktur

```text
src/
  config/    Env-Parsing (.env)
  core/      Logger, Modul-Laufzeit, Config-Store, Berechtigungen, gemeinsame Utils
  events/    Discord-Event-Registrierung und Dispatch an die Module
  modules/   Ein Ordner pro Feature (support, verify, setup, reactionRole,
             contentCreator, serverStatus, system) mit jeweils
             index.js, commands/, services/ und optional handlers/
  index.js   Einstiegspunkt (Client, Login, Graceful Shutdown)
```

Jedes Modul exportiert `name`, `defaultEnabled`, `defaultConfig`, `commands` und `events` und wird in `src/modules/index.js` registriert.

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

## Entwicklung

- `npm run dev` – Start mit Auto-Reload bei Dateiänderungen.
- `npm run lint` – ESLint über das gesamte Projekt.
- `npm test` – Testsuite (Node-Test-Runner).
- Bei jedem Push läuft die CI (GitHub Actions) mit Lint und Tests.

## Daten

Konfiguration und Datenbanken (SQLite) liegen im Verzeichnis `data/` im Projektordner.
Über die Umgebungsvariable `DATA_DIR` kann ein anderes Verzeichnis gesetzt werden –
z. B. für Deployments mit persistentem Volume.

## Verfügbare Commands

- `/ping`
- `/bot-info`
- `/setup-panel`
- `/verify-panel`
- `/support-department`
- `/support-department-ui`
- `/support-ticket-panel`
- `/reaction-role`
- `/server-status`
- `/wochenbericht`
- `/meeting`
- `/meeting-admin`

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
- Über `/support-ticket-panel` kann ein Ticket-Panel gepostet werden.
- Tickets werden über einen Button gestartet.
- Nach dem Button wählen Nutzer das Department im Dropdown.
- Danach geben Nutzer Ticket-Name und Beschreibung an.
- Das Ticket-System nutzt die Department-Rollen aus dem Support-Modul für Kanalzugriff und Benachrichtigung.
- Tickets können über den Ticket-Button auf ein anderes Department eskaliert werden.
- Eine Ticket-Eskalation ist nur für Mitglieder des aktuellen Ticket-Departments möglich.
- Beim Schließen eines Tickets wird automatisch ein Transkript erstellt.
- Während des Falls gibt es Aktionen über das Panel:
- Eskalieren (pingt ein anderes Department)
- Fall schließen (beide werden aus Voice entfernt)
- Transkript (erstellt eine Falldatei im Verwaltungschannel)
- Departments können mit `/support-department` (Slash-Command) oder `/support-department-ui` (Interface) verwaltet werden.

## Sprach-Transkripte (Support-Talks)

Optionale Funktion: Support-Gespräche im Talk-Channel werden lokal transkribiert
(kein Cloud-Dienst, keine laufenden Kosten). Der Bot nutzt dafür `whisper.cpp`.

**Ablauf**

- Nach dem Claim postet der Bot im Talk-Channel eine Zustimmungs-Anfrage.
- Die Aufnahme startet **erst, wenn alle Teilnehmer zustimmen** (Button); es wird
  nur aufgenommen, wer zugestimmt hat. Ein Indikator zeigt die laufende Aufnahme an.
- Beim Schließen des Falls (oder über „Aufnahme beenden") wird das Gespräch
  transkribiert und als Datei im Transkript-/Verwaltungs-Channel gepostet.
- Die Audio-Daten werden nach der Transkription gelöscht; nur der Text bleibt.

> **Rechtlicher Hinweis:** Das Aufzeichnen von Gesprächen ohne Einwilligung aller
> Beteiligten ist in Deutschland strafbar (§ 201 StGB). Die Zustimmungsabfrage darf
> nicht umgangen werden.

**Einrichtung (auch im Wings-/Pterodactyl-Container)**

Es wird keine Root-Installation benötigt – Binary, Bibliotheken und Modell liegen
einfach im Server-Verzeichnis:

1. `whisper.cpp` besorgen. Am einfachsten das fertige Linux-Release
   (`whisper-bin-ubuntu-x64` aus den GitHub-Releases): den **kompletten Ordner**
   hochladen, denn `whisper-cli` ist dynamisch gelinkt und braucht die
   mitgelieferten `.so`-Dateien (`libwhisper.so`, `libggml*.so`) **im selben Ordner**.
   `whisper-cli` ausführbar machen (`chmod +x`).
2. Ein Modell herunterladen, z. B. `ggml-medium-q5_0.bin` (sehr gute Deutsch-Qualität,
   ~1,5 GB RAM bei Transkription) oder `ggml-small-q5_1.bin` (~600 MB), z. B. von
   `https://huggingface.co/ggerganov/whisper.cpp`.
3. In der `.env` setzen:
   - `WHISPER_BINARY_PATH=/home/container/whisper-bin-ubuntu-x64/whisper-cli`
   - `WHISPER_MODEL_PATH=/home/container/ggml-medium-q5_0.bin`
   - optional `WHISPER_LIB_DIR`, falls die `.so`-Dateien **nicht** neben der Binary
     liegen (Standard: Ordner der Binary).
   - optional `WHISPER_THREADS` (Standard 2) und `WHISPER_LANGUAGE` (Standard `de`).

Der Bot setzt beim Aufruf automatisch `LD_LIBRARY_PATH` auf den Ordner der Binary
(bzw. `WHISPER_LIB_DIR`), damit die Bibliotheken gefunden werden. Sind beide Pfade
gesetzt und die Dateien vorhanden, aktiviert sich das Feature automatisch.
Transkriptionen laufen seriell in einer Warteschlange, damit der Bot-Prozess nicht
überlastet wird.

Vor dem Aktivieren im Container testen (findet die Binary ihre Bibliotheken?):

```bash
cd /home/container/whisper-bin-ubuntu-x64
LD_LIBRARY_PATH=. ./whisper-cli --help
```

Kommt die Usage-Ausgabe, passt alles. Kommt `error while loading shared libraries:
libwhisper.so.1`, fehlen die `.so`-Dateien neben der Binary.

## Wochenberichte

- Die Leiter der Support-Departments geben formatierte Textblöcke ab; zum konfigurierten
  Termin werden alle Abgaben zusammengeführt und veröffentlicht.
- Leiter-Rollen werden pro Department gesetzt: über `/support-department set-leads`
  oder den Button `Leiter setzen` in `/support-department-ui`.
- Abgabe mit `/wochenbericht abgeben` (Modal, Markdown möglich, bis 3900 Zeichen).
  Erneutes Absenden überschreibt die Abgabe; leeres Absenden löscht sie.
- Abgaben zählen zur laufenden Kalenderwoche; nach dem Veröffentlichungstermin
  beginnt automatisch die nächste Berichtswoche.
- Veröffentlichung: Kopfzeile mit Kalenderwoche + ein Embed pro Department
  (fehlende Abgaben werden als „Keine Abgabe" markiert).
- Konfiguration über das Setup-Panel: Channel, Wochentag, Uhrzeit sowie eine
  optionale Erinnerung (Standard: 24 h vorher pingt der Bot die Leiter-Rollen
  der Departments ohne Abgabe).
- `/wochenbericht vorschau` zeigt Leitern und Admins die aktuelle Fassung,
  `/wochenbericht veroeffentlichen` veröffentlicht sofort (nur Admins).
- Wurde der Termin verpasst (Bot offline), wird die Vorwoche automatisch
  nachveröffentlicht, sobald der Bot wieder läuft.

## Meetings (regelmäßige Treffen)

- Beliebig viele Meetings pro Server, konfiguriert über `/meeting-admin` (Admins)
  oder den Setup-Panel-Button „Meetings verwalten".
- Pro Meeting einstellbar: Name, Ankündigungs-Channel, Voice-Channel, Rhythmus
  (Wochentag + Uhrzeit + Intervall in Wochen), Vorlaufzeit, Teilnehmer-Rollen
  (dürfen an-/abmelden und zählen in der Auswertung) und Organisator-Rollen.
- **Ankündigung:** Zum Vorlaufzeitpunkt (Standard 24 h vorher) postet der Bot eine
  Ankündigung mit Agenda und Buttons „Anmelden" / „Abmelden" / „Thema einreichen"
  und pingt die Teilnehmer-Rollen.
- **An-/Abmeldung:** Über die Buttons oder `/meeting anmelden` / `/meeting abmelden`.
  Die Listen werden in der Ankündigung live aktualisiert.
- **Auswertung:** 5 Minuten nach Beginn postet der Bot automatisch die Anwesenheit:
  - ✅ **Anwesend** = im Voice-Channel
  - 📝 **Entschuldigt** = vorher abgemeldet
  - ❌ **Unentschuldigt** = angemeldet, aber nicht erschienen und nicht abgemeldet
- **Themen:** Teilnehmer reichen Themen per Button oder `/meeting thema` ein. Nach
  der Sitzung werden einmalige Themen verbraucht; als **Dauerthema** markierte
  Themen (🔁) kehren automatisch wieder. Organisatoren ändern Reihenfolge und
  Dauerthema-Status unter „Themen" im Meeting-Menü.
- `/meeting status` zeigt Termin, Agenda und An-/Abmeldezahlen.

## Reaction-Roles

- Mit `/reaction-role` wird ein Panel mit Rollen-Buttons erstellt (Emoji + Rolle).
- Klick auf einen Button vergibt oder entfernt die zugehörige Rolle beim Nutzer.

## Content-Creator-Benachrichtigungen

- Überwacht YouTube-Kanäle und Twitch-Streamer per Polling (Intervall über `CREATOR_POLL_INTERVAL_SECONDS`).
- Postet bei neuen Videos/Streams eine Ankündigung im konfigurierten Channel, optional mit Rollen-Ping.
- Konfiguration (Channel, Rollen, beobachtete Kanäle) läuft über das Setup-Panel.
- Erfordert `YOUTUBE_API_KEY` bzw. `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` in der `.env`.

## Server-Status (Game-Server-Monitoring)

- Fragt den Status eines Source-Engine-Servers (z. B. Garry's Mod) per A2S-Query-Protokoll ab (UDP, kein Server-Addon nötig).
- `/server-status` zeigt sofort den aktuellen Status: Online/Offline, Map, Spielerzahl, Connect-Befehl.
- Optional ein live aktualisiertes Status-Panel in einem festen Channel (wird per Setup-Panel konfiguriert).
- Speichert alle `SERVER_STATUS_POLL_INTERVAL_SECONDS` (Standard 300s) einen Snapshot in einer eigenen SQLite-Datenbank.
- Zeigt einen 7-Tage-Verlauf (Peak/Durchschnitt pro Tag) als Chart-Bild im Panel, gerendert über die QuickChart.io-Bild-API.
- Verlaufsdaten werden nach 30 Tagen automatisch bereinigt.
- "Direct Connect"-Button mit `steam://connect/ip:port`; falls Discord den Button ablehnt, bleibt der `connect ip:port`-Text als Fallback im Embed.

## Module erweitern

1. Neues Modul unter `src/modules/<modulname>` anlegen.
2. `commands` und optional `events` exportieren.
3. Modul in `src/modules/index.js` registrieren.

So bleibt die Struktur klar getrennt und skalierbar.
