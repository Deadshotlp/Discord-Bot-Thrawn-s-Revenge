# Ideen für weitere Funktionen

Sortiert nach Aufwand-Nutzen-Verhältnis. Jede Idee ist so beschrieben, dass sie
sich als eigenes Modul bzw. eigener Dashboard-Bereich umsetzen lässt.

---

## Kurzfristig (kleiner Aufwand, sofort spürbar)

### 1. Schichtplan / Support-Dienstplan
Aufbauend auf Departments und Abmeldungen: Wer hat wann Support-Dienst?
Der Bot pingt zum Schichtbeginn, erkennt Lücken (alle abgemeldet) und warnt die
Leitung. Kombination aus Abmeldungen und Primetime-Daten aus dem Monitoring
zeigt, wann Dienste wirklich gebraucht werden.

### 2. Ticket-Warteschlange mit SLA
Offene Tickets ohne Reaktion nach X Minuten eskalieren automatisch: Ping an die
Department-Rolle, danach an die Leitung. Im Dashboard eine „Was ist überfällig“-
Ansicht. Datenbasis ist bereits vorhanden.

### 3. Ticket-Bewertung
Nach dem Schließen bekommt der Ersteller eine kurze Bewertung per Button
(1–5 Sterne + optionaler Kommentar). Fließt in die Team-Statistik ein und macht
Qualität sichtbar, nicht nur Menge.

### 4. Server-Wartungsmodus
Geplante Wartung im Dashboard eintragen. Der Bot kündigt sie an, unterdrückt in
dem Zeitraum die Offline-Warnungen und markiert die Lücke im Verlauf als
„geplant“, damit die Uptime-Statistik nicht verfälscht wird.

### 5. Rekord-Meldungen
Neuer Spielerrekord auf einem Server → automatische Ankündigung mit Vergleich
zum alten Rekord. Motiviert die Community und kostet fast nichts, da die Daten
schon erfasst werden.

### 6. Rollen-Belohnung nach Spielzeit
Ab X Stunden Spielzeit automatisch eine Rolle vergeben (Stammspieler, Veteran).
Baut direkt auf der Steam-Verknüpfung auf.

### 7. Persönliche Statistik-Karte
`/meinestats` zeigt Spielzeit, Lieblingsserver, Primetime und – für Teammitglieder
– die eigenen Ticketzahlen. Als Bild oder Embed.

---

## Mittelfristig (eigenes Modul)

### 8. Bewerbungssystem
Bewerbungen als Formular im Dashboard (öffentlicher Link, ohne Discord-Login
ausfüllbar). Eingang landet als Vorgang im Team-Bereich mit Status-Workflow
(offen → Gespräch → angenommen/abgelehnt), Kommentaren und Zuständigkeit.
Ersetzt Bewerbungs-Tickets, die dafür nie richtig gepasst haben.

### 9. Warn- und Sanktionssystem
Verwarnungen, Timeouts, Bans zentral erfassen – Discord und Gameserver
gemeinsam, verknüpft über die SteamID. Historie pro Person, automatische
Eskalationsstufen, Ablaufdatum. Im Dashboard durchsuchbar.

### 10. Gameserver-Fernsteuerung (RCON)
Neustart, Map-Wechsel, Kick/Ban und Konsolenbefehle direkt aus dem Dashboard –
mit Rechteprüfung und vollständigem Protokoll, wer was ausgelöst hat. Kein
zusätzlicher Fernzugriff für das Team nötig.

### 11. Onboarding-Strecke für neue Teammitglieder
Checkliste pro Department (Regeln gelesen, Steam verknüpft, Einweisung gemacht).
Der Bot begleitet neue Mitglieder, die Leitung sieht den Fortschritt.

### 12. Umfragen und Abstimmungen
Umfragen im Dashboard anlegen, in Discord als Buttons posten, Ergebnisse mit
Diagramm auswerten. Optional auf Rollen beschränkt (z. B. nur Teamabstimmung)
und mit Verknüpfung zu Meeting-Themen.

### 13. Event-Kalender
Community-Events planen, ankündigen, Anmeldungen sammeln, an Discord-Events
koppeln. Teilt sich die Termin-Infrastruktur mit dem Meeting-Modul.

### 14. Öffentliche Serverstatus-Seite
Eine ohne Login erreichbare Seite mit Live-Status, Spielerzahlen und Uptime –
verlinkbar von der Website. Das Datenmodell ist bereits vorhanden, es fehlt nur
eine öffentliche Route (`publicStats` ist im Monitoring-Modul schon vorgesehen).

### 15. Backup und Konfigurations-Export
Ein-Klick-Export aller Servereinstellungen als JSON und Wiederherstellung
daraus. Nützlich für Umzüge und als Absicherung vor Fehlkonfiguration.

---

## Längerfristig (größere Vorhaben)

### 16. Spielerprofile mit Server-Historie
Zusammenführung aller Daten zu einer Person: Discord, Steam, Spielzeit,
Tickets, Verwarnungen, Bewerbungen. Für das Team die eine Ansicht, die vorher
fünf Klicks in fünf Systemen war. Braucht ein sauberes Berechtigungskonzept.

### 17. Automatische Berichte
Wöchentlicher oder monatlicher Report als PDF/Embed: Spielerentwicklung,
Ticketaufkommen, Team-Auslastung, Uptime. Ergänzt die Wochenberichte um die
Zahlen, die der Bot ohnehin kennt.

### 18. Wirtschafts-/Ingame-Anbindung
Ingame-Währung, Shop oder Spielstände im Dashboard einsehen – über dieselbe
Ingest-Schnittstelle wie die Spielzeit. Sinnvoll, sobald das Gamemode-Projekt
entsprechende Daten liefert.

### 19. Anti-Raid und Moderationshilfen
Erkennung von Join-Wellen, Massen-Erwähnungen und Einweg-Accounts, automatische
Gegenmaßnahmen mit Protokoll. Standardfunktion großer Bots, die hier fehlt.

### 20. Mehrsprachigkeit
Texte in Sprachdateien auslagern (aktuell fest auf Deutsch). Erst sinnvoll, wenn
der Bot auf Servern mit internationaler Community läuft.

### 21. Benachrichtigungen außerhalb von Discord
Kritische Ereignisse (Server offline, Ticket-SLA gerissen) zusätzlich per
Web-Push, E-Mail oder Webhook. Damit erreicht eine Störung die Leitung auch
dann, wenn niemand Discord offen hat.

---

## Technische Verbesserungen

- **Rate-Limiting** für die öffentliche API, besonders für die Ingest-Endpunkte.
- **Metriken-Endpunkt** (Prometheus-Format) für Bot-Gesundheit und Job-Laufzeiten.
- **Testabdeckung** für die Web-Routen: aktuell werden Stores und Protokolle
  getestet, die API-Schicht nur per Smoke-Test.
- **Automatische Backups** der SQLite-Dateien vor jeder Migration.
- **Health-Check für Jobs**: erkennen, wenn ein Poller stillschweigend hängt.
