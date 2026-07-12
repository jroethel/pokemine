#!/usr/bin/env python3
"""Refresh the local cache of the NotebookLM notebook "Create: New Pokemon".

Pulls raw source text via the `nlm` CLI (no MCP, no AI processing) into
docs/reference/notebook-cache/, one .txt per source, plus a manifest.json.

Usage:
  python3 scripts/refresh-notebook-cache.py           # fetch new/removed only
  python3 scripts/refresh-notebook-cache.py --force   # re-fetch everything

After a refresh that reports NEW sources, have a Claude session re-distill
docs/reference/pokemon-design-notes.md from the changed files.
"""
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

NOTEBOOK_ID = "cc40970a-799e-415f-9e97-2df75471ba9c"  # "Create: New Pokemon"
CACHE_DIR = Path(__file__).parent.parent / "docs" / "reference" / "notebook-cache"
MANIFEST = CACHE_DIR / "manifest.json"


def nlm(*args):
    r = subprocess.run(["nlm", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"nlm {' '.join(args)} failed:\n{r.stderr.strip()}\n(try: nlm login)")
    return r.stdout


def slug(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:60] or "untitled"


def main():
    force = "--force" in sys.argv
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    sources = json.loads(nlm("source", "list", "-j", NOTEBOOK_ID))
    if isinstance(sources, dict):  # tolerate {"sources": [...]} wrapper
        sources = sources.get("sources", sources)
    live = {s["id"]: s.get("title", "") for s in sources}

    new, refreshed, removed = [], [], []

    for sid, title in live.items():
        fname = f"{slug(title)}--{sid[:8]}.txt"
        path = CACHE_DIR / fname
        if sid in manifest and path.exists() and not force:
            continue
        nlm("source", "content", "-o", str(path), sid)
        (new if sid not in manifest else refreshed).append(title)
        manifest[sid] = {"title": title, "file": fname, "fetched": date.today().isoformat()}

    for sid in list(manifest):
        if sid not in live:
            f = CACHE_DIR / manifest[sid]["file"]
            if f.exists():
                f.unlink()
            removed.append(manifest.pop(sid)["title"])

    MANIFEST.write_text(json.dumps(manifest, indent=2))

    print(f"cache: {len(manifest)} sources in {CACHE_DIR}")
    for label, items in (("NEW", new), ("refreshed", refreshed), ("removed", removed)):
        for t in items:
            print(f"  {label}: {t}")
    if new:
        print("\nNEW sources found: re-distill docs/reference/pokemon-design-notes.md")
    elif not (refreshed or removed):
        print("no changes")


if __name__ == "__main__":
    main()
