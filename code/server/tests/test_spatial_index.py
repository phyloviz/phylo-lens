from phylo_lens_server.clustering.spatial_index import (
    build_str_spatial_index,
    query_spatial_index,
)
from phylo_lens_server.core.models import SpatialBounds


def test_str_spatial_index_returns_only_intersecting_clusters() -> None:
    index = build_str_spatial_index(
        2,
        [
            ("left", SpatialBounds(min_x=-100, max_x=-50, min_y=-20, max_y=20)),
            ("center", SpatialBounds(min_x=-10, max_x=10, min_y=-20, max_y=20)),
            ("right", SpatialBounds(min_x=50, max_x=100, min_y=-20, max_y=20)),
        ],
        node_capacity=2,
    )

    assert index.root_node_index is not None
    assert len(index.nodes) > 1

    matches = query_spatial_index(index, (-25, 25, -30, 30))

    assert matches == {"center"}


def test_str_spatial_index_keeps_boundary_intersections() -> None:
    index = build_str_spatial_index(
        1,
        [
            ("touching", SpatialBounds(min_x=10, max_x=20, min_y=0, max_y=10)),
            ("outside", SpatialBounds(min_x=30, max_x=40, min_y=0, max_y=10)),
        ],
        node_capacity=2,
    )

    matches = query_spatial_index(index, (0, 10, 0, 10))

    assert matches == {"touching"}
