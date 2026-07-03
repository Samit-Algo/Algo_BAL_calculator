# Single-source report renderer (preview == eventual PDF, no drift).
#
# EmberCheck's BAL report is authored ONCE as an HTML template carrying
# Handlebars-style {{token}} / {{#each}} / {{#if}} placeholders (see
# report_template.html). This module fills that template with live case data and
# returns the rendered HTML. The Assessor Console shows that exact HTML as the
# live preview; the eventual signed PDF is produced from the SAME render_report_html
# output, so the on-screen preview and the issued document can never diverge.
#
# Deliberately dependency-free: a tiny, well-scoped Handlebars subset is parsed
# and rendered here (no jinja2 / no handlebars runtime) so the template can use
# the {{token}} / {{#each}} / {{#if}}…{{else}} syntax the report was designed
# around, verbatim. The renderer knows nothing about Beanie/routes — only
# build_report_context (in app/console) is case-aware, so this whole module is a
# pure (template + dict -> html) function and trivially testable.

from __future__ import annotations

import html
import re
from pathlib import Path

_TEMPLATE_PATH = Path(__file__).with_name("report_template.html")

# Supported syntax:
#   {{ path }}     HTML-escaped interpolation (dotted paths, `this`, `this.x`)
#   {{{ path }}}   raw (un-escaped) interpolation
#   {{#if path}} … {{else}} … {{/if}}     truthiness branch
#   {{#each path}} … {{/each}}            iterate a list; `this` / `this.x` inside
_TOKEN = re.compile(
    r"\{\{\{\s*(?P<raw>[\w.]+)\s*\}\}\}"
    r"|\{\{\s*#(?P<open>if|each)\s+(?P<arg>[\w.]+)\s*\}\}"
    r"|\{\{\s*(?P<else>else)\s*\}\}"
    r"|\{\{\s*/(?P<close>if|each)\s*\}\}"
    r"|\{\{\s*(?P<var>[\w.]+)\s*\}\}"
)

_MISSING = object()


# ── AST nodes ────────────────────────────────────────────────────────────────
class _Text:
    __slots__ = ("text",)

    def __init__(self, text: str):
        self.text = text


class _Var:
    __slots__ = ("path", "raw")

    def __init__(self, path: str, raw: bool):
        self.path = path
        self.raw = raw


class _If:
    __slots__ = ("path", "then", "otherwise")

    def __init__(self, path, then, otherwise):
        self.path = path
        self.then = then
        self.otherwise = otherwise


class _Each:
    __slots__ = ("path", "body")

    def __init__(self, path, body):
        self.path = path
        self.body = body


# ── parser ───────────────────────────────────────────────────────────────────
def _parse(src: str):
    nodes, _pos, _kind = _parse_nodes(src, 0, stop=None)
    return nodes


def _parse_nodes(src: str, pos: int, stop):
    """Parse nodes from `pos` until a {{/if}}, {{/each}} or {{else}} matching
    `stop` (one of "if", "each", "else", or None for EOF). Returns (nodes,
    pos_after_the_delimiter, delimiter_kind)."""
    nodes: list = []
    while True:
        m = _TOKEN.search(src, pos)
        if not m:
            nodes.append(_Text(src[pos:]))
            return nodes, len(src), None
        if m.start() > pos:
            nodes.append(_Text(src[pos:m.start()]))
        pos = m.end()

        if m.group("close"):
            # A closing tag only terminates the block it belongs to; a stray one
            # at top level (e.g. literal "{{/if}}" inside a comment) is emitted as
            # text so unbalanced-looking prose can never halt the render.
            if stop is None:
                nodes.append(_Text(m.group(0)))
                continue
            return nodes, pos, m.group("close")
        if m.group("else"):
            if stop is None:
                nodes.append(_Text(m.group(0)))
                continue
            return nodes, pos, "else"
        if m.group("raw") is not None:
            nodes.append(_Var(m.group("raw"), raw=True))
        elif m.group("var") is not None:
            nodes.append(_Var(m.group("var"), raw=False))
        elif m.group("open") == "if":
            arg = m.group("arg")
            then, pos, kind = _parse_nodes(src, pos, stop="if")
            otherwise: list = []
            if kind == "else":
                otherwise, pos, _ = _parse_nodes(src, pos, stop="if")
            nodes.append(_If(arg, then, otherwise))
        elif m.group("open") == "each":
            arg = m.group("arg")
            body, pos, _ = _parse_nodes(src, pos, stop="each")
            nodes.append(_Each(arg, body))


# ── scope + render ─────────────────────────────────────────────────────────--
class _Scope:
    """Inner→outer frame stack. Top frame's `this` is the current loop item;
    bare names search every frame top→bottom so an {{#each}} body still reaches
    the outer context."""

    def __init__(self, root: dict):
        self._frames: list[dict] = [{"this": root, "vars": root}]

    def push(self, item) -> None:
        self._frames.append({"this": item, "vars": item if isinstance(item, dict) else {}})

    def pop(self) -> None:
        self._frames.pop()

    def resolve(self, path: str):
        parts = path.split(".")
        if parts[0] == "this":
            value, rest = self._frames[-1]["this"], parts[1:]
        else:
            value, rest = _MISSING, parts[1:]
            for frame in reversed(self._frames):
                if isinstance(frame["vars"], dict) and parts[0] in frame["vars"]:
                    value = frame["vars"][parts[0]]
                    break
            if value is _MISSING:
                return None
        for p in rest:
            value = value.get(p) if isinstance(value, dict) else getattr(value, p, None)
            if value is None:
                return None
        return value


def _render_nodes(nodes: list, scope: _Scope) -> str:
    out: list[str] = []
    for node in nodes:
        if isinstance(node, _Text):
            out.append(node.text)
        elif isinstance(node, _Var):
            value = _stringify(scope.resolve(node.path))
            out.append(value if node.raw else html.escape(value))
        elif isinstance(node, _If):
            branch = node.then if scope.resolve(node.path) else node.otherwise
            out.append(_render_nodes(branch, scope))
        elif isinstance(node, _Each):
            items = scope.resolve(node.path)
            if isinstance(items, (list, tuple)):
                for item in items:
                    scope.push(item)
                    out.append(_render_nodes(node.body, scope))
                    scope.pop()
    return "".join(out)


def _stringify(value) -> str:
    if value is None or value is False:
        return ""
    if value is True:
        return "true"
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else f"{value:g}"
    return str(value)


def render(template: str, context: dict) -> str:
    """Render a Handlebars-subset template string against `context`."""
    return _render_nodes(_parse(template), _Scope(context))


# Report templates: id -> filename (sibling of this module). The default,
# "nsw_certifier", is the full report_template.html and renders byte-identically
# to before; "owner_summary" is a shorter cover/site/BAL/disclaimer layout that
# reuses the SAME {{tokens}}, so no extra context is needed.
DEFAULT_TEMPLATE_ID = "nsw_certifier"
_TEMPLATE_FILES = {
    "nsw_certifier": "report_template.html",
    "owner_summary": "report_template_owner_summary.html",
}
ALLOWED_TEMPLATE_IDS = frozenset(_TEMPLATE_FILES)


def resolve_template_id(template_id: str | None) -> str:
    """Map any input to a known template id; an unknown or None id resolves to the
    default so rendering never errors."""
    return template_id if template_id in _TEMPLATE_FILES else DEFAULT_TEMPLATE_ID


def render_report_html(context: dict, template_id: str | None = DEFAULT_TEMPLATE_ID) -> str:
    """Fill the chosen report HTML template with `context` and return the HTML.
    `template_id` selects the layout (default "nsw_certifier"); an unknown id — or
    a missing template file — falls back to the default, never raising. THE single
    source for both the on-screen preview and the eventual PDF."""
    tid = resolve_template_id(template_id)
    path = _TEMPLATE_PATH.with_name(_TEMPLATE_FILES[tid])
    if not path.is_file():
        path = _TEMPLATE_PATH.with_name(_TEMPLATE_FILES[DEFAULT_TEMPLATE_ID])
    return render(path.read_text(encoding="utf-8"), context)
