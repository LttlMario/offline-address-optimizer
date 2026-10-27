import { createGunzip } from 'node:zlib';
import { readFile } from 'node:fs/promises';
async function load(path) { const input = await readFile(path); return await new Promise((resolve, reject) => { const stream = createGunzip(); const chunks = []; stream.on('data', (chunk) => chunks.push(chunk)); stream.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))); stream.on('error', reject); stream.end(input); }); }
async function main() {
  const map = await load('app/offline-data/devon-map.json.gz');
  const graph = await load('app/offline-data/devon-road-graph.json.gz');
  const postcodes = await load('app/offline-data/devon-postcodes.json.gz');
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(map.region === 'Devon, England', 'map region');
  check(map.roads.length > 100000, 'road count');
  check(graph.nodes.length > 900000, 'graph nodes');
  check(graph.edges.length === graph.nodes.length, 'graph adjacency shape');
  check(graph.addresses.length > 28000, 'address count');
  check(postcodes.postcodes.length > 50000, 'postcode count');
  check(postcodes.postcodes.some((item) => item.p.replace(/\s/g, '') === 'EX25RW'), 'EX2 5RW missing');
  check(graph.addresses.filter((item) => item.p.replace(/\s/g, '') === 'EX41AL').length === 10, 'EX4 1AL sample coverage');
  for (const address of graph.addresses.slice(0, 1000)) check(Number.isInteger(address.i) && address.i >= 0 && address.i < graph.nodes.length, 'invalid address graph pointer');
  console.log(JSON.stringify({ ok: true, roads: map.roads.length, nodes: graph.nodes.length, addresses: graph.addresses.length, postcodes: postcodes.postcodes.length }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
