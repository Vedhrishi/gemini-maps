"""
Build the offline India gazetteer used for instant place search.

Source: GeoNames (CC BY 4.0) — https://download.geonames.org/export/dump/IN.zip
Usage:  python scripts/build_gazetteer.py IN.txt admin1CodesASCII.txt \
            frontend/src/data/in-places.tsv  [backend/data/in_places_full.tsv.gz]

Tier 1 (frontend, lazy-loaded): towns >= 5,000 people, every admin seat, airports,
railway stations, temples, forts, parks, monuments and other visitor landmarks.
Tier 2 (backend, optional): every populated place in India (~550k villages and hamlets).
"""
import csv, gzip, re, sys, unicodedata

src, admin, out1 = sys.argv[1:4]
out2 = sys.argv[4] if len(sys.argv) > 4 else None

states = {}
for line in open(admin, encoding="utf8"):
    p = line.rstrip("\n").split("\t")
    if p[0].startswith("IN."):
        states[p[0][3:]] = p[1]
state_ids = {k: i for i, k in enumerate(sorted(states))}
state_names = [states[k] for k in sorted(states)]

ASCII = re.compile(r"^[A-Za-z0-9 .'\-()&/]+$")

def clean_alts(name, ascii_name, alts):
    seen = {name.lower(), ascii_name.lower()}
    out = []
    for a in alts.split(","):
        a = a.strip()
        if not a or a.lower() in seen or not ASCII.match(a) or len(a) > 24:
            continue
        seen.add(a.lower())
        out.append(a)
        if len(out) == 2:
            break
    return "/".join(out)

POP_TYPES = {"PPL", "PPLL", "PPLX", "PPLQ", "PPLF", "PPLS", "PPLW", "PPLH", "PPLR"}
ADMIN_SEAT = {"PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG"}
LANDMARK = {"TMPL", "SHRN", "MNMT", "MUS", "PAL", "FT", "PRK", "STDM", "DAM", "ZOO", "GDN", "BCH", "MKT", "UNIV", "HSP", "RSRT", "CH", "MSTY", "BUSTN", "STNB", "HBR", "PIER", "AMUS", "THTR"}

rows1, rows2 = [], []
for r in csv.reader(open(src, encoding="utf8"), delimiter="\t", quoting=csv.QUOTE_NONE):
    gid, name, ascii_name, alts, lat, lng, fclass, fcode = r[:8]
    pop = int(r[14] or 0)
    st = state_ids.get(r[10], -1)
    base = [ascii_name or name, clean_alts(ascii_name or name, name, alts), str(st), f"{float(lat):.4f}", f"{float(lng):.4f}"]
    t = None
    if fcode in ADMIN_SEAT: t = "A"
    elif fcode in POP_TYPES and pop >= 5000: t = "C"
    elif fcode == "AIRP": t = "T"
    elif fcode == "RSTN": t = "S"
    elif fcode in LANDMARK: t = "L"
    elif fcode == "ADM2": t = "D"
    if t:
        rows1.append(base + [t, str(pop)])
    if out2 and (fcode in POP_TYPES or fcode in ADMIN_SEAT or t):
        rows2.append(base + [t or "V", str(pop)])

def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        k = (r[0].lower(), round(float(r[3]), 2), round(float(r[4]), 2), r[5])
        if k in seen: continue
        seen.add(k); out.append(r)
    return out

rows1 = dedupe(rows1)
rows1.sort(key=lambda r: -int(r[6]))
with open(out1, "w", encoding="utf8") as f:
    f.write("#" + "|".join(state_names) + "\n")
    for r in rows1:
        f.write("|".join(r) + "\n")
print("tier1 rows:", len(rows1))
if out2:
    rows2 = dedupe(rows2)
    with gzip.open(out2, "wt", encoding="utf8", compresslevel=9) as f:
        f.write("#" + "|".join(state_names) + "\n")
        for r in rows2:
            f.write("|".join(r) + "\n")
    print("tier2 rows:", len(rows2))
