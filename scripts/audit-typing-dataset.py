"""Audit local typing inputs without copying isolate data into the repository.

Run with the server environment, for example:
  .venv/bin/python scripts/audit-typing-dataset.py profiles.tsv metadata.tsv

JSON output contains aggregate counts and file hashes, never isolate IDs or
metadata values. Expected groups are computed from profiles, not a rendered tree.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "code/server/src"))

from phylo_lens_server.data.parsers import slugify_label
from phylo_lens_server.data.typing_profiles import prepare_typing_profiles


def audit(profiles_path: Path, metadata_path: Path, join_column: str | None) -> dict:
    raw = profiles_path.read_bytes()
    prepared = prepare_typing_profiles(raw.decode("utf-8-sig"))
    reader = csv.reader(StringIO(prepared.content), delimiter="\t")
    header = next(reader)
    profiles = list(reader)
    groups: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for row in profiles:
        groups[tuple(row[1:])].append(row[0])
    ids = {row[0] for row in profiles}
    canonical_ids = [slugify_label(row[0]) for row in profiles]

    ancillary_raw = metadata_path.read_bytes()
    ancillary = csv.DictReader(
        StringIO(ancillary_raw.decode("utf-8-sig")), delimiter="\t"
    )
    key = join_column or header[0]
    if not ancillary.fieldnames or key not in ancillary.fieldnames:
        raise ValueError("Metadata does not contain the requested join column.")
    metadata = list(ancillary)
    if any(None in row or any(v is None for v in row.values()) for row in metadata):
        raise ValueError("Metadata rows must have the header's column count.")
    metadata_ids = [row[key].strip() for row in metadata]
    metadata_id_set = set(metadata_ids)
    sizes = Counter(len(members) for members in groups.values())
    return {
        "profiles_sha256": hashlib.sha256(raw).hexdigest(),
        "metadata_sha256": hashlib.sha256(ancillary_raw).hexdigest(),
        "policy": "exclude_loci_with_zero",
        "isolate_count": len(profiles),
        "input_locus_count": len(prepared.retained_loci) + len(prepared.excluded_loci),
        "retained_locus_count": len(prepared.retained_loci),
        "excluded_locus_count": len(prepared.excluded_loci),
        "expected_profile_node_count": len(groups),
        "expected_group_size_distribution": dict(sorted(sizes.items())),
        "expected_zero_distance_pair_count": sum(
            len(members) * (len(members) - 1) // 2 for members in groups.values()
        ),
        "normalized_id_collisions": len(canonical_ids) - len(set(canonical_ids)),
        "empty_normalized_ids": sum(not value for value in canonical_ids),
        "metadata_row_count": len(metadata),
        "metadata_duplicate_ids": len(metadata_ids) - len(metadata_id_set),
        "metadata_blank_ids": sum(not value for value in metadata_ids),
        "isolates_without_metadata": len(ids - metadata_id_set),
        "metadata_ids_without_profiles": len(metadata_id_set - ids),
        "validation_scope": "input preprocessing and expected groups; not PhyloLib or renderer validation",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profiles", type=Path)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--join-column")
    args = parser.parse_args()
    print(json.dumps(audit(args.profiles, args.metadata, args.join_column), indent=2))


if __name__ == "__main__":
    main()
