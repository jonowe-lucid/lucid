# Apple Health MCP Server

Ein MCP-Server, der deine Apple Health Exportdaten in Claude verfügbar macht. Damit kannst du deine Gesundheitsdaten direkt in Claude analysieren, Trends erkennen und Fragen zu deinen Daten stellen.

## Features

- **Schritte, Herzfrequenz, Gewicht** und 30+ weitere Gesundheitsmetriken
- **Workouts** — Lauf-, Rad-, Schwimm- und alle anderen Trainingseinheiten
- **Tägliche Aggregation** — automatische Zusammenfassung pro Tag (Summe oder Durchschnitt)
- **Trend-Vergleich** — vergleiche zwei Zeiträume miteinander
- **Suche** — finde Daten nach Typ, Quelle oder Datum

## Setup

### 1. Apple Health Daten exportieren

1. Öffne die **Health-App** auf deinem iPhone
2. Tippe auf dein **Profilbild** (oben rechts)
3. Scrolle nach unten und tippe auf **Alle Gesundheitsdaten exportieren**
4. Warte bis der Export fertig ist und speichere die ZIP-Datei
5. Entpacke die ZIP-Datei — du brauchst die Datei `Export.xml`

### 2. Server installieren

```bash
git clone <this-repo>
cd lucid
npm install
npm run build
```

### 3. In Claude Desktop konfigurieren

Füge folgendes zu deiner Claude Desktop Config hinzu (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-health": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/lucid/dist/index.js"]
    }
  }
}
```

### 4. In Claude Code konfigurieren

Füge in deiner `.mcp.json` hinzu:

```json
{
  "mcpServers": {
    "apple-health": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/lucid/dist/index.js"]
    }
  }
}
```

## Nutzung

Starte ein Gespräch mit Claude und sage z.B.:

1. **Daten laden:** "Lade meine Apple Health Daten von `/Users/ich/Export.xml`"
2. **Übersicht:** "Zeig mir eine Zusammenfassung meiner Gesundheitsdaten"
3. **Schritte:** "Wie viele Schritte bin ich im letzten Monat gelaufen?"
4. **Herzfrequenz:** "Wie hat sich meine Ruheherzfrequenz entwickelt?"
5. **Workouts:** "Zeig mir meine Lauf-Trainings der letzten Wochen"
6. **Trends:** "Vergleiche meine Schritte im Januar mit Februar"

## Verfügbare Tools

| Tool | Beschreibung |
|------|-------------|
| `load_health_data` | Lädt eine Apple Health Export.xml Datei |
| `health_summary` | Übersicht über alle geladenen Daten |
| `query_health_metric` | Abfrage einer bestimmten Metrik (Schritte, HR, etc.) |
| `query_workouts` | Workouts abfragen und filtern |
| `health_trends` | Zwei Zeiträume vergleichen |
| `search_health_data` | Daten nach Typ, Quelle oder Datum durchsuchen |

## Unterstützte Metriken

Schritte, Herzfrequenz, Ruheherzfrequenz, HRV, Gewicht, Größe, BMI, Körperfett, Aktive Kalorien, Ruhe-Kalorien, Geh-/Laufdistanz, Raddistanz, Stockwerke, Trainingszeit, Stehzeit, Blutsauerstoff, Blutdruck, Atemfrequenz, Körpertemperatur, Blutzucker, Ernährungsdaten (Kalorien, Protein, Kohlenhydrate, Fett, Wasser, Koffein), VO2 Max, Gehgeschwindigkeit, Schrittlänge, Umgebungslautstärke, Kopfhörerlautstärke, Schlafanalyse, Achtsamkeit, Stehhours und mehr.
