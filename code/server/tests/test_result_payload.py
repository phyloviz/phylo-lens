from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.http.graph.schemas import GraphPrepareResponse
from phylo_lens_server.pipeline.ingest import prepare_layout_artifacts
from phylo_lens_server.pipeline.layout import LAYOUT_DEGRADED_SFDP_MISSING
from phylo_lens_server.pipeline.models import (
    PreparedCluster,
    PreparedLayoutArtifacts,
    PreparedLayoutResult,
)
from phylo_lens_server.repository.jobs.result_payload import (
    LAYOUT_DEGRADED_WARNING_FALLBACK,
    prepare_result_payload,
)


def _dataset(dataset_name: str = "payload-tree"):
    return normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name=dataset_name,
            content="((a:1,b:2)c:3,d:4)root;",
        )
    ).dataset


def _result(
    *,
    clusters: tuple[PreparedCluster, ...] | None = None,
    layout_status: str = "ready",
    degraded_reason: str | None = None,
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
        layout_degraded_reason=degraded_reason,
    )


def _cluster(cluster_id: str, threshold: float | None) -> PreparedCluster:
    return PreparedCluster(
        cluster_id=cluster_id,
        threshold=threshold,
        member_node_ids=("a",),
        representative_node_id="a",
        internal_edge_ids=(),
        boundary_edge_ids=(),
    )


def test_prepare_result_payload_matches_prepare_response_shape() -> None:
    result = _result()

    payload = prepare_result_payload(result, ())

    response = GraphPrepareResponse.model_validate(payload)
    assert response.dataset_id == "payload-tree"
    assert payload["node_count"] == len(result.artifacts.dataset.nodes)
    assert payload["edge_count"] == len(result.artifacts.dataset.edges)
    assert payload["cluster_count"] == len(result.artifacts.clusters)
    assert payload["layout_status"] == "ready"
    assert payload["warnings"] == []


def test_prepare_result_payload_combines_submit_warnings() -> None:
    payload = prepare_result_payload(_result(), ("submitted warning",))

    assert payload["warnings"] == ["submitted warning"]


def test_prepare_result_payload_adds_known_degraded_warning() -> None:
    payload = prepare_result_payload(
        _result(
            layout_status="degraded",
            degraded_reason=LAYOUT_DEGRADED_SFDP_MISSING,
        ),
        (),
    )

    assert len(payload["warnings"]) == 1
    assert "sfdp" in payload["warnings"][0]


def test_prepare_result_payload_uses_fallback_for_unknown_degraded_reason() -> None:
    payload = prepare_result_payload(
        _result(layout_status="degraded", degraded_reason="unknown"),
        (),
    )

    assert payload["warnings"] == [LAYOUT_DEGRADED_WARNING_FALLBACK]


def test_prepare_result_payload_uses_fallback_for_missing_degraded_reason() -> None:
    payload = prepare_result_payload(
        _result(layout_status="degraded", degraded_reason=None),
        (),
    )

    assert payload["warnings"] == [LAYOUT_DEGRADED_WARNING_FALLBACK]


def test_prepare_result_payload_counts_distinct_lod_thresholds() -> None:
    payload = prepare_result_payload(
        _result(
            clusters=(
                _cluster("c1", 3.0),
                _cluster("c2", 1.0),
                _cluster("c3", 1.0),
                _cluster("c4", None),
            )
        ),
        (),
    )

    assert payload["cluster_count"] == 4
    assert payload["lod_tier_count"] == 2


def test_prepare_result_payload_preserves_minimum_lod_tier_count() -> None:
    payload = prepare_result_payload(_result(clusters=()), ())

    assert payload["cluster_count"] == 0
    assert payload["lod_tier_count"] == 1
