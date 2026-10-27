import { loadOfflineMap, offlineReady, resolveOfflineAddress, calculateOfflineRoute } from './offline.mjs';

const $ = (id) => document.getElementById(id);
let stops = [];
let map;
let roadLayer;
let routeLayer;
let stopLayer;
let offlineMap;
let startOverride = null;

function normalize(value) { return value.trim().replace(/\s+/g, ' '); }

function initMap() {
  map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([50.72, -3.53], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  stopLayer = L.layerGroup().addTo(map);
}

function roadStyle(kind) {
  const colors = { motorway: '#ff9e6d', trunk: '#f0c46d', primary: '#e6e0a3', secondary: '#b7d9c8', tertiary: '#93b5ab', residential: '#78958e', service: '#5d7771' };
  return { color: colors[kind] || '#77948d', weight: kind === 'motorway' || kind === 'trunk' ? 3 : kind === 'primary' ? 2 : 1, opacity: .82, lineCap: 'round' };
}

async function loadMap() {
  if (roadLayer) return;
  $('map-status').textContent = 'se încarcă datele offline…';
  offlineMap = await loadOfflineMap();
  const groups = new Map();
  for (const road of offlineMap.roads || []) { const lines = groups.get(road.h) || []; lines.push(road.c.map(([lon, lat]) => [lat, lon])); groups.set(road.h, lines); }
  roadLayer = L.layerGroup();
  for (const [kind, lines] of groups) L.polyline(lines, roadStyle(kind)).bindTooltip(kind).addTo(roadLayer);
  roadLayer.addTo(map);
  map.fitBounds([[offlineMap.bounds[0], offlineMap.bounds[1]], [offlineMap.bounds[2], offlineMap.bounds[3]]], { padding: [8, 8] });
  $('map-status').textContent = `${(offlineMap.roads || []).length.toLocaleString('ro-RO')} străzi offline încărcate`;
}

function refreshSelectors() { $('status').textContent = `${stops.length} adrese intermediare`; }

function renderStops() {
  const list = $('route'); list.replaceChildren(); stopLayer?.clearLayers();
  stops.forEach((stop, index) => {
    const item = document.createElement('li'); item.textContent = `${index + 1}. ${stop.address}${stop.lat == null ? ' — coordonate lipsă' : ''}`; list.append(item);
    if (stop.lat != null && map) L.circleMarker([stop.lat, stop.lon], { radius: 6, color: '#10211d', fillColor: '#31b58e', fillOpacity: 1, weight: 2 }).bindTooltip(`${index + 1}. ${stop.address}`).addTo(stopLayer);
  });
  $('summary').textContent = stops.length ? `${stops.length} adrese intermediare` : '—'; refreshSelectors();
}

async function addAddresses() {
  const incoming = $('addresses').value.split(/\r?\n|\t/).map(normalize).filter(Boolean);
  const seen = new Set(stops.map((stop) => stop.address.toLocaleLowerCase())); let added = 0, unresolved = 0;
  $('notice').className = 'notice'; $('notice').textContent = 'Se caută adresele în indexul offline…';
  for (const address of incoming) {
    if (seen.has(address.toLocaleLowerCase())) continue;
    try { const resolved = await resolveOfflineAddress(address); stops.push({ address: resolved.display_name, lat: resolved.lat, lon: resolved.lon }); }
    catch { stops.push({ address }); unresolved++; }
    seen.add(address.toLocaleLowerCase()); added++;
  }
  $('addresses').value = ''; $('notice').className = unresolved ? 'notice error' : 'notice ok'; $('notice').textContent = `${added} adrese adăugate${unresolved ? `; ${unresolved} fără coordonate offline` : ''}.`; renderStops();
}

async function optimize() {
  if (!startOverride && !$('start-address').value.trim()) { $('notice').className = 'notice error'; $('notice').textContent = 'Adaugă adresa de plecare sau folosește locația mea.'; return; }
  if (!stops.length && !$('finish-address').value.trim()) { $('notice').className = 'notice error'; $('notice').textContent = 'Adaugă cel puțin o adresă intermediară sau o adresă finală.'; return; }
  $('notice').className = 'notice'; $('notice').textContent = 'Se calculează traseul pe graful rutier offline…';
  try {
    const start = startOverride || await resolveOfflineAddress($('start-address').value);
    const finish = $('finish-address').value.trim() ? await resolveOfflineAddress($('finish-address').value) : null;
    const selected = [start, ...stops];
    const result = await calculateOfflineRoute(selected);
    const ordered = result.order.map((index) => selected[index]);
    if (finish) {
      const tail = await calculateOfflineRoute([ordered.at(-1), finish]);
      result.distance += tail.distance; result.duration += tail.duration;
      result.geometry.coordinates.push(...tail.geometry.coordinates.slice(1));
      ordered.push(finish);
    }
    const finalAddress = finish?.display_name;
    const routeStops = ordered.map((stop) => ({ address: stop.display_name || stop.address, lat: stop.lat, lon: stop.lon }));
    stops = routeStops.slice(1, finalAddress ? -1 : undefined);
    $('start-address').value = routeStops[0]?.address || '';
    if (finalAddress) $('finish-address').value = routeStops.at(-1)?.address || '';
    if (routeLayer) routeLayer.remove(); routeLayer = L.geoJSON(result.geometry, { style: { color: '#31e0ad', weight: 5, opacity: .9 } }).addTo(map); map.fitBounds(routeLayer.getBounds(), { padding: [18, 18] });
    $('notice').className = 'notice ok'; $('notice').textContent = `Traseu offline calculat: ${result.distance.toFixed(1)} km, aproximativ ${(result.duration * 60).toFixed(0)} minute.`; renderStops();
  } catch (error) { $('notice').className = 'notice error'; $('notice').textContent = error.message; }
}

initMap();
try { const pending = JSON.parse(localStorage.getItem('offline-optimizer-pending-addresses') || '[]'); if (Array.isArray(pending)) { stops = pending.map((item) => ({ address: item.display_name, lat: item.lat, lon: item.lon })); localStorage.removeItem('offline-optimizer-pending-addresses'); } } catch { /* stocarea poate fi indisponibilă în mod privat */ }
$('add').addEventListener('click', addAddresses); $('optimize').addEventListener('click', optimize); $('load-map').addEventListener('click', () => loadMap().catch((error) => { $('map-status').textContent = error.message; }));
$('download-offline').addEventListener('click', async () => { $('map-status').textContent = 'se descarcă harta și graful offline…'; $('notice').className = 'notice'; $('notice').textContent = 'Lasă pagina deschisă până apare confirmarea.'; try { await Promise.all([loadMap(), offlineReady()]); $('map-status').textContent = 'resurse offline pregătite'; $('notice').className = 'notice ok'; $('notice').textContent = 'Harta, indexul de adrese și graful de rutare sunt salvate pe acest dispozitiv.'; } catch (error) { $('map-status').textContent = 'descărcarea a eșuat'; $('notice').className = 'notice error'; $('notice').textContent = error.message; } });
$('start-address').addEventListener('input', () => { startOverride = null; });
$('use-location').addEventListener('click', () => {
  if (!navigator.geolocation) { $('notice').className = 'notice error'; $('notice').textContent = 'Acest telefon/browser nu oferă locație GPS.'; return; }
  $('notice').className = 'notice'; $('notice').textContent = 'Se solicită locația GPS…';
  navigator.geolocation.getCurrentPosition((position) => { startOverride = { display_name: 'Locația mea', lat: position.coords.latitude, lon: position.coords.longitude }; $('start-address').value = 'Locația mea'; $('notice').className = 'notice ok'; $('notice').textContent = 'Locația actuală a fost setată ca plecare.'; }, () => { $('notice').className = 'notice error'; $('notice').textContent = 'Nu am putut accesa locația. Permite GPS-ul și încearcă din nou.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
});
$('clear').addEventListener('click', () => { stops = []; startOverride = null; $('start-address').value = ''; $('finish-address').value = ''; routeLayer?.remove(); renderStops(); });
renderStops();
