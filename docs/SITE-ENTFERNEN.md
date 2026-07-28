# Alte Website rückstandsfrei entfernen

Checkliste für das Ablösen einer nicht mehr genutzten Site (hier: „sf“).
Das Web-Verzeichnis ist bereits gelöscht – übrig sind typischerweise
nginx-Konfiguration, Zertifikat, Dienste, Logs und DNS-Einträge.

**Reihenfolge einhalten:** erst Bestandsaufnahme, dann entfernen. Jeder
Löschschritt hat unten eine vorgelagerte Prüfung.

---

## 1. Bestandsaufnahme (nur lesend)

Alle Befehle sind ungefährlich. Sammle die Ausgaben, bevor du etwas löschst.

**Welche Sites sind aktiv?**

```bash
ls -l /etc/nginx/sites-enabled/ /etc/nginx/sites-available/
```

**Wo taucht „sf“ in der nginx-Konfiguration auf?**

```bash
sudo grep -rn "sf" /etc/nginx/ --include="*.conf" --include="*" -l
```

**Welche Domains bedient nginx aktuell?**

```bash
sudo nginx -T 2>/dev/null | grep -E "^\s*(server_name|root|proxy_pass)"
```

Das ist die verlässlichste Quelle – `nginx -T` zeigt die tatsächlich geladene
Konfiguration inklusive aller Includes.

**Zertifikate:**

```bash
sudo certbot certificates
```

**Dienste, die zur alten Site gehören könnten:**

```bash
systemctl list-units --type=service --all | grep -i -E "sf|node|pm2"
```

```bash
pm2 list 2>/dev/null || echo "kein pm2"
```

**Geplante Aufgaben:**

```bash
crontab -l 2>/dev/null; sudo crontab -l 2>/dev/null; ls -l /etc/cron.d/
```

**Übrig gebliebene Verzeichnisse:**

```bash
ls -la /var/www/
```

**Datenbanken (falls die Site eine hatte):**

```bash
sudo mysql -e "SHOW DATABASES;" 2>/dev/null || echo "kein MySQL/MariaDB"
```

```bash
sudo -u postgres psql -c "\l" 2>/dev/null || echo "kein PostgreSQL"
```

---

## 2. nginx-Konfiguration entfernen

Zuerst nur deaktivieren, nicht löschen – so ist ein Rückzieher möglich:

```bash
sudo rm /etc/nginx/sites-enabled/<sf-config-name>
```

Der Symlink in `sites-enabled` ist die Aktivierung; die Originaldatei in
`sites-available` bleibt vorerst bestehen.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Prüfen, dass die restlichen Sites weiterlaufen. Erst wenn alles stimmt, die
Vorlage löschen:

```bash
sudo rm /etc/nginx/sites-available/<sf-config-name>
```

Ist die alte Site die `default`-Site gewesen, darf sie nicht ersatzlos
verschwinden, sonst beantwortet nginx Anfragen an unbekannte Hostnamen mit der
erstbesten Site. In dem Fall stattdessen einen leeren Catch-All anlegen:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
```

---

## 3. Zertifikat entfernen

**Nicht** die Verzeichnisse unter `/etc/letsencrypt/` von Hand löschen – dabei
bleiben Renewal-Konfigurationen zurück, die später bei jedem Erneuerungslauf
Fehler werfen. Stattdessen:

```bash
sudo certbot delete --cert-name <name-aus-certbot-certificates>
```

Certbot räumt `live/`, `archive/` und `renewal/` gemeinsam auf.

Danach:

```bash
sudo certbot renew --dry-run
```

Der Testlauf muss ohne Fehler durchlaufen.

---

## 4. Dienste und Aufgaben

Falls die Site ein eigener Node-/PHP-Dienst war:

```bash
sudo systemctl status <dienstname>
```

```bash
sudo systemctl disable --now <dienstname>
```

```bash
sudo rm /etc/systemd/system/<dienstname>.service && sudo systemctl daemon-reload
```

Bei pm2:

```bash
pm2 delete <name> && pm2 save
```

Cron-Einträge (Backups, Deploys, Sitemap-Generatoren) entsprechend entfernen.

---

## 5. Logs

Die Log-Dateien der alten Site werden von nginx nicht mehr beschrieben, belegen
aber weiter Platz und werden von logrotate mitgeschleppt:

```bash
ls -la /var/log/nginx/ | grep -i sf
```

```bash
sudo rm /var/log/nginx/<sf>*.log*
```

Falls es eine eigene logrotate-Regel gab:

```bash
ls -la /etc/logrotate.d/
```

---

## 6. Was gern vergessen wird

- **DNS-Einträge** beim Registrar: A/AAAA/CNAME der alten Subdomain löschen.
  Solange sie auf den Server zeigen, kann jemand über den alten Namen auf die
  Standard-Site landen.
- **Datenbank und DB-Benutzer**, falls vorhanden. Vorher ein Dump anlegen:
  `sudo mysqldump <db> > ~/sf-final.sql`
- **Deploy-Keys** in GitHub/GitLab und der zugehörige `~/.ssh/authorized_keys`-Eintrag.
- **fail2ban-Jails** oder `.htpasswd`-Dateien, die auf die alte Site verwiesen.
- **Monitoring/Uptime-Checks**, die jetzt dauerhaft Alarm schlagen würden.
- **Backups**: alte Snapshots enthalten die Site weiterhin – das ist meist
  gewollt, sollte aber bewusst entschieden sein.

---

## 7. Abschlussprüfung

```bash
sudo nginx -T 2>/dev/null | grep -c "server_name"
```

```bash
curl -sI https://<verbliebene-domain>/ | head -1
```

```bash
sudo systemctl status nginx --no-pager
```

Erwartet: nur noch die gewünschten Sites, alle liefern 200/301, nginx läuft
ohne Fehler.
