#!/usr/bin/env python3
"""Sklada jednoplikowa wersje aplikacji (artifact.html) z tych samych zrodel,
ktore idą na GitHub Pages - zeby obie wersje nigdy sie nie rozjechaly."""
import base64
import json
import pathlib
import re
import time

BASE = pathlib.Path(__file__).resolve().parent

css = (BASE / "style.css").read_text(encoding="utf-8")
js = (BASE / "app.js").read_text(encoding="utf-8")
data = json.loads((BASE / "content.json").read_text(encoding="utf-8"))
icon = base64.b64encode((BASE / "icons/icon-180.png").read_bytes()).decode()

# service worker nie dziala w ramce - wycinamy go z wersji hostowanej
js = re.sub(
    r'if \("serviceWorker" in navigator\) \{.*?\n\}\n',
    "",
    js,
    count=1,
    flags=re.S,
)

html = f"""<meta charset="utf-8">
<title>TheBrainApp</title>
<link rel="apple-touch-icon" href="data:image/png;base64,{icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
{css}
</style>

<div id="app" data-theme="day">
  <div id="bg"></div>
  <div id="tabs"></div>
  <div id="pager"></div>
  <button id="theme-toggle" title="Tryb dzień / noc"></button>
</div>

<script>
const CONTENT_DATA = {json.dumps(data, ensure_ascii=False)};
{js}
</script>
"""

(BASE / "artifact.html").write_text(html, encoding="utf-8")

# stempel wersji w service workerze - inaczej telefon trzymalby stara tresc
sw_path = BASE / "service-worker.js"
sw = sw_path.read_text(encoding="utf-8")
stamp = time.strftime("%Y%m%d-%H%M%S")
sw = re.sub(r'const CACHE_NAME = "[^"]+";', f'const CACHE_NAME = "brainapp-{stamp}";', sw, count=1)
sw_path.write_text(sw, encoding="utf-8")
print("cache service workera:", stamp)

counts = {k: len(v) for k, v in data.items()}
print("kategorie:", counts)
print("kart razem:", sum(counts.values()))
print("artifact.html:", (BASE / "artifact.html").stat().st_size, "B")
