"""Compact joint observations for LoD groups, shared by both SQL backends."""

import json
from collections import Counter

from phylo_lens_server.domain.ancillary import AncillaryObservation
from phylo_lens_server.domain.metadata_keys import is_internal_metadata_key


def load_cluster_distributions(
    connection, *, dataset_id, layout_version, cluster_ids, placeholder="?"
):
    if not cluster_ids:
        return {}
    ids = sorted(cluster_ids)
    rows = connection.execute(
        f"""select cm.cluster_id,
                   coalesce(pi.metadata_json, nm.metadata_json, '{{}}') as data,
                   count(*) as frequency
            from cluster_members cm
            left join profile_isolates pi
              on pi.dataset_id = cm.dataset_id and pi.layout_version = cm.layout_version
              and pi.node_id = cm.node_id
            left join node_metadata nm
              on nm.dataset_id = cm.dataset_id and nm.layout_version = cm.layout_version
              and nm.node_id = cm.node_id
            where cm.dataset_id = {placeholder} and cm.layout_version = {placeholder}
              and cm.cluster_id in ({",".join([placeholder] * len(ids))})
            group by cm.cluster_id, coalesce(pi.metadata_json, nm.metadata_json, '{{}}')""",
        (dataset_id, layout_version, *ids),
    ).fetchall()
    counts = {}
    for row in rows:
        data = {
            key: value
            for key, value in json.loads(row["data"]).items()
            if not is_internal_metadata_key(key)
        }
        key = json.dumps(data, sort_keys=True, ensure_ascii=False)
        counts.setdefault(row["cluster_id"], Counter())[key] += row["frequency"]
    return {
        cluster: tuple(
            AncillaryObservation(values=json.loads(data), count=count)
            for data, count in sorted(distribution.items())
        )
        for cluster, distribution in counts.items()
    }
