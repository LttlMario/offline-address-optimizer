# Offline Address Optimizer

Optimizator separat pentru adrese, construit pentru utilizare offline pe telefon.

## Domeniu

- import rapid de adrese, CSV/JSON sau lipire în bloc;
- deduplicare și detectarea intrărilor incomplete;
- alegerea punctului de plecare și a ultimei opriri;
- optimizarea ordinii adreselor fără întoarcere automată;
- calcul local, fără API plătit și fără calculator pornit;
- pachete de hartă și index offline generate din OpenStreetMap;
- interfață pregătită pentru instalare ca PWA pe iPhone/Android.

Nu include curieri, vehicule, capacități, colete sau fluxuri de livrare.

## Legătura cu MAPS.ME

Repository-ul [mapsme/omim](https://github.com/mapsme/omim) este folosit ca referință pentru arhitectura offline: indexare locală, pachete de hartă, căutare fără rețea și rutare locală. Nu copiem binare MWM sau date proprietare. Datele geografice vor fi generate din OpenStreetMap, iar orice cod preluat va păstra licența și notificările originale.

## Stare

Prima versiune stabilește nucleul de optimizare independent de interfața de hartă. Următorul pas este pachetul de hartă offline pentru zonele necesare și indexul complet de adrese.

## Pornire locală

Deschide `app/index.html` printr-un server static local sau publică folderul `app/` pe GitHub Pages. Pentru testarea offline, deschide pagina o dată online și apoi instaleaz-o pe telefon.
