from phylo_lens_server.domain.preparation import (
    PreparationSummary,
    PreparedCluster,
    PreparedLayoutArtifacts,
    PreparedLayoutResult,
)
from phylo_lens_server.http.graph.schemas import GraphPrepareResponse, NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import prepare_layout_artifacts


def _dataset(dataset_name: str = "payload-tree"):
    return ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name=dataset_name,
            content="((a:1,b:2)c:3,d:4)root;",
        ).to_domain()
    ).dataset


def _result(
    *,
    clusters: tuple[PreparedCluster, ...] | None = None,
    layout_status: str = "ready",
) -> PreparedLayoutResult:
    dataset = _dataset()
    artifacts = (
        PreparedLayoutArtifacts(
            dataset=dataset,
            layout_version="layout-test",
            clusters=clusters,
        )
        if clusters is not None
        else prepare_layout_artifacts(dataset)
    )
    return PreparedLayoutResult(
        artifacts=artifacts,
        layout_status=layout_status,
    )


def _cluster(cluster_id: str, lod_level: int) -> PreparedCluster:
    return PreparedCluster(
        cluster_id=cluster_id,
        lod_level=lod_level,
        member_node_ids=("a",),
        representative_node_id="a",
    )


def test_prepare_result_payload_matches_prepare_response_shape() -> None:
    result = _result()

    payload = PreparationSummary.from_result(result, ()).model_dump(mode="json")

    response = GraphPrepareResponse.model_validate(payload)
    assert response.dataset_id == "payload-tree"
    assert payload["node_count"] == len(result.artifacts.dataset.nodes)
    assert payload["edge_count"] == len(result.artifacts.dataset.edges)
    assert payload["cluster_count"] == len(result.artifacts.clusters)
    assert payload["layout_status"] == "ready"
    assert payload["warnings"] == []


def test_prepare_result_payload_combines_submit_warnings() -> None:
    payload = PreparationSummary.from_result(
        _result(), ("submitted warning",)
    ).model_dump(mode="json")

    assert payload["warnings"] == ["submitted warning"]


def test_prepare_result_payload_counts_distinct_lod_levels() -> None:
    payload = PreparationSummary.from_result(
        _result(
            clusters=(
                _cluster("c1", 0),
                _cluster("c2", 1),
                _cluster("c3", 1),
                _cluster("c4", 1),
            )
        ),
        (),
    ).model_dump(mode="json")

    assert payload["cluster_count"] == 4
    assert payload["lod_tier_count"] == 2


def test_prepare_result_payload_preserves_minimum_lod_tier_count() -> None:
    payload = PreparationSummary.from_result(_result(clusters=()), ()).model_dump(
        mode="json"
    )

    assert payload["cluster_count"] == 0
    assert payload["lod_tier_count"] == 1
