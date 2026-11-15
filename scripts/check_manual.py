"""Check the buildless HTML manual using only the Python standard library."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "docs/manual"
REPOSITORY_URL = "https://github.com/phyloviz/phylo-lens/blob/main/"
VOID_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.ids = set()
        self.links = []
        self.errors = []
        self.stack = []
        self.heading_count = 0
        self.current_pages = []
        self.has_title = False
        self.has_language = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)
        if identifier := attrs.get("id"):
            if identifier in self.ids:
                self.errors.append(f"duplicate ID: {identifier}")
            self.ids.add(identifier)
        if tag == "html":
            self.has_language = bool(attrs.get("lang"))
        if tag == "title":
            self.has_title = True
        if tag == "h1":
            self.heading_count += 1
        if tag == "img" and "alt" not in attrs:
            self.errors.append("image needs a description")
        if attrs.get("aria-current") == "page":
            self.current_pages.append(attrs.get("href"))
        for name in ("href", "src"):
            if url := attrs.get(name):
                self.links.append(url)

    def handle_endtag(self, tag):
        if tag in VOID_ELEMENTS:
            return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"unmatched closing tag: {tag}")
        else:
            self.stack.pop()

    def validate(self):
        if self.stack:
            self.errors.append(f"unclosed tags: {self.stack}")
        if not self.has_title or not self.has_language or self.heading_count != 1:
            self.errors.append("page needs a title, language and exactly one h1")
        if self.current_pages != [self.path.name]:
            self.errors.append("navigation must mark this page as current")


def main():
    pages = {}
    for path in sorted(MANUAL.glob("*.html")):
        page = Page(path)
        page.feed(path.read_text(encoding="utf-8"))
        page.close()
        page.validate()
        pages[path.resolve()] = page
    errors = []
    checked = 0
    if (MANUAL / "index.html").resolve() not in pages:
        errors.append("manual index.html is missing")
    for path, page in pages.items():
        errors.extend(f"{path.name}: {message}" for message in page.errors)
        for url in page.links:
            parts = urlsplit(url)
            if url.startswith(REPOSITORY_URL):
                target = ROOT / unquote(parts.path.split("/blob/main/", 1)[1])
            elif parts.scheme or parts.netloc:
                continue
            else:
                target = (path.parent / unquote(parts.path)).resolve()
            checked += 1
            if not target.exists():
                errors.append(f"{path.name}: missing target: {url}")
            elif (
                target in pages
                and parts.fragment
                and unquote(parts.fragment) not in pages[target].ids
            ):
                errors.append(f"{path.name}: missing anchor: {url}")
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Manual: {len(pages)} HTML pages, {checked} links/assets checked.")


if __name__ == "__main__":
    main()
