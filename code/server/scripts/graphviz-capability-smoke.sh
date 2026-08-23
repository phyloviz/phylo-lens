#!/bin/sh
set -eu

expected_version="${PHYLO_LENS_GRAPHVIZ_VERSION:-12.2.1}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

if ! command -v sfdp >/dev/null 2>&1; then
    echo "Graphviz capability check failed: sfdp is missing from PATH." >&2
    exit 1
fi

version_output="$(sfdp -V 2>&1)"
printf '%s\n' "$version_output"
case "$version_output" in
    *"graphviz version ${expected_version}"*) ;;
    *)
        echo "Graphviz capability check failed: expected version ${expected_version}." >&2
        exit 1
        ;;
esac

if command -v apk >/dev/null 2>&1; then
    apk list --installed glib libltdl
fi
if [ -x /opt/gts/bin/gts-config ]; then
    /opt/gts/bin/gts-config --version
fi

neato_plugin="$(find /opt/graphviz/lib/graphviz -type f -name 'libgvplugin_neato_layout.so.*' -print -quit)"
if [ -z "$neato_plugin" ]; then
    echo "Graphviz capability check failed: sfdp layout plugin is missing." >&2
    exit 1
fi
if ! ldd "$neato_plugin" | grep -q '/opt/gts/lib/libgts-0.7.so.5'; then
    echo "Graphviz capability check failed: sfdp layout plugin is not linked to GTS." >&2
    exit 1
fi

cat > "$work_dir/overlap.dot" <<'DOT'
graph {
  graph [layout=sfdp, overlap=scale, maxiter=32];
  node [shape=point, width=0.04, height=0.04, label=""];
  a -- b; b -- c; c -- d; d -- e; e -- f; f -- a;
}
DOT

if ! sfdp -Tplain "$work_dir/overlap.dot" > "$work_dir/layout.plain" 2> "$work_dir/stderr"; then
    cat "$work_dir/stderr" >&2
    echo "Graphviz capability check failed: sfdp overlap removal exited non-zero." >&2
    exit 1
fi

if grep -qi 'triangulation library' "$work_dir/stderr"; then
    cat "$work_dir/stderr" >&2
    echo "Graphviz capability check failed: triangulation support is missing." >&2
    exit 1
fi

if [ -s "$work_dir/stderr" ]; then
    cat "$work_dir/stderr" >&2
    echo "Graphviz capability check failed: sfdp wrote unexpected stderr." >&2
    exit 1
fi

if [ "$(grep -c '^node ' "$work_dir/layout.plain")" -ne 6 ]; then
    echo "Graphviz capability check failed: expected six plain-output node coordinates." >&2
    exit 1
fi

grep -qx 'stop' "$work_dir/layout.plain"
printf 'Graphviz overlap-removal capability check passed.\n'
