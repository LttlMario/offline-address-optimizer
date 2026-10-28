let graphPromise;
let roadsPromise;
let mapPromise;
let postcodePromise;
const OFFLINE_CACHE = 'optimizator-offline-data-v2';

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
  graphPromise = cachedOfflineFetch('./offline-data/devon-road-graph.json.gz?v=11').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const graph = await new Response(stream).json();
    graph.grid = new Map();
    graph.nodes.forEach(([lat, lon], index) => {
      const key = `${Math.floor(lat * 100)},${Math.floor(lon * 100)}`;
      const bucket = graph.grid.get(key) || [];
      bucket.push(index);
      graph.grid.set(key, bucket);
    });
    try {
      // Pachetul AddressBase/PAF este opțional și nu este publicat. Îl citim
      // doar dacă a fost instalat în cache de utilizator, ca să nu generăm
      // cereri 404 în aplicația publică și în modul offline.
      const localUrl = './offline-data/devon-addresses-local.json.gz?v=local';
      const localResponse = 'caches' in window ? await caches.match(localUrl) : null;
      if (localResponse?.ok) {
        const localStream = localResponse.body?.pipeThrough ? localResponse.body.pipeThrough(new DecompressionStream('gzip')) : localResponse.body;
        const localPayload = await new Response(localStream).json();
        const existing = new Set(graph.addresses.map((address) => normalize(`${address.n} ${address.s} ${address.p} ${address.c}`)));
        for (const address of localPayload.addresses || []) {
          const identity = normalize(`${address.n} ${address.s} ${address.p} ${address.c}`);
          if (!identity || existing.has(identity) || !Number.isFinite(Number(address.lat)) || !Number.isFinite(Number(address.lon))) continue;
          try { const snapped = nearestNode(graph, Number(address.lat), Number(address.lon)); graph.addresses.push({ ...address, i: snapped.index }); existing.add(identity); } catch { /* ignoră punctele locale din afara grafului Devon */ }
        }
      }
    } catch { /* pachetul autorizat este opțional și rămâne local */ }
    graph.addressesNormalized = graph.addresses.map((address) => ({ ...address, key: normalize(`${address.n} ${address.s} ${address.p} ${address.c}`) }));
    graph.addressByKey = new Map(graph.addressesNormalized.map((address) => [address.key, address]));
    graph.addressesByPostcode = new Map();
    for (const address of graph.addressesNormalized) {
      const key = normalize(address.p).replace(/\s/g, '');
      if (!key) continue;
      const bucket = graph.addressesByPostcode.get(key) || [];
      bucket.push(address);
      graph.addressesByPostcode.set(key, bucket);
    }
    return graph;
  });
  return graphPromise;
}

export async function loadOfflineRoads() {
  if (roadsPromise) return roadsPromise;
  roadsPromise = cachedOfflineFetch('./offline-data/devon-roads-preview.json.gz?v=11').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const payload = await new Response(stream).json();
    return { type: 'FeatureCollection', features: (payload.segments || []).map((segment) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment.map(([lat, lon]) => [lon, lat]) } })) };
  });
  return roadsPromise;
}

export async function loadOfflineMap() {
  if (mapPromise) return mapPromise;
  mapPromise = cachedOfflineFetch('./offline-data/devon-map.json.gz?v=11').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    return new Response(stream).json();
  });
  return mapPromise;
}

export async function loadOfflinePostcodes() {
  if (postcodePromise) return postcodePromise;
  postcodePromise = cachedOfflineFetch('./offline-data/devon-postcodes.json.gz?v=11').then(async (response) => {
    const stream = response.body?.pipeThrough ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
    const payload = await new Response(stream).json();
    payload.byKey = new Map(payload.postcodes.map((item) => [normalize(item.p).replace(/\s/g, ''), item]));
    return payload;
  });
  return postcodePromise;
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
  const exact = graph.addressByKey.get(query) || graph.addressesNormalized.find((address) => query.includes(normalize(`${address.n} ${address.s}`)));
  if (!exact) {
    const postcode = (await loadOfflinePostcodes()).byKey.get(query.replace(/\s/g, ''));
    if (postcode) return { lat: postcode.lat, lon: postcode.lon, input, display_name: `${postcode.p} · punct postcode`, postcode: postcode.p, city: 'Devon', countryCode: 'gb', needsReview: true, postcodeOnly: true, offline: true };
    throw new Error(`Adresa nu există în indexul offline Devon: ${input}. Alege locația direct de pe hartă sau valideaz-o online o singură dată.`);
  }
  const [lat, lon] = graph.nodes[exact.i];
  const displayName = [exact.n, exact.s, exact.p, exact.c].filter(Boolean).join(', ');
  return { lat, lon, input, display_name: displayName, postcode: exact.p || '', city: exact.c || 'Devon', countryCode: 'gb', needsReview: false, offline: true };
}

export async function searchOfflineAddresses(input, limit = 8, options = {}) {
  const graph = await loadGraph();
  const query = normalize(input);
  if (query.length < 3) return [];
  const toResult = (address) => { const [lat, lon] = graph.nodes[address.i]; const displayName = [address.n, address.s, address.p, address.c].filter(Boolean).join(', '); return { input: displayName, display_name: displayName, lat, lon, street: address.s, number: address.n, postcode: address.p, city: address.c }; };
  const postcodeQuery = query.replace(/\s/g, '');
  const postcodeMatches = graph.addressesByPostcode.get(postcodeQuery) || [];
  if (postcodeMatches.length) return postcodeMatches.sort((a, b) => String(a.n).localeCompare(String(b.n), undefined, { numeric: true })).map((address) => ({ ...toResult(address), matchType: 'postcode-exact' })).slice(0, Math.max(limit, postcodeMatches.length));
  const postcodeData = await loadOfflinePostcodes();
  const postcodePoint = postcodeData.byKey.get(postcodeQuery);
  if (postcodePoint) return [{ input: postcodePoint.p, display_name: `${postcodePoint.p} · punct postcode (fără adresă individuală)`, lat: postcodePoint.lat, lon: postcodePoint.lon, postcode: postcodePoint.p, city: 'Devon', isPostcodePoint: true, matchType: 'postcode-point' }];
  if (/^[a-z]{1,2}\d[a-z\d]?\d[a-z]{2}$/i.test(postcodeQuery)) {
    const outward = postcodeQuery.slice(0, -3);
    const prefixMatches = graph.addressesNormalized.filter((address) => normalize(address.p).replace(/\s/g, '').startsWith(outward));
    return prefixMatches.sort((a, b) => String(a.p).localeCompare(String(b.p)) || String(a.n).localeCompare(String(b.n), undefined, { numeric: true })).map((address) => ({ ...toResult(address), matchType: 'postcode-prefix' })).slice(0, limit);
  }
  const terms = query.split(' ').filter(Boolean);
  const fuzzy = options.fuzzy !== false && (typeof window === 'undefined' || window.offlineFuzzyEnabled !== false);
  const editDistance = (left, right) => {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) { let diagonal = row[0]; row[0] = i; for (let j = 1; j <= right.length; j += 1) { const above = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)); diagonal = above; } }
    return row[right.length];
  };
  return graph.addressesNormalized
    .map((address) => {
      const words = address.key.split(' '); let score = 0;
      for (const term of terms) { if (address.key.includes(term)) score += term.length >= 4 ? 18 : 10; else if (fuzzy && words.some((word) => word.length > 3 && editDistance(term, word) <= (term.length > 6 ? 2 : 1))) score += 6; else return { address, score: 0 }; }
      if (address.key.startsWith(query)) score += 14;
      if (address.p && normalize(address.p) === query) score += 35;
      return { address, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.address.key.localeCompare(b.address.key))
    .slice(0, limit)
    .map(({ address }) => toResult(address));
}

function greedyOrder(graph, snapped) {
  const remaining = new Set(snapped.slice(1).map((_, index) => index + 1));
  const order = [0];
  const searches = new Map();
  let current = 0;
  while (remaining.size) {
    const result = dijkstra(graph, snapped[current].index, [...remaining].map((index) => snapped[index].index));
    searches.set(snapped[current].index, result);
    let next = -1;
    let best = Infinity;
    remaining.forEach((index) => { const value = result.distances.get(snapped[index].index) ?? Infinity; if (value < best) { best = value; next = index; } });
    if (next < 0 || !Number.isFinite(best)) throw new Error('Nu există legătură rutieră offline între toate locațiile.');
    order.push(next);
    remaining.delete(next);
    current = next;
  }
  return { order, searches };
}

function routeForOrder(graph, snapped, order, returnStart = false, searches = null) {
  const geometry = [];
  let distance = 0;
  const fullOrder = returnStart ? [...order, 0] : order.slice();
  for (let index = 0; index < fullOrder.length - 1; index += 1) {
    const from = fullOrder[index];
    const to = fullOrder[index + 1];
    const cached = searches?.get(snapped[from].index);
    const result = cached?.distances.has(snapped[to].index) ? cached : dijkstra(graph, snapped[from].index, [snapped[to].index]);
    const segmentDistance = result.distances.get(snapped[to].index) ?? Infinity;
    if (!Number.isFinite(segmentDistance)) throw new Error(returnStart ? 'Nu există drum offline de revenire la plecare.' : 'Nu există legătură rutieră offline între toate locațiile.');
    const segment = pathFor(result.previous, snapped[from].index, snapped[to].index);
    if (!segment.length) throw new Error('Nu există geometrie offline pentru segmentul selectat.');
    if (!geometry.length) geometry.push(...segment); else geometry.push(...segment.slice(1));
    distance += segmentDistance;
  }
  return { order: fullOrder, distance, geometry };
}

function buildRoadDistanceMatrix(graph, snapped) {
  return snapped.map((from) => {
    const targets = snapped.map((point) => point.index).filter((index) => index !== from.index);
    const result = dijkstra(graph, from.index, targets);
    return snapped.map((to) => to.index === from.index ? 0 : (result.distances.get(to.index) ?? Infinity));
  });
}

function improveOrderByRoad(matrix, order) {
  if (order.length < 4) return order;
  const improved = order.slice(); let changed = true; let pass = 0;
  const cost = (candidate) => candidate.slice(0, -1).reduce((sum, from, index) => sum + matrix[from][candidate[index + 1]], 0);
  while (changed && pass < 6) {
    changed = false; pass += 1;
    for (let left = 1; left < improved.length - 2; left += 1) {
      for (let right = left + 1; right < improved.length - 1; right += 1) {
        const candidate = improved.slice(); candidate.splice(left, right - left + 1, ...improved.slice(left, right + 1).reverse());
        if (cost(candidate) + 0.01 < cost(improved)) { improved.splice(0, improved.length, ...candidate); changed = true; }
      }
    }
  }
  return improved;
}

function straightDistance(left, right) {
  const dy = (Number(right.lat) - Number(left.lat)) * 110540;
  const dx = (Number(right.lon) - Number(left.lon)) * Math.cos((Number(left.lat) + Number(right.lat)) * Math.PI / 360) * 111320;
  return Math.hypot(dx, dy);
}

function improveOrder2Opt(points, order) {
  if (order.length < 4 || order.length > 100) return order;
  const improved = order.slice();
  let changed = true;
  let pass = 0;
  while (changed && pass < 3) {
    changed = false;
    pass += 1;
    for (let left = 1; left < improved.length - 2; left += 1) {
      for (let right = left + 1; right < improved.length - 1; right += 1) {
        const oldCost = straightDistance(points[improved[left - 1]], points[improved[left]]) + straightDistance(points[improved[right]], points[improved[right + 1]]);
        const newCost = straightDistance(points[improved[left - 1]], points[improved[right]]) + straightDistance(points[improved[left]], points[improved[right + 1]]);
        if (newCost + 0.01 < oldCost) {
          improved.splice(left, right - left + 1, ...improved.slice(left, right + 1).reverse());
          changed = true;
        }
      }
    }
  }
  return improved;
}

function greedyOrderByStraight(points) {
  const remaining = new Set(points.slice(1).map((_, index) => index + 1));
  const order = [0];
  let current = 0;
  while (remaining.size) {
    let next = -1;
    let best = Infinity;
    remaining.forEach((index) => {
      const value = straightDistance(points[current], points[index]);
      if (value < best) { best = value; next = index; }
    });
    if (next < 0) break;
    order.push(next);
    remaining.delete(next);
    current = next;
  }
  return order;
}

export async function calculateOfflineRoute(points, returnStart = false) {
  const graph = await loadGraph();
  const snapped = points.map((point) => nearestNode(graph, Number(point.lat), Number(point.lon)));
  const useRoadMatrix = snapped.length <= 18;
  const greedy = useRoadMatrix ? greedyOrder(graph, snapped) : { order: greedyOrderByStraight(points), searches: null };
  const initialOrder = greedy.order;
  const roadMatrix = useRoadMatrix ? buildRoadDistanceMatrix(graph, snapped) : null;
  const candidateOrder = roadMatrix ? improveOrderByRoad(roadMatrix, initialOrder) : improveOrder2Opt(points, initialOrder);
  let chosen;
  if (!roadMatrix) {
    // Pentru rute mari alegem o ordine compactă geografic, apoi calculăm
    // fiecare segment pe drumul real. Nu mai dublăm Dijkstra pentru baseline.
    chosen = routeForOrder(graph, snapped, candidateOrder, returnStart);
  } else {
    const baseline = routeForOrder(graph, snapped, initialOrder, returnStart, greedy.searches);
    chosen = baseline;
    if (candidateOrder.some((value, index) => value !== initialOrder[index])) {
      try {
        const candidate = routeForOrder(graph, snapped, candidateOrder, returnStart, greedy.searches);
        if (candidate.distance < baseline.distance) chosen = candidate;
      } catch { /* păstrează ordinea sigură găsită de euristica inițială */ }
    }
  }
  const coordinates = chosen.geometry.map((index) => [graph.nodes[index][1], graph.nodes[index][0]]);
  return { order: chosen.order, distance: chosen.distance, duration: chosen.distance / 8.3, geometry: { type: 'LineString', coordinates }, provider: 'Offline Devon', snappedMeters: snapped.map((point) => point.distance) };
}

export async function offlineReady() { await loadGraph(); return true; }

export async function prepareOfflineDevon() { await Promise.all([loadGraph(), loadOfflineRoads()]); return true; }

export function canUseOfflineDevon(points) {
  return Array.isArray(points) && points.length > 1 && points.every((point) => {
    const lat = Number(point?.lat); const lon = Number(point?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 50.205337 && lat <= 51.245173 && lon >= -4.657921 && lon <= -2.879576;
  });
}
