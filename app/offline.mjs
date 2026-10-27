let graphPromise;
let roadsPromise;
let mapPromise;
const OFFLINE_CACHE = 'optimizator-offline-data-v1';

async function cachedOfflineFetch(path) {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (response.ok) {
      if ('caches' in window) { const cache = await caches.open(OFFLINE_CACHE); await cache.put(path, response.clone()); }
      return response;
    }
  } catch { /* încearcă apoi cache-ul local */ }
  if ('caches' in window) { const cached = await caches.match(path); if (cached) return cached; }
  throw new Error('Datele offline nu sunt descărcate pe acest dispozitiv. Conectează-te o dată la internet și apasă „Descarcă harta offline Devon”.');
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function loadGraph() {
  if (graphPromise) return graphPromise;
  graphPromise = cachedOfflineFetch('./offline-data/devon-road-graph.json.gz').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const graph = await new Response(stream).json();
    graph.grid = new Map();
    graph.nodes.forEach(([lat, lon], index) => {
      const key = `${Math.floor(lat * 100)},${Math.floor(lon * 100)}`;
      const bucket = graph.grid.get(key) || [];
      bucket.push(index);
      graph.grid.set(key, bucket);
    });
    graph.addressesNormalized = graph.addresses.map((address) => ({ ...address, key: normalize(`${address.n} ${address.s} ${address.p} ${address.c}`) }));
    return graph;
  });
  return graphPromise;
}

export async function loadOfflineRoads() {
  if (roadsPromise) return roadsPromise;
  roadsPromise = cachedOfflineFetch('./offline-data/devon-roads-preview.json.gz').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const payload = await new Response(stream).json();
    return { type: 'FeatureCollection', features: (payload.segments || []).map((segment) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment.map(([lat, lon]) => [lon, lat]) } })) };
  });
  return roadsPromise;
}

export async function loadOfflineMap() {
  if (mapPromise) return mapPromise;
  mapPromise = cachedOfflineFetch('./offline-data/devon-map.json.gz').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    return new Response(stream).json();
  });
  return mapPromise;
}

function nearestNode(graph, lat, lon) {
  let best = { index: -1, distance: Infinity };
  const row = Math.floor(lat * 100);
  const col = Math.floor(lon * 100);
  for (let radius = 0; radius <= 8; radius += 1) {
    for (let r = row - radius; r <= row + radius; r += 1) for (let c = col - radius; c <= col + radius; c += 1) {
      const bucket = graph.grid.get(`${r},${c}`) || [];
      bucket.forEach((index) => {
        const [nodeLat, nodeLon] = graph.nodes[index];
        const dx = (nodeLon - lon) * Math.cos((nodeLat + lat) * Math.PI / 360) * 111320;
        const dy = (nodeLat - lat) * 110540;
        const distance = Math.hypot(dx, dy);
        if (distance < best.distance) best = { index, distance };
      });
    }
    if (best.distance < 250) break;
  }
  if (best.index < 0 || best.distance > 2000) throw new Error('Locația este în afara grafului rutier offline Devon. Alege un punct de pe hartă.');
  return best;
}

function dijkstra(graph, start, targets) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const pending = [];
  const targetSet = new Set(targets);
  const push = (item) => { pending.push(item); let index = pending.length - 1; while (index) { const parent = Math.floor((index - 1) / 2); if (pending[parent][0] <= pending[index][0]) break; [pending[parent], pending[index]] = [pending[index], pending[parent]]; index = parent; } };
  const pop = () => { const first = pending[0]; const last = pending.pop(); if (pending.length && last) { pending[0] = last; let index = 0; while (true) { const left = index * 2 + 1; const right = left + 1; let smallest = index; if (left < pending.length && pending[left][0] < pending[smallest][0]) smallest = left; if (right < pending.length && pending[right][0] < pending[smallest][0]) smallest = right; if (smallest === index) break; [pending[index], pending[smallest]] = [pending[smallest], pending[index]]; index = smallest; } } return first; };
  const settled = new Set();
  push([0, start]);
  while (pending.length) {
    const [currentDistance, current] = pop();
    if (settled.has(current) || currentDistance !== (distances.get(current) ?? Infinity)) continue;
    settled.add(current);
    if (targetSet.has(current) && [...targetSet].every((target) => distances.has(target))) break;
    for (const [neighbor, weight] of graph.edges[current] || []) {
      const candidate = currentDistance + Number(weight);
      if (candidate < (distances.get(neighbor) ?? Infinity)) { distances.set(neighbor, candidate); previous.set(neighbor, current); push([candidate, neighbor]); }
    }
  }
  return { distances, previous };
}

function pathFor(previous, start, end) {
  const path = [end];
  while (path[0] !== start) { const parent = previous.get(path[0]); if (parent === undefined) return []; path.unshift(parent); }
  return path;
}

export async function resolveOfflineAddress(input) {
  const graph = await loadGraph();
  const query = normalize(input);
  const exact = graph.addressesNormalized.find((address) => address.key === query) || graph.addressesNormalized.find((address) => query.includes(normalize(`${address.n} ${address.s}`)));
  if (!exact) throw new Error(`Adresa nu există în indexul offline Devon: ${input}. Alege locația direct de pe hartă sau valideaz-o online o singură dată.`);
  const [lat, lon] = graph.nodes[exact.i];
  const displayName = [exact.n, exact.s, exact.p, exact.c].filter(Boolean).join(', ');
  return { lat, lon, input, display_name: displayName, postcode: exact.p || '', city: exact.c || 'Devon', countryCode: 'gb', needsReview: false, offline: true };
}

export async function searchOfflineAddresses(input, limit = 8) {
  const graph = await loadGraph();
  const query = normalize(input);
  if (query.length < 3) return [];
  const toResult = (address) => { const [lat, lon] = graph.nodes[address.i]; const displayName = [address.n, address.s, address.p, address.c].filter(Boolean).join(', '); return { input: displayName, display_name: displayName, lat, lon, street: address.s, number: address.n, postcode: address.p, city: address.c }; };
  const postcodeQuery = query.replace(/\s/g, '');
  const postcodeMatches = graph.addressesNormalized.filter((address) => normalize(address.p).replace(/\s/g, '') === postcodeQuery);
  if (postcodeMatches.length) return postcodeMatches.sort((a, b) => String(a.n).localeCompare(String(b.n), undefined, { numeric: true })).map(toResult).slice(0, Math.max(limit, postcodeMatches.length));
  const terms = query.split(' ').filter(Boolean);
  const editDistance = (left, right) => {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) { let diagonal = row[0]; row[0] = i; for (let j = 1; j <= right.length; j += 1) { const above = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)); diagonal = above; } }
    return row[right.length];
  };
  return graph.addressesNormalized
    .map((address) => {
      const words = address.key.split(' '); let score = 0;
      for (const term of terms) { if (address.key.includes(term)) score += term.length >= 4 ? 18 : 10; else if (words.some((word) => word.length > 3 && editDistance(term, word) <= (term.length > 6 ? 2 : 1))) score += 6; else return { address, score: 0 }; }
      if (address.key.startsWith(query)) score += 14;
      if (address.p && normalize(address.p) === query) score += 35;
      return { address, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.address.key.localeCompare(b.address.key))
    .slice(0, limit)
    .map(({ address }) => toResult(address));
}

export async function calculateOfflineRoute(points, returnStart = false) {
  const graph = await loadGraph();
  const snapped = points.map((point) => nearestNode(graph, Number(point.lat), Number(point.lon)));
  const remaining = new Set(points.slice(1).map((_, index) => index + 1));
  const order = [0];
  const geometry = [];
  let distance = 0;
  let current = 0;
  while (remaining.size) {
    const result = dijkstra(graph, snapped[current].index, [...remaining].map((index) => snapped[index].index));
    let next = -1;
    let best = Infinity;
    remaining.forEach((index) => { const value = result.distances.get(snapped[index].index) ?? Infinity; if (value < best) { best = value; next = index; } });
    if (next < 0 || !Number.isFinite(best)) throw new Error('Nu există legătură rutieră offline între toate locațiile.');
    const segment = pathFor(result.previous, snapped[current].index, snapped[next].index);
    if (!geometry.length) geometry.push(...segment); else geometry.push(...segment.slice(1));
    distance += best;
    order.push(next);
    remaining.delete(next);
    current = next;
  }
  if (returnStart) {
    const result = dijkstra(graph, snapped[current].index, [snapped[0].index]);
    const best = result.distances.get(snapped[0].index) ?? Infinity;
    if (!Number.isFinite(best)) throw new Error('Nu există drum offline de revenire la plecare.');
    const segment = pathFor(result.previous, snapped[current].index, snapped[0].index);
    geometry.push(...segment.slice(1));
    distance += best;
    order.push(0);
  }
  const coordinates = geometry.map((index) => [graph.nodes[index][1], graph.nodes[index][0]]);
  return { order, distance, duration: distance / 8.3, geometry: { type: 'LineString', coordinates }, provider: 'Offline Devon', snappedMeters: snapped.map((point) => point.distance) };
}

export async function offlineReady() { await loadGraph(); return true; }

export async function prepareOfflineDevon() { await Promise.all([loadGraph(), loadOfflineRoads()]); return true; }

export function canUseOfflineDevon(points) {
  return Array.isArray(points) && points.length > 1 && points.every((point) => {
    const lat = Number(point?.lat); const lon = Number(point?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 50.205337 && lat <= 51.245173 && lon >= -4.657921 && lon <= -2.879576;
  });
}
