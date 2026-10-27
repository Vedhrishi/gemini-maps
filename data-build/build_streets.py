"""Build India-wide street/lane names from Overture Maps (transportation segments) as 1-degree map cells.
Run: pip install duckdb ; python build_streets.py [outdir]   -> outdir/streets/<lat>_<lng>.tsv.gz + index.json
Each row: street name|road type|lat|lng|S   (one row per name per ~1 km block)
"""
import duckdb, re, subprocess, sys, os, gzip, json, shutil, time
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
REL = "2026-10-21.0"
BASE = "https://overturemaps-us-west-2.s3.amazonaws.com/"
def keys(th, ty):
    x = subprocess.run(["curl", "-s", "-m", "60", f"{BASE}?list-type=2&prefix=release/{REL}/theme={th}/type={ty}/"], capture_output=True, text=True).stdout
    return [BASE + k for k in re.findall(r"<Key>([^<]*)", x)]
c = duckdb.connect(); c.execute("install httpfs; load httpfs;")
px = os.environ.get("HTTPS_PROXY", "")
if px and "127.0.0.1" in px: c.execute(f"set http_proxy='{px.split('@')[-1]}'")
c.execute("set threads=4; set preserve_insertion_order=false;")
clean = lambda e: f"replace(replace(replace(replace({e},'|',' '),'\"',''),chr(10),' '),chr(13),' ')"
t = time.time()
files = keys('transportation', 'segment')
c.execute(f"""create table st as select {clean('names.primary')} n, replace(coalesce(class,'road'),'_',' ') cl,
  round((bbox.ymin+bbox.ymax)/2,2) y, round((bbox.xmin+bbox.xmax)/2,2) x
  from read_parquet([{",".join("'"+u+"'" for u in files)}])
  where subtype='road' and names.primary is not null and class not in ('footway','steps','pedestrian','cycleway','bridleway','path')
  and bbox.xmin between 68 and 98 and bbox.ymin between 6 and 37.2""")
print("segments", c.execute("select count(*) from st").fetchone()[0], round(time.time() - t)); t = time.time()
c.execute("create table sd as select n, any_value(cl) cl, y, x, cast(floor(y) as int) cy, cast(floor(x) as int) cx from st where length(trim(n))>1 group by n, y, x")
os.makedirs(os.path.join(OUT, "streets"), exist_ok=True)
index = {}
for cy, cx, cnt in c.execute("select cy, cx, count(*) from sd group by 1,2").fetchall():
    with gzip.open(os.path.join(OUT, "streets", f"{cy}_{cx}.tsv.gz"), "wt", encoding="utf8", compresslevel=9) as f:
        for n, cl, y, x in c.execute(f"select n, cl, y, x from sd where cy={cy} and cx={cx}").fetchall():
            f.write(f"{n}|{cl}|{y}|{x}|S\n")
    index[f"{cy}_{cx}"] = cnt
json.dump(index, open(os.path.join(OUT, "streets", "index.json"), "w"))
tot = sum(os.path.getsize(os.path.join(OUT, "streets", f)) for f in os.listdir(os.path.join(OUT, "streets")))
print("cells", len(index), "rows", sum(index.values()), "MB", tot // 1048576, round(time.time() - t))
