# -*- coding: utf-8 -*-
import base64, os

OUT = os.path.dirname(__file__)
FONTS = [
    ("Daki M Title", "DakiMTitle.woff", "normal"),
    ("Daki B", "DakiB.woff", "bold"),
    ("Daki M", "DakiM.woff", "normal"),
    ("Daki L", "DakiL.woff", "300"),
]

rules = []
for family, fname, weight in FONTS:
    path = os.path.join(OUT, "fonts_out", fname)
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    rules.append(
        f"@font-face{{font-family:'{family}'; "
        f"src:url(data:font/woff;base64,{b64}) format('woff'); "
        f"font-weight:{weight}; font-style:normal; font-display:swap;}}"
    )

css = "\n".join(rules) + "\n"
with open(os.path.join(OUT, "frontend", "fonts_embed.css"), "w", encoding="utf-8") as f:
    f.write(css)

print("embedded", len(css), "chars ->", os.path.join(OUT, "frontend", "fonts_embed.css"))
for family, fname, weight in FONTS:
    sz = os.path.getsize(os.path.join(OUT, "fonts_out", fname))
    print(f"  {family:15s} <- {fname:16s} {sz/1024:.1f} KB")
