import csv
import gzip
import json
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'build' / 'codepoint'
OUT = ROOT / 'data' / 'packages' / 'devon' / 'devon-postcodes.json.gz'
BOUNDS = (50.205337, -4.657921, 51.245173, -2.879576)
transform = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
rows = []
for name in ('ex', 'pl', 'ta', 'tq'):
    path = SOURCE / 'Data' / 'CSV' / f'{name}.csv'
    if not path.exists(): continue
    with path.open(newline='', encoding='utf-8-sig') as handle:
        for row in csv.reader(handle):
            if len(row) < 4: continue
            postcode = row[0].strip().upper(); easting, northing = float(row[2]), float(row[3]); lon, lat = transform.transform(easting, northing)
            if BOUNDS[0] <= lat <= BOUNDS[2] and BOUNDS[1] <= lon <= BOUNDS[3]: rows.append({'p': postcode, 'lat': round(lat, 6), 'lon': round(lon, 6)})
rows.sort(key=lambda item: item['p'])
unique = {item['p']: item for item in rows}
OUT.parent.mkdir(parents=True, exist_ok=True)
with gzip.open(OUT, 'wb', compresslevel=9) as handle: handle.write(json.dumps({'version': 1, 'region': 'Devon, England', 'source': 'OS Code-Point Open', 'postcodes': list(unique.values())}, separators=(',', ':')).encode())
print(json.dumps({'postcodes': len(unique), 'compressed_bytes': OUT.stat().st_size}))
