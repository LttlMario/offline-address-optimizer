# Arhitectură

## Principii

1. Datele locale sunt sursa principală după ce pachetul este descărcat.
2. Optimizarea nu depinde de geocodare sau de un API.
3. Adresele sunt tratate ca puncte, iar ordinea este calculată pe coordonate verificate.
4. Oprirea finală este explicită și nu se adaugă automat depozitul.

## Inspirat de MAPS.ME

OMIM separă generatorul de date, indexarea, stocarea și rutarea. Păstrăm aceeași separare la nivel de proiect:

- `data/` — pachete compacte de hartă și index;
- `app/` — interfață și optimizare în browser;
- viitorul `tools/` — conversie OSM și verificări de integritate.

Aplicația web nu va încerca să redea direct formatul MWM. Pentru telefon, pachetul nostru va folosi un format web compact și controlat de noi, cu versiune, checksum și migrare clară.

## Limite corecte

Offline înseamnă datele existente în pachetul descărcat. Nu există trafic live, străzi închise temporar sau confirmarea unui număr de casă care nu apare în OpenStreetMap. Aplicația trebuie să arate clar când o adresă nu are coordonate verificate.
