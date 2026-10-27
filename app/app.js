import { loadOfflineMap, loadOfflinePostcodes, offlineReady, resolveOfflineAddress, searchOfflineAddresses, calculateOfflineRoute } from './offline.mjs';

const $ = (id) => document.getElementById(id);
let stops = [];
let map;
let roadLayer;
let routeLayer;
let stopLayer;
let offlineMap;
let startOverride = null;
let suggestionTimer;

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

async function addSingleAddress() { const input = $('single-address'); const address = normalize(input.value); if (!address) return; $('notice').className = 'notice'; $('notice').textContent = 'Se verifică adresa în indexul offline…'; try { const resolved = await resolveOfflineAddress(address); if (!stops.some((stop) => stop.address.toLocaleLowerCase() === resolved.display_name.toLocaleLowerCase())) stops.push({ address: resolved.display_name, lat: resolved.lat, lon: resolved.lon }); input.value = ''; $('notice').className = 'notice ok'; $('notice').textContent = 'Adresa a fost adăugată.'; renderStops(); } catch (error) { $('notice').className = 'notice error'; $('notice').textContent = error.message; } }
function updateSuggestions(input) { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(async () => { const query = input.value.trim(); if (query.length < 3) return; try { const items = await searchOfflineAddresses(query, 50); const datalist = $('offline-address-options'); datalist.replaceChildren(...items.slice(0, 50).map((item) => new Option(item.display_name))); } catch { /* adresa poate fi verificată ulterior */ } }, 180); }

async function optimize() {
  if (!startOverride && !$('start-address').value.trim()) { $('notice').className = 'notice error'; $('notice').textContent = 'Adaugă adresa de plecare sau folosește locația mea.'; return; }
  if (!stops.length && !$('finish-address').value.trim()) { $('notice').className = 'notice error'; $('notice').textContent = 'Adaugă cel puțin o adresă intermediară sau o adresă finală.'; return; }
  $('notice').className = 'notice'; $('notice').textContent = 'Se calculează traseul pe graful rutier offline…';
  try {
    const start = startOverride || await resolveOfflineAddress($('start-address').value);
    const finish = $('finish-address').value.trim() ? await resolveOfflineAddress($('finish-address').value) : null;
    const allPoints = [start, ...stops, ...(finish ? [finish] : [])];
    const pointKeys = allPoints.map((point) => `${Number(point.lat).toFixed(6)},${Number(point.lon).toFixed(6)}`);
    const duplicates = pointKeys.filter((key, index) => pointKeys.indexOf(key) !== index);
    if (duplicates.length) throw new Error('Există adrese cu aceeași locație. Elimină duplicatele înainte de optimizare.');
    if (allPoints.length > 250) { $('notice').textContent = `Se calculează o rută mare cu ${allPoints.length} puncte; pagina rămâne deschisă până la final.`; }
    const selected = [start, ...stops];
    const result = await calculateOfflineRoute(selected);
    const ordered = result.order.map((index) => selected[index]);
    if (finish) {
      const tail = await calculateOfflineRoute([ordered.at(-1), finish]);
      result.distance += tail.distance; result.duration += tail.duration;
      result.geometry.coordinates.push(...(result.geometry.coordinates.length ? tail.geometry.coordinates.slice(1) : tail.geometry.coordinates));
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

function routeState() { return { version: 1, savedAt: new Date().toISOString(), start: startOverride || { address: $('start-address').value.trim() }, finish: $('finish-address').value.trim(), stops }; }
function applyRouteState(state) { if (!state || !Array.isArray(state.stops)) throw new Error('Fișierul nu conține o rută validă.'); stops = state.stops; startOverride = state.start?.lat != null ? { display_name: state.start.display_name || state.start.address || 'Locația mea', lat: Number(state.start.lat), lon: Number(state.start.lon) } : null; $('start-address').value = startOverride?.display_name || state.start?.address || ''; $('finish-address').value = state.finish || ''; renderStops(); }
function saveRoute() { localStorage.setItem('offline-optimizer-route-v1', JSON.stringify(routeState())); $('notice').className = 'notice ok'; $('notice').textContent = 'Ruta a fost salvată pe acest dispozitiv.'; }
function restoreRoute() { const raw = localStorage.getItem('offline-optimizer-route-v1'); if (!raw) { $('notice').className = 'notice error'; $('notice').textContent = 'Nu există o rută salvată.'; return; } try { applyRouteState(JSON.parse(raw)); $('notice').className = 'notice ok'; $('notice').textContent = 'Ruta salvată a fost restaurată.'; } catch (error) { $('notice').className = 'notice error'; $('notice').textContent = error.message; } }
function exportRoute() { const blob = new Blob([JSON.stringify(routeState(), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ruta-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); }
async function importRoute(file) { const text = await file.text(); let state; if (file.name.toLowerCase().endsWith('.json')) state = JSON.parse(text); else state = { start: { address: '' }, finish: '', stops: text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^address(es)?[,;]/i.test(line)).map((address) => ({ address })) }; applyRouteState(state); $('notice').className = 'notice ok'; $('notice').textContent = `${stops.length} adrese importate. Verifică-le înainte de optimizare.`; }

initMap();
try { const pending = JSON.parse(localStorage.getItem('offline-optimizer-pending-addresses') || '[]'); if (Array.isArray(pending)) { stops = pending.map((item) => ({ address: item.display_name, lat: item.lat, lon: item.lon })); localStorage.removeItem('offline-optimizer-pending-addresses'); } } catch { /* stocarea poate fi indisponibilă în mod privat */ }
$('add').addEventListener('click', addAddresses); $('optimize').addEventListener('click', optimize); $('load-map').addEventListener('click', () => loadMap().catch((error) => { $('map-status').textContent = error.message; }));
$('add-single').addEventListener('click', addSingleAddress); $('single-address').addEventListener('input', (event) => updateSuggestions(event.target)); $('start-address').addEventListener('input', (event) => { startOverride = null; updateSuggestions(event.target); }); $('finish-address').addEventListener('input', (event) => updateSuggestions(event.target));
$('download-offline').addEventListener('click', async () => { $('map-status').textContent = 'se descarcă harta și graful offline…'; $('notice').className = 'notice'; $('notice').textContent = 'Lasă pagina deschisă până apare confirmarea.'; try { await Promise.all([loadMap(), offlineReady(), loadOfflinePostcodes()]); $('map-status').textContent = 'resurse offline pregătite'; $('notice').className = 'notice ok'; $('notice').textContent = 'Harta, indexul de adrese, postcodurile și graful de rutare sunt salvate pe acest dispozitiv.'; } catch (error) { $('map-status').textContent = 'descărcarea a eșuat'; $('notice').className = 'notice error'; $('notice').textContent = error.message; } });
$('use-location').addEventListener('click', () => {
  if (!navigator.geolocation) { $('notice').className = 'notice error'; $('notice').textContent = 'Acest telefon/browser nu oferă locație GPS.'; return; }
  $('notice').className = 'notice'; $('notice').textContent = 'Se solicită locația GPS…';
  navigator.geolocation.getCurrentPosition((position) => { startOverride = { display_name: 'Locația mea', lat: position.coords.latitude, lon: position.coords.longitude }; $('start-address').value = 'Locația mea'; $('notice').className = 'notice ok'; $('notice').textContent = 'Locația actuală a fost setată ca plecare.'; }, () => { $('notice').className = 'notice error'; $('notice').textContent = 'Nu am putut accesa locația. Permite GPS-ul și încearcă din nou.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
});
$('clear').addEventListener('click', () => { stops = []; startOverride = null; $('start-address').value = ''; $('finish-address').value = ''; routeLayer?.remove(); renderStops(); });
$('save-route').addEventListener('click', saveRoute); $('restore-route').addEventListener('click', restoreRoute); $('export-route').addEventListener('click', exportRoute); $('import-route').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importRoute(file).catch((error) => { $('notice').className = 'notice error'; $('notice').textContent = error.message; }); event.target.value = ''; });
renderStops();
