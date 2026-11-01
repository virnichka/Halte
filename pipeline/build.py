#!/usr/bin/env python3
"""Construit l'application à partir de data/places.json.

1. vérifie les chiffres (verify.py) ; arrêt si un point est à revoir ;
2. écrit app/data/lieux.json (sans les notes de sources internes) ;
3. produit dist/audioguide.html (un seul fichier, pour un aperçu rapide)
   et dist/audioguide-app.zip (le dossier à héberger tel quel).

Usage : python3 pipeline/build.py
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
import verify  # noqa: E402


def main() -> int:
    src = ROOT / "data" / "places.json"
    if verify.main(str(src)) != 0:
        print("\nBuild interrompu : corrigez les points ci-dessus.")
        return 1

    data = json.loads(src.read_text(encoding="utf-8"))
    public = {k: data[k] for k in ("app", "generated_by", "categories")}
    public["cities"] = [{k: v for k, v in c.items() if k != "bbox"} for c in data["cities"]]
    public["places"] = []
    for p in data["places"]:
        q = {k: v for k, v in p.items() if k != "facts"}
        public["places"].append(q)

    out = ROOT / "app" / "data"
    out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(public, ensure_ascii=False, indent=1)
    (out / "lieux.json").write_text(payload, encoding="utf-8")

    # --- fichier unique ---
    app = ROOT / "app"
    html = (app / "index.html").read_text(encoding="utf-8")
    css = (app / "styles.css").read_text(encoding="utf-8")
    mapjs = (app / "map.js").read_text(encoding="utf-8")
    appjs = (app / "app.js").read_text(encoding="utf-8")
    inline_data = json.dumps(public, ensure_ascii=False).replace("</", "<\\/")

    html = html.replace("<!doctype html>", "<!DOCTYPE html>").replace(", viewport-fit=cover", "")
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="icon"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', "", html)
    html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
    scripts = (
        "<script>window.__INLINE__=true;window.__DATA__=" + inline_data + ";</script>\n"
        "<script>\n" + mapjs + "\n</script>\n<script>\n" + appjs.replace("</script", "<\\/script") + "\n</script>"
    )
    html = html.replace('<script src="map.js"></script>\n  <script src="app.js"></script>', scripts)

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "audioguide.html").write_text(html, encoding="utf-8")

    # --- zip à héberger ---
    zpath = dist / "audioguide-app.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(app.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(app))
    print(f"\nOK : {len(public['places'])} lieux")
    print(f"  {dist / 'audioguide.html'} ({(dist / 'audioguide.html').stat().st_size // 1024} Ko)")
    print(f"  {zpath} ({zpath.stat().st_size // 1024} Ko)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
