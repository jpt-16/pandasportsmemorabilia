#!/usr/bin/env python3
"""Copy the shared header and footer from index.html into every other page.

The site has no build step, so the chrome is duplicated in each HTML file.
Run this after editing the header, footer, ticker or icon sprite in
index.html and the other pages pick the change up:

    python3 tools/sync-chrome.py          # write the changes
    python3 tools/sync-chrome.py --check  # exit 1 if any page is stale

The blocks are delimited by CHROME:TOP and CHROME:FOOT comment markers.
Per-page nav state (aria-current) is reapplied from the page's own
data-page attribute on <body>… which static files don't have, so it is
taken from the filename instead.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "index.html"
PAGES = ["about.html", "faq.html", "privacy.html", "refunds.html", "terms.html", "shop.html", "shop-success.html"]
NAV_FOR_PAGE = {
    "about.html": "About",
    "faq.html": "FAQ",
    "shop.html": "Shop",
    # These aren't in the top nav (footer only, or not linked at all, by
    # design), so no label below matches an actual <a> there — mark_current
    # just no-ops.
    "privacy.html": "Privacy",
    "refunds.html": "Refunds",
    "terms.html": "Terms",
    "shop-success.html": "Order reserved",
}


def block(text, name):
    match = re.search(
        rf"<!-- CHROME:{name}:START -->.*?<!-- CHROME:{name}:END -->", text, re.S
    )
    if not match:
        sys.exit(f"marker CHROME:{name} missing from {SOURCE.name}")
    return match.group(0)


def mark_current(chrome, label):
    """Flag the nav entry for the page being written."""
    pattern = '<a href="([^"]+)">' + re.escape(label) + "</a>"
    replacement = '<a class="is-current" aria-current="page" href="\\1">' + label + "</a>"
    return re.sub(pattern, replacement, chrome, count=1)


def main():
    check_only = "--check" in sys.argv
    source = SOURCE.read_text()
    top, foot = block(source, "TOP"), block(source, "FOOT")
    stale = []

    for name in PAGES:
        path = ROOT / name
        if not path.exists():
            continue
        text = path.read_text()
        updated = re.sub(
            r"<!-- CHROME:TOP:START -->.*?<!-- CHROME:TOP:END -->",
            lambda _: mark_current(top, NAV_FOR_PAGE[name]),
            text,
            flags=re.S,
        )
        updated = re.sub(
            r"<!-- CHROME:FOOT:START -->.*?<!-- CHROME:FOOT:END -->",
            lambda _: foot,
            updated,
            flags=re.S,
        )
        if updated != text:
            stale.append(name)
            if not check_only:
                path.write_text(updated)

    if check_only and stale:
        sys.exit("chrome is stale in: " + ", ".join(stale))
    print("synced: " + (", ".join(stale) if stale else "nothing to do"))


if __name__ == "__main__":
    main()
