# Health MCP Servers

Zwei MCP-Server, die deine Gesundheits- und Trainingsdaten in Claude verfügbar machen:

- **Apple Health** — importiert Export.xml mit 30+ Metriken
- **Strava** — verbindet sich live mit der Strava API für Aktivitäten, Stats und Analysen

## Installation

```bash
git clone <this-repo>
cd lucid
npm install
npm run build
```

---

## 1. Apple Health MCP

### Daten exportieren

1. Öffne die **Health-App** auf deinem iPhone
2. Tippe auf dein **Profilbild** (oben rechts)
3. Scrolle nach unten → **Alle Gesundheitsdaten exportieren**
4. Entpacke die ZIP-Datei — du brauchst `Export.xml`

### Konfigurieren

```json
{
  "mcpServers": {
    "apple-health": {
      "command": "node",
      "args": ["/pfad/zu/lucid/dist/index.js"]
    }
  }
}
```

### Tools

| Tool | Beschreibung |
|------|-------------|
| `load_health_data` | Lädt eine Apple Health Export.xml Datei |
| `health_summary` | Übersicht über alle geladenen Daten |
| `query_health_metric` | Abfrage einer Metrik (Schritte, HR, Gewicht, ...) |
| `query_workouts` | Workouts abfragen und filtern |
| `health_trends` | Zwei Zeiträume vergleichen |
| `search_health_data` | Freitext-Suche über alle Daten |

### Unterstützte Metriken

Schritte, Herzfrequenz, Ruheherzfrequenz, HRV, Gewicht, Größe, BMI, Körperfett, Aktive Kalorien, Ruhe-Kalorien, Geh-/Laufdistanz, Raddistanz, Stockwerke, Trainingszeit, Stehzeit, Blutsauerstoff, Blutdruck, Atemfrequenz, Körpertemperatur, Blutzucker, Ernährung (Kalorien, Protein, Kohlenhydrate, Fett, Wasser, Koffein), VO2 Max, Gehgeschwindigkeit, Schrittlänge, Umgebungslautstärke, Kopfhörerlautstärke, Schlafanalyse, Achtsamkeit und mehr.

---

## 2. Strava MCP

### Setup

#### Schritt 1: Strava API App erstellen

1. Gehe zu [strava.com/settings/api](https://www.strava.com/settings/api)
2. Erstelle eine neue API Application
3. Setze **Authorization Callback Domain** auf `localhost`
4. Notiere **Client ID** und **Client Secret**

#### Schritt 2: Authentifizieren

```bash
npm run setup:strava
```

Das Script:
- Fragt nach Client ID und Client Secret
- Öffnet den Browser für die Strava-Autorisierung
- Speichert die Tokens automatisch in `~/.strava-tokens.json`
- Tokens werden automatisch refreshed wenn sie ablaufen

#### Schritt 3: Konfigurieren

```json
{
  "mcpServers": {
    "strava": {
      "command": "node",
      "args": ["/pfad/zu/lucid/dist/strava.js"]
    }
  }
}
```

Optional: Token-Pfad anpassen via Umgebungsvariable:

```json
{
  "mcpServers": {
    "strava": {
      "command": "node",
      "args": ["/pfad/zu/lucid/dist/strava.js"],
      "env": {
        "STRAVA_TOKEN_FILE": "/custom/pfad/tokens.json"
      }
    }
  }
}
```

### Tools

| Tool | Beschreibung |
|------|-------------|
| `strava_profile` | Athleten-Profil und Lifetime/YTD/Recent Stats |
| `strava_activities` | Aktivitäten auflisten mit Filtern (Datum, Sportart) |
| `strava_activity_detail` | Detail-Ansicht einer Aktivität (Splits, Laps, Best Efforts) |
| `strava_weekly_summary` | Wöchentliche Trainings-Zusammenfassung |
| `strava_training_analysis` | Trainingsload-Analyse (Volumen, Intensität, Trends) |

### Beispiel-Prompts

- "Zeig mir mein Strava Profil und meine Jahresstatistiken"
- "Was waren meine letzten 10 Läufe?"
- "Analysiere mein Training der letzten 3 Monate"
- "Zeig mir die Details von meinem letzten Lauf mit Splits"
- "Wie hat sich mein wöchentliches Laufvolumen entwickelt?"

---

## Beide Server zusammen nutzen

Du kannst beide Server gleichzeitig in Claude konfigurieren:

```json
{
  "mcpServers": {
    "apple-health": {
      "command": "node",
      "args": ["/pfad/zu/lucid/dist/index.js"]
    },
    "strava": {
      "command": "node",
      "args": ["/pfad/zu/lucid/dist/strava.js"]
    }
  }
}
```

So kannst du Claude z.B. fragen: *"Vergleiche meine Apple Health Herzfrequenzdaten mit meinen Strava-Laufdaten der letzten Wochen."*
