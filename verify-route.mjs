import { createGunzip } from 'node:zlib';
import { readFile } from 'node:fs/promises';

async function loadGraph() {
  const input = await readFile('app/offline-data/devon-road-graph.json.gz');
  return await new Promise((resolve, reject) => {
    const stream = createGunzip();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    stream.on('error', reject);
    stream.end(input);
  });
}

function dijkstra(graph, start, target) {
  const distances = new Map([[start, 0]]);
  const pending = [[0, start]];
  const push = (item) => { pending.push(item); let index = pending.length - 1; while (index) { const parent = Math.floor((index - 1) / 2); if (pending[parent][0] <= pending[index][0]) break; [pending[parent], pending[index]] = [pending[index], pending[parent]]; index = parent; } };
  const pop = () => { const first = pending[0]; const last = pending.pop(); if (pending.length && last) { pending[0] = last; let index = 0; while (true) { const left = index * 2 + 1; const right = left + 1; let smallest = index; if (left < pending.length && pending[left][0] < pending[smallest][0]) smallest = left; if (right < pending.length && pending[right][0] < pending[smallest][0]) smallest = right; if (smallest === index) break; [pending[index], pending[smallest]] = [pending[smallest], pending[index]]; index = smallest; } } return first; };
  while (pending.length) {
    const [distance, node] = pop();
    if (distance !== (distances.get(node) ?? Infinity)) continue;
    if (node === target) return distance;
    for (const [neighbor, weight] of graph.edges[node] || []) {
      const next = distance + Number(weight);
      if (next < (distances.get(neighbor) ?? Infinity)) { distances.set(neighbor, next); push([next, neighbor]); }
    }
  }
  return Infinity;
}

const graph = await loadGraph();
const key = (address) => `${address.n} ${address.s} ${address.p} ${address.c}`;
const samples = ['20 Cowick Street', '21 Cowick Street', '30 Cowick Street'].map((needle) => graph.addresses.find((address) => key(address).startsWith(`${needle} `)));
if (samples.some((address) => !address)) throw new Error('sample route addresses missing');
const legs = samples.slice(0, -1).map((address, index) => dijkstra(graph, address.i, samples[index + 1].i));
if (legs.some((distance) => !Number.isFinite(distance) || distance <= 0)) throw new Error('sample route is not connected on the directed graph');
const total = legs.reduce((sum, distance) => sum + distance, 0);
if (total > 10000) throw new Error(`sample route unexpectedly long: ${total}`);
console.log(JSON.stringify({ ok: true, legs: legs.map((distance) => Number(distance.toFixed(1))), total: Number(total.toFixed(1)) }));
