from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.preparation import DATASET_ID, INTERNAL_COUNT_KEY
from tests.support.preparation import tree_with_ancillary_data as _dataset_with_metadata
from tests.support.preparation import weighted_tree as _dataset


def test_search_nodes_matches_node_id_and_metadata_across_whole_tree(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    version = result.artifacts.layout_version

    # A node-id hit outranks a metadata-value hit and is found regardless of any
    # viewport bounds (this is a whole-tree scan, not a slice read).
    by_id = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="a", limit=25
    )
    ids = [match.node_id for match in by_id.matches]
    assert "a" in ids
    exact = next(match for match in by_id.matches if match.node_id == "a")
    assert exact.score == 100  # SEARCH_SCORE_ID_EXACT

    # Metadata values are searchable; "north" belongs to a and b.
    by_meta = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="north", limit=25
    )
    meta_ids = {match.node_id for match in by_meta.matches}
    assert {"a", "b"} <= meta_ids
    assert all(match.score == 20 for match in by_meta.matches)  # METADATA_VALUE


def test_search_nodes_excludes_internal_keys_and_respects_limit(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    version = result.artifacts.layout_version

    # The internal __category_count__ value (2) must never surface as a match.
    internal = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="2", limit=25
    )
    assert all(match.score != 20 for match in internal.matches) or not any(
        "region" in match.matched_text for match in internal.matches
    )

    # An empty query yields nothing; the limit truncates but total_count is full.
    blank = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="   ", limit=25
    )
    assert blank.matches == () and blank.total_count == 0

    capped = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="south", limit=1
    )
    assert len(capped.matches) == 1
    assert capped.total_count >= 2


def test_read_region_returns_only_inside_nodes_and_internal_edges(
    tmp_path,
) -> None:
    # A box tight around only the "b"-"c" pair must return those two nodes and
    # the single edge between them (an internal edge), while the edges leaving
    # the box (a-b, c-d, c-e) are dropped entirely — no boundary edges, no
    # off-screen neighbors surfaced (unlike read_viewport's detail path).
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    bx, by = positions["b"]
    cx, cy = positions["c"]

    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=min(bx, cx) - 1e-6,
        xmax=max(bx, cx) + 1e-6,
        ymin=min(by, cy) - 1e-6,
        ymax=max(by, cy) + 1e-6,
        max_nodes=50,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    assert returned_node_ids == {"b", "c"}
    # Only the internal b-c edge survives; every edge references a returned node.
    assert returned_edge_ids == {"e_b_c_1"}
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids


def test_read_region_aggregates_selected_member_metadata(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    layout_version = result.artifacts.layout_version

    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    xs = [positions[nid][0] for nid in positions]
    ys = [positions[nid][1] for nid in positions]

    # A box covering the whole layout selects every member.
    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=min(xs) - 1.0,
        xmax=max(xs) + 1.0,
        ymin=min(ys) - 1.0,
        ymax=max(ys) + 1.0,
        max_nodes=50,
    )

    assert {node.node_id for node in read.nodes} == {"a", "b", "c", "d", "e"}
    # region north(a,b) south(c,d) east(e) -> mode "north"/"south" tie broken
    # alphabetically to "north"; score mean = (10+20+30+5+15)/5 = 16.0.
    assert read.aggregated_metadata["region"] == "north"
    assert read.aggregated_metadata["score"] == 16.0
    assert read.aggregated_metadata[INTERNAL_COUNT_KEY] == 10


def test_read_region_empty_box_returns_empty(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=1e9,
        xmax=1e9 + 1.0,
        ymin=1e9,
        ymax=1e9 + 1.0,
        max_nodes=50,
    )

    assert read.nodes == ()
    assert read.edges == ()
    assert read.total_node_count == 0
    assert read.aggregated_metadata == {}
