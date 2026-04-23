# Thrawn's Revenge Discord Bot

Modularer Discord-Bot in JavaScript mit:

- automatischem Setup bei Server-Join
- konfigurierbaren Channel- und Rollen-IDs per Discord-UI
- SQLite-basierter Server-Konfiguration
- Basis-Logging (Join/Leave, Nachrichten, Voice)

## Schnellstart

Falls Node.js und npm noch nicht installiert sind (Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Empfohlen ist jedoch Node 20 ueber NVM, damit native Pakete wie better-sqlite3 stabil laufen:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
```

Im Projekt kann die Version mit `.nvmrc` automatisch genutzt werden:

```bash
nvm use
```

1. Node.js 20+ installieren.
2. Datei `.env` aus `.env.example` erstellen.
3. Token in `.env` eintragen.
4. Abhaengigkeiten installieren:

```bash
npm install
```

5. Bot starten:

```bash
npm run start
```

## Berechtigungen

Empfohlene Bot-Rechte:

- View Channels
- Send Messages
- Manage Channels
- Manage Roles
- Manage Messages
- Read Message History

## Setup-Flow

Beim Join auf einen neuen Server versucht der Bot, einen privaten Setup-Channel (`bot-setup`) anzulegen und dort Konfigurations-Panels zu posten. Nur Admins koennen die Werte anpassen.

Die ausgewaehlten Werte werden erst aktiv umgesetzt, wenn im Setup-Panel der Button `Konfiguration anwenden` geklickt wird.

## Departments (dynamisch)

Das Ticketsystem nutzt keine festen Departments mehr. Departments werden manuell per Slash-Commands verwaltet und koennen mehrere Rollen enthalten.

- `/department create name:<name>`
- `/department role-add department:<name-oder-id> rolle:<rolle>`
- `/department role-remove department:<name-oder-id> rolle:<rolle>`
- `/department delete department:<name-oder-id>`
- `/department list`

Hinweise:

- Tickets werden fortlaufend pro Server nummeriert.
- Tickets koennen nur von Mitgliedern mit der konfigurierten Standard-Teamrolle geschlossen oder eskaliert werden.

Optionaler manueller Start per Slash-Command: `/setup-panel`.
