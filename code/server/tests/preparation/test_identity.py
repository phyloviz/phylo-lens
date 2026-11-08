from phylo_lens_server.domain.ancillary import AncillaryField, AncillaryType
from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.sfdp import (
    SfdpOptions,
    SfdpOverlap,
    SfdpQuadtree,
    SfdpSmoothing,
)
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    prepare_layout_artifacts,
)
from tests.support.preparation import FORMAT_NEWICK, WEIGHTED_TREE
from tests.support.preparation import weighted_tree as _dataset


def test_sfdp_options_change_layout_version() -> None:
    dataset = _dataset()
    default_version = layout_version_for_dataset(dataset)

    variants = (
        SfdpOptions(k=0.75),
        SfdpOptions(repulsiveForce=2.0),
        SfdpOptions(prismIterations=10),
        SfdpOptions(overlap=SfdpOverlap.SCALE),
        SfdpOptions(overlapScaling=-2.0),
        SfdpOptions(smoothing=SfdpSmoothing.NONE),
        SfdpOptions(quadtree=SfdpQuadtree.FAST),
        SfdpOptions(beautify=True),
    )

    assert all(
        layout_version_for_dataset(dataset, options) != default_version
        for options in variants
    )


def test_technical_root_changes_layout_version_and_hop_orientation() -> None:
    dataset = _dataset()
    rerooted = dataset.model_copy(update={"technical_roots": ("c",)})
    assert layout_version_for_dataset(dataset) != layout_version_for_dataset(rerooted)
    first = prepare_layout_artifacts(dataset)
    second = prepare_layout_artifacts(rerooted)
    first_root = next(
        c for c in first.clusters if c.lod_level == 0 and c.member_node_ids == ("a",)
    )
    second_root = next(
        c for c in second.clusters if c.lod_level == 0 and c.member_node_ids == ("c",)
    )
    assert first_root.lod_level == second_root.lod_level == 0


def test_equivalent_resolved_sfdp_options_share_layout_version() -> None:
    dataset = _dataset()
    explicit_defaults = SfdpOptions(
        k=0.3,
        repulsiveForce=1.0,
        overlap=SfdpOverlap.PRISM,
        prismIterations=0,
        overlapScaling=-4.0,
        smoothing=SfdpSmoothing.SPRING,
        quadtree=SfdpQuadtree.NORMAL,
        beautify=False,
    )

    assert layout_version_for_dataset(dataset) == layout_version_for_dataset(
        dataset,
        explicit_defaults,
    )


def test_layout_version_changes_when_metadata_value_changes() -> None:
    dataset = _dataset()
    portugal = dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in ({"a": {"country": "PT"}}).items()
            },
        }
    )
    spain = dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in ({"a": {"country": "ES"}}).items()
            },
        }
    )

    assert layout_version_for_dataset(portugal) != layout_version_for_dataset(spain)


def test_layout_version_changes_when_metadata_field_is_added_or_removed() -> None:
    dataset = _dataset().model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in ({"a": {"country": "PT"}}).items()
            },
        }
    )
    with_added_field = dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                    AncillaryField(key="source", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                    AncillaryField(key="source", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in (
                    {"a": {"country": "PT", "source": "blood"}}
                ).items()
            },
        }
    )

    assert layout_version_for_dataset(dataset) != layout_version_for_dataset(
        with_added_field
    )


def test_layout_version_is_stable_for_same_metadata_with_different_dict_order() -> None:
    dataset = _dataset()
    first = dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="source", type=AncillaryType.STRING),
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="source", type=AncillaryType.STRING),
                    AncillaryField(key="country", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in (
                    {
                        "a": {"country": "PT", "source": "blood"},
                        "b": {"source": "csf", "country": "ES"},
                    }
                ).items()
            },
        }
    )
    second = dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                    AncillaryField(key="source", type=AncillaryType.STRING),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="country", type=AncillaryType.STRING),
                    AncillaryField(key="source", type=AncillaryType.STRING),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in (
                    {
                        "b": {"country": "ES", "source": "csf"},
                        "a": {"source": "blood", "country": "PT"},
                    }
                ).items()
            },
        }
    )

    assert layout_version_for_dataset(first) == layout_version_for_dataset(second)


def test_layout_version_reuses_independently_normalized_identical_requests() -> None:
    request = NormalizeRequest(
        format=FORMAT_NEWICK,
        dataset_name="reuse-tree",
        content=WEIGHTED_TREE,
        metadata_schema=[{"key": "country", "type": "string"}],
        metadata_by_node_id={"a": {"country": "PT"}},
    )

    first = ingest_dataset(request.to_domain()).dataset
    second = ingest_dataset(request.to_domain()).dataset

    assert first.source.generated_at != second.source.generated_at
    assert layout_version_for_dataset(first) == layout_version_for_dataset(second)
