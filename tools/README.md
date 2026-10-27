# Generare pachete offline

Pachetele de regiune se generează din extracte `.osm.pbf` OpenStreetMap:

```text
py tools/build-region.py --pbf data/build/romania-latest.osm.pbf --region "România" --slug romania --out-dir data/packages/romania
```

Rezultatul conține harta rutieră, indexul adreselor și graful pentru rutare locală. Fișierele mari se distribuie ca asset-uri de release, nu în istoricul Git.
