import { createGunzip } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const gunzip = promisify(createGunzip);
async function load(path) { return JSON.parse((await gunzip(await readFile(path))).toString('utf8')); }
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
