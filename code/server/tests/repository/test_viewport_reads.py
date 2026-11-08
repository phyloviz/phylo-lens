from phylo_lens_server.domain.ancillary import AncillaryField, AncillaryType
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    encode_dataset_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.summaries import aggregate_cluster_metadata
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.preparation import DATASET_ID, INTERNAL_COUNT_KEY
from tests.support.preparation import tree_with_ancillary_data as _dataset_with_metadata
from tests.support.preparation import varied_chain_dataset as _varied_chain_dataset
from tests.support.preparation import weighted_tree as _dataset


def _chain_dataset_with_metadata(node_count: int) -> Dataset:
    dataset = _varied_chain_dataset(node_count).model_copy(
        update={"dataset_id": DATASET_ID}
    )
    regions = ("north", "south", "east")
    metadata_by_node_id = {
        f"n{index}": {
            "region": regions[index % len(regions)],
            "score": index,
            "flag": index % 2 == 0,
            INTERNAL_COUNT_KEY: 1,
        }
        for index in range(node_count)
    }
    return dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="region", type=AncillaryType.STRING),
                    AncillaryField(key="score", type=AncillaryType.NUMBER),
                    AncillaryField(key="flag", type=AncillaryType.BOOLEAN),
                    AncillaryField(key=INTERNAL_COUNT_KEY, type=AncillaryType.NUMBER),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="region", type=AncillaryType.STRING),
                    AncillaryField(key="score", type=AncillaryType.NUMBER),
                    AncillaryField(key="flag", type=AncillaryType.BOOLEAN),
                    AncillaryField(key=INTERNAL_COUNT_KEY, type=AncillaryType.NUMBER),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in (metadata_by_node_id).items()
            },
        }
    )


def test_viewport_cluster_members_carry_public_node_metadata(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(
        _dataset_with_metadata(), lod_options=LodOptions(small_component_threshold=0)
    )
    branch_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("b", "c", "d", "e")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        cluster_id=branch_cluster.cluster_id,
    )
    metadata_by_id = {node.node_id: node.metadata for node in read.nodes}

    assert metadata_by_id["c"] == {
        "region": "south",
        "score": 30,
        "flag": False,
        INTERNAL_COUNT_KEY: 2,
    }
    assert metadata_by_id["d"][INTERNAL_COUNT_KEY] == 2
    schema_keys = {field.key for field in read.metadata_schema}
    assert schema_keys == {"region", "score", "flag"}


def test_viewport_cluster_members_prioritize_focused_node_when_limited(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(
        _dataset_with_metadata(), lod_options=LodOptions(small_component_threshold=0)
    )
    branch_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("b", "c", "d", "e")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=1,
        cluster_id=branch_cluster.cluster_id,
        focus_node_id="c",
    )

    assert [node.node_id for node in read.nodes if not node.is_representative] == ["c"]


def test_viewport_expansion_reroutes_boundary_edges_to_neighbor_representatives(
    tmp_path,
) -> None:
    # At selected hop depth 0, {b,c,d,e} is attached to visible node a through one edge.
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(
        _dataset(), lod_options=LodOptions(small_component_threshold=0)
    )
    branch_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("b", "c", "d", "e")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        cluster_id=branch_cluster.cluster_id,
    )

    node_ids = {node.node_id for node in read.nodes}
    # Members plus the surfaced attachment neighbor.
    assert node_ids == {"a", "b", "c", "d", "e"}
    reps = {node.node_id for node in read.nodes if node.is_representative}
    assert reps == {"a"}

    # Every emitted edge references a returned node (visibility invariant).
    for edge in read.edges:
        assert edge.source in node_ids
        assert edge.target in node_ids

    meta_edges = {
        (edge.source, edge.target): edge for edge in read.edges if edge.is_meta
    }
    assert set(meta_edges) == {("b", "a")}
    assert meta_edges[("b", "a")].distance == 1.0

    # Ordinary internal edges stay non-meta.
    internal_edges = [edge for edge in read.edges if not edge.is_meta]
    assert {edge.edge_id for edge in internal_edges} == {
        "e_b_c_1",
        "e_c_d_1",
        "e_c_e_1",
    }


def test_truncated_expansion_only_shows_boundary_when_attachment_is_returned(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    result = PreparationService(store).prepare_dataset(
        _dataset(), lod_options=LodOptions(small_component_threshold=0)
    )
    cluster = next(
        item
        for item in result.artifacts.clusters
        if item.member_node_ids == ("b", "c", "d", "e")
    )
    for focus, expected_meta_edges in (("d", 0), ("b", 1)):
        read = store.read_viewport(
            dataset_id=DATASET_ID,
            layout_version=result.artifacts.layout_version,
            xmin=None,
            xmax=None,
            ymin=None,
            ymax=None,
            max_nodes=1,
            cluster_id=cluster.cluster_id,
            focus_node_id=focus,
        )
        assert read.truncated
        assert sum(edge.is_meta for edge in read.edges) == expected_meta_edges
        assert all(
            edge.source in {node.node_id for node in read.nodes}
            and edge.target in {node.node_id for node in read.nodes}
            for edge in read.edges
        )


def test_viewport_representatives_carry_cluster_metadata_aggregate(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    dataset = _chain_dataset_with_metadata(60)
    result = worker.prepare_dataset(
        dataset, lod_options=LodOptions(small_component_threshold=0)
    )
    members_by_cluster = {
        cluster.cluster_id: cluster.member_node_ids
        for cluster in result.artifacts.clusters
    }
    public_metadata = {
        node_id: {
            key: value for key, value in metadata.items() if key != INTERNAL_COUNT_KEY
        }
        for node_id, metadata in encode_dataset_annotations(dataset).items()
    }
    public_schema = (("region", "string"), ("score", "number"), ("flag", "boolean"))

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=500,
        lod_level=0,
    )
    representatives = [node for node in read.nodes if node.is_representative]

    assert representatives
    for node in representatives:
        expected = aggregate_cluster_metadata(
            [public_metadata[nid] for nid in members_by_cluster[node.cluster_id]],
            public_schema,
        )
        expected[INTERNAL_COUNT_KEY] = len(members_by_cluster[node.cluster_id])
        assert node.metadata == expected


def test_detail_viewport_keeps_boundary_edges_and_offscreen_neighbors(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    # Discover the computed positions via an unbounded detail read.
    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=None,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    assert set(positions) == {"a", "b", "c", "d", "e"}
    assert {edge.edge_id for edge in full.edges} == {
        "e_a_b_1",
        "e_b_c_1",
        "e_c_d_1",
        "e_c_e_1",
    }

    # A tight box around only "c" — its three edges (to b, d, e) all straddle
    # the viewport boundary.
    cx, cy = positions["c"]
    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=cx - 1e-6,
        xmax=cx + 1e-6,
        ymin=cy - 1e-6,
        ymax=cy + 1e-6,
        max_nodes=50,
        lod_level=None,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    # Boundary edges survive instead of being dropped for an off-screen endpoint.
    assert {"e_b_c_1", "e_c_d_1", "e_c_e_1"} <= returned_edge_ids
    # And every endpoint of a returned edge is present as a node, so the client
    # keeps them.
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids
    # The off-screen neighbors were surfaced alongside the in-viewport node.
    assert {"c", "b", "d", "e"} <= returned_node_ids


def test_detail_viewport_keeps_boundary_edges_when_node_budget_is_saturated(
    tmp_path,
) -> None:
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
        lod_level=None,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    cx, cy = positions["c"]

    # max_nodes=1 makes the in-viewport slice saturate the budget with only
    # "c". Previously this collapsed the neighbor budget to zero and dropped
    # every boundary edge again; now the off-screen neighbors are surfaced in
    # full so the boundary edges survive.
    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=cx - 1e-6,
        xmax=cx + 1e-6,
        ymin=cy - 1e-6,
        ymax=cy + 1e-6,
        max_nodes=1,
        lod_level=None,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    assert {"e_b_c_1", "e_c_d_1", "e_c_e_1"} <= returned_edge_ids
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids
    assert {"c", "b", "d", "e"} <= returned_node_ids
