#!/usr/bin/env python3
"""Fabrique smacpub.html : toute l'appli (styles, scripts, police, décompresseur RAR) dans un seul fichier,
à ouvrir directement dans Chrome. Usage : python3 tools/build-single.py [fichier de sortie]"""
import base64, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "smacpub.html"
read = lambda p: (root / p).read_text(encoding="utf-8")
script = lambda p: "<script>\n" + read(p).replace("</script", "<\\/script") + "\n</script>"

html = read("index.html")
html = html.replace('<link rel="stylesheet" href="css/app.css">', "<style>\n" + read("css/app.css") + "\n</style>")
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
html = html.replace('  <link rel="apple-touch-icon" href="icons/icon-192.png">\n', "")
icon = base64.b64encode((root / "icons/icon.svg").read_bytes()).decode()
html = html.replace('href="icons/icon.svg"', 'href="data:image/svg+xml;base64,' + icon + '"')
html = re.sub(r'<script src="(js/[\w.]+)"></script>', lambda m: script(m.group(1)), html)
# Le décompresseur RAR n'est chargé qu'à la demande dans l'appli ; ici il est intégré d'office.
html = html.replace("</body>", script("js/unrar.js") + "\n</body>", 1)
assert 'src="js/' not in html
out.write_text(html, encoding="utf-8")
print(f"{out} ({len(html) // 1024} Ko)")
