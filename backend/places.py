"""
Full India place index (GeoNames, CC BY 4.0): every town, village and hamlet (~570k).
Loaded once at startup from data/in_places_full.tsv.gz (built by scripts/build_gazetteer.py)
and searched in memory by name prefix. Fast (<5 ms) and costs ~100 MB of RAM.
"""
import gzip, math, os, re, threading, unicodedata
from array import array
from bisect import bisect_left
from collections import defaultdict

PATH = os.path.join(os.path.dirname(__file__), "data", "in_places_full.tsv.gz")
LABEL = {"A": "City", "C": "Town", "D": "District", "T": "Airport", "S": "Railway station", "L": "Landmark", "V": "Village"}
WEIGHT = {"A": 60, "C": 40, "T": 45, "D": 25, "S": 30, "L": 20, "V": 0}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


class Gazetteer:
    def __init__(self):
        self.ready = False
        self.count = 0
        self.states: list = []
        self.keys: list = []      # normalized names, sorted
        self.names: list = []     # display names, same order
        self.lat = array("f")
        self.lng = array("f")
        self.typ: list = []
        self.pop = array("i")
        self.st = array("h")

    def load(self, path: str = PATH):
        if not os.path.exists(path):
            print(f"[places] {path} missing — place index disabled")
            return
        rows = []
        with gzip.open(path, "rt", encoding="utf8") as f:
            header = f.readline()
            self.states = header[1:].rstrip("\n").split("|")
            for line in f:
                p = line.rstrip("\n").split("|")
                if len(p) < 7:
                    continue
                n = p[0].replace("Railroad Station", "Railway Station")
                rows.append((norm(n), n, float(p[3]), float(p[4]), p[5], int(p[6]), int(p[2])))
        rows.sort(key=lambda r: r[0])
        for k, n, la, ln, t, pop, st in rows:
            self.keys.append(k); self.names.append(n)
            self.lat.append(la); self.lng.append(ln); self.typ.append(t)
            self.pop.append(pop); self.st.append(st)
        self.count = len(rows)
        inv = defaultdict(list)
        for idx, k in enumerate(self.keys):
            for t in set(k.split(" ")):
                if len(t) >= 2:
                    inv[t].append(idx)
        self.tok_sorted = sorted(inv)
        self.inv = inv
        self.ready = True
        print(f"[places] {self.count} places loaded")

    def _score(self, i: int, base: int, near):
        s = base + WEIGHT.get(self.typ[i], 0)
        if self.pop[i] > 0:
            s += min(60, math.log10(self.pop[i]) * 9)
        if near:
            dx = (self.lng[i] - near[1]) * math.cos(math.radians(near[0]))
            d = math.hypot(dx, self.lat[i] - near[0]) * 111.2
            s += max(0, 40 - d / 10)
        return s

    def search(self, q: str, near=None, limit: int = 8):
        if not self.ready:
            return []
        nq = norm(q)
        if len(nq) < 2:
            return []
        cand = {}
        # 1) whole-name prefix via binary search (fast path)
        lo = bisect_left(self.keys, nq)
        i = lo
        while i < self.count and self.keys[i].startswith(nq) and len(cand) < 600:
            cand[i] = 3000 if self.keys[i] == nq else 2500
            i += 1
        # 2) multi-word / inner-word queries: scan (only when the fast path found little)
        if len(cand) < limit:
            qt = nq.split(" ")
            lead = max(qt, key=len)
            pool = set()
            p = bisect_left(self.tok_sorted, lead)
            while p < len(self.tok_sorted) and self.tok_sorted[p].startswith(lead) and len(pool) < 20000:
                pool.update(self.inv[self.tok_sorted[p]])
                p += 1
            for j in pool:
                if j in cand:
                    continue
                toks = self.keys[j].split(" ")
                if all(any(t.startswith(q_) for t in toks) for q_ in qt):
                    cand[j] = 2000
        scored = sorted(((self._score(i, b, near), i) for i, b in cand.items()), reverse=True)
        out, seen = [], set()
        for _, i in scored:
            key = (self.keys[i], round(self.lat[i], 1), round(self.lng[i], 1))
            if key in seen:
                continue
            seen.add(key)
            state = self.states[self.st[i]] if 0 <= self.st[i] < len(self.states) else ""
            out.append({
                "name": self.names[i],
                "sub": " · ".join(x for x in (LABEL.get(self.typ[i], ""), state) if x),
                "lat": round(float(self.lat[i]), 5), "lng": round(float(self.lng[i]), 5),
            })
            if len(out) >= limit:
                break
        return out


class Detail:
    """Hyderabad detail index (Overture: shops, hospitals, apartments, buildings) plus places added by users."""
    def __init__(self):
        self.rows = []  # (norm_name, name, sub, lat, lng, kind)
        self.user_path = os.path.join(os.path.dirname(__file__), "data", "user_places.json")
        self.user = []

    def load(self):
        p = os.path.join(os.path.dirname(__file__), "data", "hyd_places.tsv.gz")
        if os.path.exists(p):
            with gzip.open(p, "rt", encoding="utf8") as f:
                for line in f:
                    a = line.rstrip("\n").split("|")
                    if len(a) >= 5:
                        self.rows.append((norm(a[0]), a[0], a[1], float(a[2]), float(a[3]), a[4]))
            print(f"[places] {len(self.rows)} Hyderabad detail places loaded")
        try:
            import json
            self.user = json.load(open(self.user_path))
        except Exception:
            self.user = []

    def add_user(self, name, lat, lng, category=""):
        import json
        item = {"name": name.strip()[:80], "sub": " · ".join(x for x in ("Added by a user", category[:30]) if x), "lat": round(lat, 6), "lng": round(lng, 6)}
        n = norm(item["name"])
        self.user = [u for u in self.user if not (norm(u["name"]) == n and abs(u["lat"] - lat) < 0.0005 and abs(u["lng"] - lng) < 0.0005)]
        self.user.insert(0, item)
        self.user = self.user[:5000]
        try:
            json.dump(self.user, open(self.user_path, "w"))
        except Exception as e:
            print("[places] could not persist user places:", e)
        return item

    def search(self, q, near=None, limit=8):
        nq = norm(q)
        if len(nq) < 3:
            return []
        qt = nq.split(" ")
        hits = []
        for u in self.user:
            n = norm(u["name"])
            if nq in n:
                hits.append((5000, u))
        for n, name, sub, la, ln, k in self.rows:
            if n == nq: s = 3000
            elif n.startswith(nq): s = 2500
            elif all(any(t.startswith(x) for t in n.split(" ")) for x in qt): s = 2000
            else: continue
            if k == "B": s -= 150
            if near:
                dx = (ln - near[1]) * math.cos(math.radians(near[0]))
                s += max(0, 80 - math.hypot(dx, la - near[0]) * 111.2 * 4)
            hits.append((s, {"name": name, "sub": ", ".join(sub.split(",")[:3]).strip(), "lat": la, "lng": ln}))
        hits.sort(key=lambda h: -h[0])
        out, seen = [], set()
        for _, p in hits:
            key = (norm(p["name"]), round(p["lat"], 3), round(p["lng"], 3))
            if key in seen: continue
            seen.add(key); out.append(p)
            if len(out) >= limit: break
        return out


detail = Detail()
gazetteer = Gazetteer()


def load_in_background():
    def _all():
        gazetteer.load(); detail.load()
    threading.Thread(target=_all, daemon=True).start()
