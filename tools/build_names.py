"""
Build the map's name labels for Telangana: every named building (Overture buildings, which carry OpenStreetMap
names) and every named place inside buildings (Overture places, the app's offline gazetteer), cut into z13 tiles.

Output: <out>/{x}_{y}.json, each {"b": [[name, lat, lng, kind, floors], ...], "p": [[name, lat, lng], ...]}
Run:    python3 tools/build_names.py buildings.parquet data/cells data/names
"""
import sys, os, gzip, json, math, re, collections
import duckdb

BB = (77.2, 81.85, 15.8, 19.95)   # lng min, lng max, lat min, lat max: Telangana plus a margin
Z = 13

def tile(lat, lng):
    n = 2 ** Z
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())

def main(bpq, cells, out):
    os.makedirs(out, exist_ok=True)
    con = duckdb.connect()
    rows = con.execute(f"select name, lat, lng, coalesce(subtype,''), coalesce(num_floors,0) from '{bpq}'").fetchall()
    # one label per building name per ~40 m: a tower modelled as four footprints gets one label
    seen, blds = {}, []
    for name, lat, lng, kind, fl in rows:
        name = name.strip()
        if len(name) < 2 or not (BB[2] <= lat <= BB[3] and BB[0] <= lng <= BB[1]):
            continue
        k = (norm(name), round(lat * 2500), round(lng * 2500))
        near = any((k[0], k[1] + a, k[2] + b) in seen for a in (-1, 0, 1) for b in (-1, 0, 1))
        if near:
            continue
        seen[k] = 1
        blds.append((name, lat, lng, kind, int(fl)))
    bidx = collections.defaultdict(list)
    for b in blds:
        bidx[norm(b[0])].append(b)

    places = []
    for lat0 in range(15, 20):
        for lng0 in range(77, 82):
            f = os.path.join(cells, f'{lat0}_{lng0}.tsv.gz')
            if not os.path.exists(f):
                continue
            with gzip.open(f, 'rt', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    p = line.rstrip('\n').split('|')
                    if len(p) < 4:
                        continue
                    try:
                        lat, lng = float(p[2]), float(p[3])
                    except ValueError:
                        continue
                    name = p[0].strip()
                    if len(name) < 3 or name.isdigit() or not (BB[2] <= lat <= BB[3] and BB[0] <= lng <= BB[1]):
                        continue
                    # already labelled as a building within ~80 m
                    if any(abs(b[1] - lat) < 0.0007 and abs(b[2] - lng) < 0.0007 for b in bidx.get(norm(name), ())):
                        continue
                    places.append((name, lat, lng))

    tiles = collections.defaultdict(lambda: {'b': [], 'p': []})
    for name, lat, lng, kind, fl in blds:
        tiles[tile(lat, lng)]['b'].append([name, round(lat, 5), round(lng, 5), kind, fl])
    dup = set()
    for name, lat, lng in places:
        k = (norm(name), round(lat * 4000), round(lng * 4000))
        if k in dup:
            continue
        dup.add(k)
        tiles[tile(lat, lng)]['p'].append([name, round(lat, 5), round(lng, 5)])
    size = 0
    big = 0
    for (x, y), d in tiles.items():
        s = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
        open(os.path.join(out, f'{x}_{y}.json'), 'w', encoding='utf-8').write(s)
        size += len(s)
        big = max(big, len(gzip.compress(s.encode())))
    json.dump({'z': Z, 'buildings': len(blds), 'places': len(dup), 'tiles': len(tiles)}, open(os.path.join(out, 'index.json'), 'w'))
    print(f'buildings {len(blds)}, places {len(dup)}, tiles {len(tiles)}, raw {size/1e6:.1f} MB, biggest tile gz {big/1e3:.0f} KB')

if __name__ == '__main__':
    main(*sys.argv[1:4])
