"""Build a private Devon address package from an authorised OS/PAF CSV export.

The generated file is intentionally ignored by git. It is for local use only.
Accepted columns include the common AddressBase/PAF names: UPRN, POSTCODE,
ADDRESS, BUILDING_NUMBER, BUILDING_NAME, THOROUGHFARE, POST_TOWN, LATITUDE,
LONGITUDE, X_COORDINATE and Y_COORDINATE.
"""
import argparse, csv, gzip, json, math, pathlib, re, zipfile

DEVON_BOUNDS = (50.15, 51.35, -4.8, -2.75)

def clean(value):
    return re.sub(r"\s+", " ", str(value or "").strip())

def key(value):
    return re.sub(r"[^A-Z0-9]", "", clean(value).upper())

def first(row, *names):
    lowered = {str(k).strip().upper(): v for k, v in row.items()}
    for name in names:
        value = lowered.get(name.upper())
        if value not in (None, ""):
            return clean(value)
    return ""

def osgb_to_wgs84(easting, northing):
    # Airy 1830 / British National Grid to WGS84, adequate for address points.
    a, b, F0 = 6377563.396, 6356256.909, 0.9996012717
    lat0, lon0, N0, E0 = math.radians(49), math.radians(-2), -100000, 400000
    e2 = 1 - (b * b) / (a * a); n = (a - b) / (a + b); lat = lat0; M = 0
    while abs(float(northing) - N0 - M) >= 0.00001:
        lat = (float(northing) - N0 - M) / (a * F0) + lat
        M = b * F0 * ((1 + n + 5*n*n/4 + 5*n**3/4) * (lat-lat0)
            - (3*n + 3*n*n + 21*n**3/8) * math.sin(lat-lat0) * math.cos(lat+lat0)
            + (15*n*n/8 + 15*n**3/8) * math.sin(2*(lat-lat0)) * math.cos(2*(lat+lat0))
            - (35*n**3/24) * math.sin(3*(lat-lat0)) * math.cos(3*(lat+lat0)))
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    nu = a * F0 / math.sqrt(1 - e2 * sin_lat**2); rho = a * F0 * (1-e2) / (1-e2*sin_lat**2)**1.5
    eta2 = nu/rho - 1; dE = float(easting) - E0
    VII = math.tan(lat)/(2*rho*nu); VIII = math.tan(lat)/(24*rho*nu**3) * (5 + 3*math.tan(lat)**2 + eta2 - 9*math.tan(lat)**2*eta2)
    IX = math.tan(lat)/(720*rho*nu**5) * (61 + 90*math.tan(lat)**2 + 45*math.tan(lat)**4)
    X = 1/(cos_lat*nu); XI = 1/(cos_lat*6*nu**3) * (nu/rho + 2*math.tan(lat)**2)
    XII = 1/(cos_lat*120*nu**5) * (5 + 28*math.tan(lat)**2 + 24*math.tan(lat)**4)
    lat = lat - VII*dE**2 + VIII*dE**4 - IX*dE**6
    lon = lon0 + X*dE - XI*dE**3 + XII*dE**5
    return math.degrees(lat), math.degrees(lon)

def rows_from(path):
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            csvs = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if not csvs: raise SystemExit("ZIP-ul nu conține CSV.")
            with archive.open(csvs[0]) as handle:
                yield from csv.DictReader((line.decode("utf-8-sig", "replace") for line in handle))
    else:
        with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as handle:
            yield from csv.DictReader(handle)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path, help="CSV sau ZIP cu CSV AddressBase/PAF")
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("app/offline-data/devon-addresses-local.json.gz"))
    args = parser.parse_args()
    result, seen = [], set()
    for row in rows_from(args.source):
        postcode = first(row, "POSTCODE", "POST_CODE")
        if not postcode or key(postcode) in ("",): continue
        lat = first(row, "LATITUDE", "LAT"); lon = first(row, "LONGITUDE", "LON", "LNG")
        if not lat or not lon:
            east, north = first(row, "X_COORDINATE", "EASTING"), first(row, "Y_COORDINATE", "NORTHING")
            if east and north:
                try: lat, lon = map(str, osgb_to_wgs84(float(east), float(north)))
                except ValueError: continue
        if not lat or not lon: continue
        lat, lon = float(lat), float(lon)
        if not (DEVON_BOUNDS[0] <= lat <= DEVON_BOUNDS[1] and DEVON_BOUNDS[2] <= lon <= DEVON_BOUNDS[3]): continue
        number = first(row, "BUILDING_NUMBER", "BUILDING_NAME", "SUB_BUILDING_NAME", "ADDRESS")
        street = first(row, "THOROUGHFARE", "STREET", "STREET_NAME")
        town = first(row, "POST_TOWN", "TOWN", "LOCALITY", "POSTAL_TOWN")
        display = first(row, "ADDRESS", "FORMATTED_ADDRESS") or ", ".join(x for x in (number, street, town, postcode) if x)
        identity = (key(display), key(postcode), round(lat, 6), round(lon, 6))
        if not display or identity in seen: continue
        seen.add(identity); result.append({"n": number, "s": street, "p": postcode, "c": town, "display": display, "lat": lat, "lon": lon, "source": "authoritative-local", "uprn": first(row, "UPRN")})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.out, "wt", encoding="utf-8") as handle: json.dump({"source": "private-authoritative-local", "addresses": result}, handle, separators=(",", ":"))
    print(json.dumps({"addresses": len(result), "output": str(args.out)}))

if __name__ == "__main__": main()
