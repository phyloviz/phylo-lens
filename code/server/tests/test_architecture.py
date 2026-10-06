"""Keep the refactored dependency boundaries and import graph enforceable."""

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1] / "src" / "phylo_lens_server"
MODULES = {
    "phylo_lens_server." + ".".join(p.relative_to(ROOT).with_suffix("").parts): p
    for p in ROOT.rglob("*.py")
}
MODULES = {name.removesuffix(".__init__"): path for name, path in MODULES.items()}


def imports(name, path):
    result = set()
    package = name if path.name == "__init__.py" else name.rpartition(".")[0]
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parts = package.split(".")
                parent = ".".join(parts[: len(parts) - node.level + 1])
                target = parent + ("." + node.module if node.module else "")
            else:
                target = node.module or ""
            result.add(target)
            result.update(target + "." + alias.name for alias in node.names)
    return result


GRAPH = {name: imports(name, path) for name, path in MODULES.items()}


@pytest.mark.parametrize(
    "layer,forbidden",
    [
        (
            "domain",
            ("http", "services", "repository", "database", "pipeline", "jobs", "data"),
        ),
        ("services", ("http", "database")),
        ("repository", ("http", "services", "pipeline", "data")),
        ("database", ("http", "services", "repository", "pipeline", "jobs")),
        ("jobs", ("http", "pipeline")),
    ],
)
def test_layer_dependencies(layer, forbidden):
    for name, dependencies in GRAPH.items():
        if name.startswith("phylo_lens_server." + layer + "."):
            denied = tuple("phylo_lens_server." + item for item in forbidden) + (
                "fastapi",
            )
            assert not {
                item
                for item in dependencies
                if any(
                    item == prefix or item.startswith(prefix + ".") for prefix in denied
                )
            }, name


def test_services_have_no_transitive_http_dependency():
    def visit(name, seen):
        if name in seen:
            return
        seen.add(name)
        assert not name.startswith(("phylo_lens_server.http", "fastapi")), name
        for target in GRAPH.get(name, ()):
            if target in MODULES:
                visit(target, seen)

    for name in GRAPH:
        if name.startswith("phylo_lens_server.services."):
            visit(name, set())


def test_package_has_no_import_cycles():
    done = set()

    def visit(name, path):
        assert name not in path, " -> ".join((*path, name))
        if name in done:
            return
        for target in GRAPH[name]:
            if target in GRAPH:
                visit(target, (*path, name))
        done.add(name)

    for name in GRAPH:
        visit(name, ())


def test_runtime_pipeline_has_no_job_or_transport_dependencies():
    for name, dependencies in GRAPH.items():
        if name.startswith("phylo_lens_server.pipeline."):
            assert not {
                item
                for item in dependencies
                if item.startswith(
                    (
                        "phylo_lens_server.jobs",
                        "phylo_lens_server.http",
                        "phylo_lens_server.services",
                    )
                )
            }, name


def test_source_does_not_use_unconstrained_any_models():
    for path in MODULES.values():
        tree = ast.parse(path.read_text())
        assert not any(
            isinstance(node, ast.Name) and node.id == "Any" for node in ast.walk(tree)
        ), path


def test_internal_compatibility_modules_and_aliases_are_removed():
    from importlib.util import find_spec

    from phylo_lens_server.domain import models, preparation
    from phylo_lens_server.repository.layout import (
        postgres_layout_repository,
        sqlite_layout_repository,
    )

    for suffix in (
        "data.normalizer",
        "pipeline.ingest",
        "pipeline.clustering",
        "pipeline.sfdp",
        "pipeline.worker",
        "pipeline.models",
        "domain.metadata_keys",
        "services.graph_service",
        "repository.jobs.local",
        "repository.jobs.result_payload",
    ):
        assert find_spec("phylo_lens_server." + suffix) is None
    for owner, names in (
        (
            models,
            (
                "CanonicalDataset",
                "CanonicalNode",
                "CanonicalEdge",
                "MetadataField",
                "MetadataType",
                "IsolateRecord",
            ),
        ),
        (preparation, ("PreparedEdge",)),
        (sqlite_layout_repository, ("PreparedLayoutStore",)),
        (postgres_layout_repository, ("PostgresPreparedLayoutStore",)),
    ):
        assert not any(hasattr(owner, name) for name in names)
    assert not hasattr(models.Dataset, "metadata_by_node_id")
    assert not hasattr(models.Dataset, "metadata_schema")
    assert not hasattr(models.Isolate, "metadata")
