"""Build the India-wide place dataset from Overture Maps (CC BY 4.0 / ODbL) as 1-degree map cells.
Run:  pip install duckdb ; python build_india.py [outdir]     (about 5-10 minutes, ~1 GB download)
Output: outdir/cells/<lat>_<lng>.tsv.gz  (name|description|lat|lng|kind) and outdir/cells/index.json
"""
import duckdb, re, subprocess, sys, os, gzip, json, shutil, time
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
REL = "2026-10-21.0"
BASE = "https://overturemaps-us-west-2.s3.amazonaws.com/"
CITIES = {  # bounding boxes for named buildings (apartments, malls, temples...) in the biggest metros
    "mumbai": (72.75, 18.85, 73.2, 19.4), "delhi": (76.85, 28.35, 77.55, 28.9), "bengaluru": (77.35, 12.8, 77.85, 13.2),
    "chennai": (80.1, 12.85, 80.35, 13.25), "kolkata": (88.2, 22.45, 88.5, 22.75), "hyderabad": (78.15, 17.15, 78.75, 17.65),
    "pune": (73.7, 18.4, 74.0, 18.65), "ahmedabad": (72.45, 22.95, 72.75, 23.15),
}
def keys(th, ty):
    x = subprocess.run(["curl", "-s", "-m", "60", f"{BASE}?list-type=2&prefix=release/{REL}/theme={th}/type={ty}/"], capture_output=True, text=True).stdout
    return [BASE + k for k in re.findall(r"<Key>([^<]*)", x)]
def lst(th, ty): return "[" + ",".join(f"'{u}'" for u in keys(th, ty)) + "]"
c = duckdb.connect(); c.execute("install httpfs; load httpfs;")
px = os.environ.get("HTTPS_PROXY", "")
if px and "127.0.0.1" in px: c.execute(f"set http_proxy='{px.split('@')[-1]}'")
tmp = os.path.join(OUT, "_tmp"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
clean = lambda e: f"replace(replace(replace(replace({e},'|',' '),'\"',''),chr(10),' '),chr(13),' ')"
t = time.time()
c.execute(f"""create table pl as select {clean('names.primary')} n,
  trim(replace(coalesce(taxonomy.primary,''),'_',' ') || ', ' || coalesce({clean('addresses[1].locality')},''), ', ') s,
  round(bbox.ymin,4) y, round(bbox.xmin,4) x, 'P' k
  from read_parquet({lst('places','place')})
  where bbox.xmin between 68 and 98 and bbox.ymin between 6 and 37.2 and addresses[1].country='IN'
  and names.primary is not null and confidence>=0.3""")
print("places", c.execute("select count(*) from pl").fetchone()[0], round(time.time()-t)); t = time.time()
for name, (x0, y0, x1, y1) in CITIES.items():
    c.execute(f"""insert into pl select {clean('names.primary')}, trim(coalesce(class,'')||' '||coalesce(subtype,'')||' building'), round(bbox.ymin,4), round(bbox.xmin,4), 'B'
      from read_parquet({lst('buildings','building')}) where bbox.xmin between {x0} and {x1} and bbox.ymin between {y0} and {y1} and names.primary is not null""")
    print(name, "buildings done", round(time.time()-t)); t = time.time()
c.execute("create table pd as select distinct n, s, y, x, k, cast(floor(y) as int) cy, cast(floor(x) as int) cx from pl where length(trim(n))>0")
cells = c.execute("select cy, cx, count(*) from pd group by 1,2 order by 3 desc").fetchall()
os.makedirs(os.path.join(OUT, "cells"), exist_ok=True)
index = {}
for cy, cx, cnt in cells:
    rows = c.execute(f"select n,s,y,x,k from pd where cy={cy} and cx={cx}").fetchall()
    with gzip.open(os.path.join(OUT, "cells", f"{cy}_{cx}.tsv.gz"), "wt", encoding="utf8", compresslevel=9) as f:
        for n, s, y, x, k in rows: f.write(f"{n}|{s}|{y}|{x}|{k}\n")
    index[f"{cy}_{cx}"] = cnt
json.dump(index, open(os.path.join(OUT, "cells", "index.json"), "w"))
shutil.rmtree(tmp, ignore_errors=True)
tot = sum(os.path.getsize(os.path.join(OUT, "cells", f)) for f in os.listdir(os.path.join(OUT, "cells")))
print("cells", len(index), "rows", sum(index.values()), "MB", tot // 1048576)
