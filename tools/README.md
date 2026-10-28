# Generare pachete offline

Pachetele de regiune se generează din extracte `.osm.pbf` OpenStreetMap:

```text
py tools/build-region.py --pbf data/build/romania-latest.osm.pbf --region "România" --slug romania --out-dir data/packages/romania
```

Rezultatul conține harta rutieră, indexul adreselor și graful pentru rutare locală. Fișierele mari se distribuie ca asset-uri de release, nu în istoricul Git.

## Index autorizat local (opțional)

Pentru un CSV/ZIP AddressBase Core sau PAF obținut legal, generează pachetul privat:

```text
py tools/import-authoritative-addresses.py "C:\\cale\\AddressBaseCore_Devon.csv.zip"
```

Fișierul rezultat `app/offline-data/devon-addresses-local.json.gz` este ignorat de git și nu este publicat. La rularea locală, aplicația îl combină cu indexul OSM și îl folosește pentru căutare și rutare offline.
