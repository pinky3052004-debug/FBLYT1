"""Download all flag images listed in codes.txt into flags/ (from flagcdn.com)."""
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "flags")
os.makedirs(OUT, exist_ok=True)
codes = open(os.path.join(ROOT, "codes.txt"), encoding="utf-8").read().split()


def get(c):
    path = os.path.join(OUT, c + ".png")
    if os.path.exists(path) and os.path.getsize(path) > 100:
        return True
    for _ in range(3):
        try:
            req = urllib.request.Request(f"https://flagcdn.com/w160/{c}.png", headers={"User-Agent": "flag-battle"})
            with urllib.request.urlopen(req, timeout=20) as r, open(path, "wb") as f:
                f.write(r.read())
            return True
        except Exception:
            pass
    return False


with ThreadPoolExecutor(12) as ex:
    res = list(ex.map(get, codes))
print(f"flags downloaded: {sum(res)}/{len(codes)}")
