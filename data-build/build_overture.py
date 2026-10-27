"""Build a detailed Hyderabad place/building/address dataset from Overture Maps (CC BY 4.0 / ODbL).
Run:  python build_overture.py [outdir]   (needs: pip install duckdb)
Output (gzip TSV, name|sub|lat|lng|kind): hyd_places.tsv.gz
"""
import duckdb, re, subprocess, sys, os, gzip, time
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
REL = "2026-10-21.0"
BB = (78.15, 17.15, 78.75, 17.65)  # Greater Hyderabad + Cyberabad + Secunderabad
BASE = "https://overturemaps-us-west-2.s3.amazonaws.com/"
def keys(th, ty):
    x = subprocess.run(["curl", "-s", "-m", "60", f"{BASE}?list-type=2&prefix=release/{REL}/theme={th}/type={ty}/"], capture_output=True, text=True).stdout
    return [BASE + k for k in re.findall(r"<Key>([^<]*)", x)]
c = duckdb.connect(); c.execute("install httpfs; load httpfs;")
px = os.environ.get("HTTPS_PROXY", "")
if px and "127.0.0.1" in px:
    c.execute(f"set http_proxy='{px.split('@')[-1]}'")
def lst(th, ty): return "[" + ",".join(f"'{u}'" for u in keys(th, ty)) + "]"
w = f"bbox.xmin between {BB[0]} and {BB[2]} and bbox.ymin between {BB[1]} and {BB[3]}"
rows = []
t = time.time()
# 1) places: shops, restaurants, hospitals, schools, offices, apartments...
q = f"""select names.primary n, taxonomy.primary cat, addresses[1].freeform a, addresses[1].locality loc,
 addresses[1].postcode pc, bbox.xmin x, bbox.ymin y
 from read_parquet({lst('places','place')}) where {w} and names.primary is not null and confidence>=0.3"""
for n, cat, a, loc, pc, x, y in c.execute(q).fetchall():
    sub = ", ".join(v for v in ((cat or "").replace("_", " "), a, loc, pc) if v)
    rows.append((n, sub, y, x, "P"))
print("places", len(rows), round(time.time() - t)); t = time.time()
# 2) buildings that have a name (apartments, malls, temples, hostels)
q = f"""select names.primary n, coalesce(subtype,'') st, coalesce(class,'') cl, bbox.xmin x, bbox.ymin y
 from read_parquet({lst('buildings','building')}) where {w} and names.primary is not null"""
nb = 0
for n, st, cl, x, y in c.execute(q).fetchall():
    rows.append((n, " ".join(v for v in (cl.replace("_", " "), st.replace("_", " "), "building") if v), y, x, "B")); nb += 1
print("named buildings", nb, round(time.time() - t)); t = time.time()
# 3) street addresses (house/plot numbers)
try:
    q = f"""select coalesce(number,'')||' '||coalesce(street,'') n, coalesce(address_levels[2].value, postcode,'') s, bbox.ymin y, bbox.xmin x
     from read_parquet({lst('addresses','address')}) where {w} and street is not null and number is not null"""
    na = 0
    for n, s, y, x in c.execute(q).fetchall():
        rows.append((n.strip(), s, y, x, "A")); na += 1
    print("addresses", na, round(time.time() - t))
except Exception as e:
    print("addresses skipped:", str(e)[:120])
seen = set(); out = []
for n, sub, y, x, k in rows:
    key = (n.lower(), round(y, 4), round(x, 4))
    if key in seen: continue
    seen.add(key); out.append((n.replace("|", " ").replace("\t", " "), sub.replace("|", " "), round(y, 5), round(x, 5), k))
os.makedirs(OUT, exist_ok=True)
p = os.path.join(OUT, "hyd_places.tsv.gz")
with gzip.open(p, "wt", encoding="utf8") as f:
    for r in out: f.write("%s|%s|%s|%s|%s\n" % r)
print("wrote", p, len(out), "rows", os.path.getsize(p) // 1024, "KB")
