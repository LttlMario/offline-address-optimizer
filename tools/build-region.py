import argparse
import gzip
import json
import math
from pathlib import Path

import osmium

ALLOWED = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road"}

class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.nodes = {}; self.addresses = []; self.ways = []
    def node(self, node):
        if not node.location.valid(): return
        lat, lon = round(float(node.location.lat), 6), round(float(node.location.lon), 6)
        self.nodes[node.id] = (lat, lon)
        tags = dict(node.tags)
        if tags.get("addr:housenumber") and (tags.get("addr:street") or tags.get("addr:place")):
            self.addresses.append({"n": tags.get("addr:housenumber", ""), "s": tags.get("addr:street") or tags.get("addr:place", ""), "p": tags.get("addr:postcode", ""), "c": tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or tags.get("addr:municipality", ""), "i": node.id})
    def way(self, way):
        highway = way.tags.get("highway")
        if highway not in ALLOWED: return
        refs = [node.ref for node in way.nodes if node.ref in self.nodes]
        if len(refs) < 2: return
        self.ways.append({"r": refs, "n": way.tags.get("name", ""), "h": highway, "o": way.tags.get("oneway", "")})

def distance(a, b):
    lat1, lon1 = a; lat2, lon2 = b
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)); y = math.radians(lat2 - lat1)
    return 6371000 * math.sqrt(x * x + y * y)

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--pbf", required=True); parser.add_argument("--region", required=True); parser.add_argument("--slug", required=True); parser.add_argument("--out-dir", required=True); args = parser.parse_args()
    out = Path(args.out_dir); out.mkdir(parents=True, exist_ok=True)
    extract = Extract(); extract.apply_file(args.pbf, locations=True)
    used = {node_id for way in extract.ways for node_id in way["r"]}; node_ids = sorted(used); index = {node_id: i for i, node_id in enumerate(node_ids)}
    nodes = [[extract.nodes[node_id][0], extract.nodes[node_id][1]] for node_id in node_ids]; edges = [[] for _ in node_ids]; seen = set()
    roads = []
    for way in extract.ways:
        refs = way["r"]; coords = [[extract.nodes[node_id][1], extract.nodes[node_id][0]] for node_id in refs]; roads.append({"n": way["n"], "h": way["h"], "c": coords})
        reverse = str(way["o"]).lower() == "-1"; oneway = str(way["o"]).lower() in {"yes", "true", "1", "-1"}
        pairs = list(zip(refs, refs[1:]));
        if reverse: pairs = [(b, a) for a, b in pairs]
        for left, right in pairs:
            a, b = index[left], index[right]; metres = round(distance(extract.nodes[left], extract.nodes[right]), 1)
            edge = (a, b, metres)
            if edge not in seen: edges[a].append([b, metres]); seen.add(edge)
            if not oneway:
                reverse_edge = (b, a, metres)
                if reverse_edge not in seen: edges[b].append([a, metres]); seen.add(reverse_edge)
    grid = {}
    for node_index, (lat, lon) in enumerate(nodes): grid.setdefault((int(lat * 100), int(lon * 100)), []).append((node_index, lat, lon))
    addresses = []
    for source in extract.addresses:
        if source["i"] not in extract.nodes: continue
        lat, lon = extract.nodes[source["i"]]; best = None
        for radius in range(0, 10):
            row, col = int(lat * 100), int(lon * 100)
            for rr in range(row - radius, row + radius + 1):
                for cc in range(col - radius, col + radius + 1):
                    for node_index, node_lat, node_lon in grid.get((rr, cc), []):
                        score = distance((lat, lon), (node_lat, node_lon))
                        if best is None or score < best[0]: best = (score, node_index)
            if best and best[0] < 250: break
        if best and best[0] <= 2000: addresses.append({k: v for k, v in {**source, "i": best[1]}.items() if k != "id"})
    all_points = nodes; bounds = [min(p[0] for p in all_points), min(p[1] for p in all_points), max(p[0] for p in all_points), max(p[1] for p in all_points)]
    map_payload = {"version": 1, "region": args.region, "bounds": bounds, "roads": roads, "addresses": addresses}
    graph_payload = {"version": 1, "region": args.region, "bounds": bounds, "nodes": nodes, "edges": edges, "addresses": addresses}
    for name, payload in [(f"{args.slug}-map.json.gz", map_payload), (f"{args.slug}-road-graph.json.gz", graph_payload)]:
        with gzip.open(out / name, "wb", compresslevel=9) as handle: handle.write(json.dumps(payload, separators=(",", ":")).encode())
    print(json.dumps({"region": args.region, "roads": len(roads), "nodes": len(nodes), "edges": len(seen), "addresses": len(addresses), "bounds": bounds}))

if __name__ == "__main__": main()
