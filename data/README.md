# Pachete de date offline

Formatul planificat pentru fiecare regiune este un pachet versionat, comprimat și verificat cu checksum:

```json
{
  "version": 1,
  "region": "Devon, England",
  "bounds": [minLon, minLat, maxLon, maxLat],
  "addresses": [{"id":"...","label":"...","street":"...","number":"...","lat":0,"lon":0}],
  "roads": [{"id":"...","name":"...","class":"residential","geometry":[[lon,lat],[lon,lat]]}]
}
```

Datele trebuie generate din extracte OpenStreetMap și actualizate separat de aplicație. Nu se introduc date de hartă MAPS.ME sau binare MWM în acest repository.
