import { loadOfflineMap, resolveOfflineAddress, calculateOfflineRoute } from './offline.mjs';

const $ = (id) => document.getElementById(id);
let stops = [];
let map;
let roadLayer;
let routeLayer;
let stopLayer;
let offlineMap;

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

function refreshSelectors() {
  for (const id of ['start', 'finish']) {
    const select = $(id), old = select.value;
    select.innerHTML = id === 'start' ? '<option value="">Prima adresă introdusă</option>' : '<option value="">Ultima oprire optimizată</option>';
    stops.forEach((stop, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${stop.address}`; select.append(option); });
    select.value = old;
  }
  $('status').textContent = `${stops.length} adrese`;
}

function renderStops() {
  const list = $('route'); list.replaceChildren(); stopLayer?.clearLayers();
  stops.forEach((stop, index) => {
    const item = document.createElement('li'); item.textContent = `${index + 1}. ${stop.address}${stop.lat == null ? ' — coordonate lipsă' : ''}`; list.append(item);
    if (stop.lat != null && map) L.circleMarker([stop.lat, stop.lon], { radius: 6, color: '#10211d', fillColor: '#31b58e', fillOpacity: 1, weight: 2 }).bindTooltip(`${index + 1}. ${stop.address}`).addTo(stopLayer);
  });
  $('summary').textContent = stops.length ? `${stops.length} opriri` : '—'; refreshSelectors();
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
  if (stops.length < 2) return;
  if (stops.some((stop) => stop.lat == null)) { $('notice').className = 'notice error'; $('notice').textContent = 'Toate adresele trebuie să fie găsite în pachetul offline înainte de optimizare.'; return; }
  $('notice').className = 'notice'; $('notice').textContent = 'Se calculează traseul pe graful rutier offline…';
  try {
    const start = $('start').value === '' ? 0 : Number($('start').value);
    const finish = $('finish').value === '' ? null : Number($('finish').value);
    const selected = [stops[start], ...stops.filter((_, i) => i !== start)];
    const result = await calculateOfflineRoute(selected);
    const ordered = result.order.map((index) => selected[index]);
    if (finish !== null) { const finalAddress = stops[finish].address; const finalIndex = ordered.findIndex((stop) => stop.address === finalAddress); if (finalIndex >= 0) ordered.push(ordered.splice(finalIndex, 1)[0]); }
    stops = ordered;
    if (routeLayer) routeLayer.remove(); routeLayer = L.geoJSON(result.geometry, { style: { color: '#31e0ad', weight: 5, opacity: .9 } }).addTo(map); map.fitBounds(routeLayer.getBounds(), { padding: [18, 18] });
    $('notice').className = 'notice ok'; $('notice').textContent = `Traseu offline calculat: ${result.distance.toFixed(1)} km, aproximativ ${(result.duration * 60).toFixed(0)} minute.`; renderStops();
  } catch (error) { $('notice').className = 'notice error'; $('notice').textContent = error.message; }
}

initMap();
$('add').addEventListener('click', addAddresses); $('optimize').addEventListener('click', optimize); $('load-map').addEventListener('click', () => loadMap().catch((error) => { $('map-status').textContent = error.message; })); $('clear').addEventListener('click', () => { stops = []; routeLayer?.remove(); renderStops(); });
renderStops();
