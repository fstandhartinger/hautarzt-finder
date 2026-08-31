# Hautarzt-Finder Passau

Eine passwortgeschützte Web-App zum Durchtelefonieren der Hautarztpraxen rund um
Passau — mit Karte, sortier- und filterbarer Tabelle, Anruf-Häkchen, Ergebnis-Status
und Notizfeld pro Praxis. Alle Eingaben landen in Postgres auf dem Sandy-Server.

## Datenbestand

90 dermatologische Praxen im Umkreis von 100 km um **Reichenberger Straße 2, 94036 Passau**:
Passau Stadt, Landkreis Passau, Freyung-Grafenau, Rottal-Inn, Deggendorf, Regen sowie
Oberösterreich (Schärding, Ried im Innkreis, Braunau, Rohrbach, Linz, Wels, Salzburg).

Quellen: Google-Maps-Places über die Serper-API (liefert Adresse, Koordinaten, Telefon,
Sternebewertung und Bewertungsanzahl) plus gezielte Web-Recherche für Praxen ohne
Google-Eintrag. `data/sweep-serper.py` sammelt die Rohdaten, `data/build-dataset.py`
filtert auf echte Dermatologie-Einträge, entfernt Dubletten, rechnet die Luftlinie
zum Wohnort aus und ergänzt die manuell recherchierten Praxen.

Die Entfernung ist **Luftlinie**, nicht Fahrstrecke.

## Betrieb

Environment:

| Variable | Zweck |
|---|---|
| `APP_PASSWORD` | Zugangspasswort der App (Pflicht) |
| `DATABASE_URL` | Postgres auf Sandy über PgBouncer :6432 (Pflicht) |
| `MAPBOX_TOKEN` | öffentlicher Mapbox-Token für die Karte |
| `HOME_LAT` / `HOME_LON` | Wohnort-Marker, Default Passau Reichenberger Str. 2 |
| `PORT` | Default 8080 |

Lokal:

```bash
npm install
APP_PASSWORD=… DATABASE_URL=… MAPBOX_TOKEN=… node server.js
```

Schema und Seed laufen beim Start automatisch. Der Seed aktualisiert die
Stammdaten der Praxen, lässt Häkchen und Kommentare aber unangetastet.

## Deployment

Sandy PaaS (Coolify) über den `sandy-deploy`-MCP, Dockerfile-Build.
Login-Token wird im Browser in `localStorage` (plus Cookie) abgelegt, das
Passwort ist also nur einmal nötig.
