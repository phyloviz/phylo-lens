"""Publish canonical READMEs as pages and resolve repository-relative links.

Documentation has one source per topic. MkDocs' virtual files avoid checked-in
copies of the browser/server READMEs. Links to code and excluded research notes
resolve to the repository; links between published pages stay within the manual.
"""

import posixpath
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from mkdocs.structure.files import File

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
EXTERNAL = {
    "client-api.md": ROOT / "code/client/README.md",
    "server-guide.md": ROOT / "code/server/README.md",
    "documentation-map.md": DOCS / "README.md",
}
EXCLUDED = {"reviews", "feedback", "validation", "figures"}
LINK = re.compile(r"(?P<start>!?\[[^\]\n]*\]\()(?P<url>[^\s)]+)(?P<end>\))")


def on_files(files, config):
    for destination, source in EXTERNAL.items():
        page = File.generated(
            config, destination, content=source.read_text(encoding="utf-8")
        )
        page.edit_uri = "../" + source.relative_to(ROOT).as_posix()
        files.append(page)
    return files


def on_page_markdown(markdown, page, config, files):
    origin = EXTERNAL.get(page.file.src_uri, DOCS / page.file.src_uri)
    aliases = {
        source.resolve(): destination for destination, source in EXTERNAL.items()
    }

    def replace(match):
        parts = urlsplit(match["url"])
        if parts.scheme or parts.netloc or not parts.path or parts.path.startswith("/"):
            return match[0]
        target = (origin.parent / unquote(parts.path)).resolve()
        destination = aliases.get(target)
        if destination is None and target.is_relative_to(DOCS):
            relative = target.relative_to(DOCS)
            if relative.parts[0] not in EXCLUDED:
                destination = relative.as_posix()
        if destination is not None:
            path = posixpath.relpath(
                destination, posixpath.dirname(page.file.src_uri) or "."
            )
            url = urlunsplit(
                ("", "", quote(path, safe="/.-_"), parts.query, parts.fragment)
            )
        elif target.is_relative_to(ROOT) and target.exists():
            relative = quote(target.relative_to(ROOT).as_posix(), safe="/.-_")
            kind = "tree" if target.is_dir() else "blob"
            url = f"https://github.com/phyloviz/phylo-lens/{kind}/main/{relative}"
            if parts.fragment:
                url += "#" + parts.fragment
        else:
            return match[0]
        return match["start"] + url + match["end"]

    return LINK.sub(replace, markdown)
