#!/usr/bin/env python3
"""Offline DuckBio static website checks. Requires Python 3.10+, no packages."""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / "docs"
EXPECTED_APPS = {"limsman", "eel", "mantrain", "methpipe", "goflo", "duckman"}
EXPECTED_PAGES = {
    "index.html", "apps.html", "pricing.html", "trial.html", "account.html",
    "about.html", "support.html", "terms.html", "privacy.html", "cookies.html",
    "subscriptions.html", "refunds.html", "cytoduck.html", "labduck.html",
} | {f"{app}.html" for app in EXPECTED_APPS}


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.hrefs: list[str] = []
        self.images: list[dict[str, str]] = []
        self.title_seen = False
        self.description_seen = False
        self.noindex = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        if "id" in a:
            assert a["id"] not in self.ids, f"Duplicate id: {a['id']}"
            self.ids.add(a["id"])
        if tag == "a":
            self.hrefs.append(a.get("href", ""))
        if tag in {"img", "script", "link"} and "src" in a or tag == "link" and "href" in a:
            self.hrefs.append(a.get("src", a.get("href", "")))
        if tag == "img":
            self.images.append(a)
        if tag == "title":
            self.title_seen = True
        if tag == "meta" and a.get("name") == "description" and a.get("content"):
            self.description_seen = True
        if tag == "meta" and a.get("name") == "robots" and "noindex" in a.get("content", ""):
            self.noindex = True


def main() -> None:
    actual = {p.name for p in ROOT.glob("*.html")}
    assert EXPECTED_PAGES == actual, f"Missing/excess pages: {sorted(EXPECTED_PAGES ^ actual)}"
    assert (ROOT / ".nojekyll").is_file()
    assert (ROOT / "robots.txt").is_file()
    settings = json.loads((ROOT / "assets/pricing.json").read_text(encoding="utf-8"))
    assert set(settings["products"]) == EXPECTED_APPS
    assert settings["subscriptionsLive"] is False and settings["trialConfigured"] is False
    assert all(info["monthly"] is None and info["stripePriceId"] is None
               for info in settings["products"].values())
    for filename in sorted(EXPECTED_PAGES):
        html = (ROOT / filename).read_text(encoding="utf-8")
        assert not re.search(r"Celluloid|celluloidconsulting|built by scientists", html, re.I), filename
        assert "<!DOCTYPE html>" in html, filename
        parser = Page()
        parser.feed(html)
        assert parser.title_seen and parser.description_seen and parser.noindex, filename
        for img in parser.images:
            assert "alt" in img, f"Image missing alt: {filename}"
            assert not re.search(r"people|staff portrait|stock photo", img.get("src", ""), re.I)
        for target in parser.hrefs:
            parsed = urlsplit(target)
            if parsed.scheme in {"http", "https", "mailto", "tel"}:
                continue
            assert not parsed.scheme, (filename, target)
            path = unquote(parsed.path)
            destination = (ROOT / filename).parent / path if path else ROOT / filename
            assert destination.exists(), f"Broken link in {filename}: {target}"
            if parsed.fragment and destination.suffix == ".html":
                other = Page()
                other.feed(destination.read_text(encoding="utf-8"))
                assert parsed.fragment in other.ids, f"Missing anchor in {filename}: {target}"
    print(f"PASS: {len(EXPECTED_PAGES)} pages, local assets/links/anchors, inactive pricing, prelaunch safeguards")


if __name__ == "__main__":
    main()
