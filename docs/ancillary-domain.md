# Ancillary domain vocabulary

An isolate is an identified biological observation, an allelic profile describes
its typing result, and ancillary data describes additional observations about it.
Multiple isolates can share a retained allelic profile without losing their
individual identities or ancillary values. LoD clusters group graph profiles;
they are not additional isolates.

| Responsibility | Python | TypeScript |
| --- | --- | --- |
| Observed scalar values | `AncillaryData`, `AncillaryField` | `AncillaryData`, `AncillaryField` |
| Isolate identity and observations | `Isolate.ancillary_data` | `Isolate.ancillaryData` |
| Category frequencies | `AncillarySummary.category_counts` | `AncillarySummary.categoryCounts` |
| Represented isolate count | `ProfileSummary.isolate_count` | `ProfileSummary.isolateCount` |
| Node annotations | `NodeAnnotations` | `NodeAnnotations` |

Raw allele matrices still belong to the typing preparation pipeline. No duplicate
allele-vector model or new biological grouping policy is introduced here.

Scalar values produced by grouping (for example, a concatenated set of countries)
are stored in `AncillarySummary.values`, alongside category frequencies. Original
per-isolate values remain in `Isolate` ancillary data. Flat legacy records with
computed counts are decoded as node summaries; legacy records without counts
remain direct ancillary values.

## Compatibility boundaries

- API v1 response keys and SQL tables/columns retain the `metadata` spelling.
- The client decodes flat node metadata into annotations before presentation.
- Python canonical models accept legacy flat input, but store observations and
  summaries separately. Their native `model_dump()` uses the new model.
- Canonical `metadata_by_node_id` remains a compatibility snapshot, not a mutable
  backing store. New code should modify `annotations_by_node_id`.
- `view.load` prefers `ancillarySchema` / `ancillaryByNodeId`. Deprecated camelCase
  metadata aliases remain supported, and conflicting aliases are rejected.
- `ancillaryData` in load options is the existing tabular upload configuration;
  use `AncillaryTableInput` for that shape and `AncillaryData` for one record.
- Technical layout information and source provenance retain their own names.

No SQL migration or API version bump is required. Compatibility encoders retain
floating-point count serialization at the existing fingerprint boundary, even
though domain summary counts are integers. A regression fixture checks a layout
fingerprint captured before the refactor.

## Attach ancillary data after rendering

`view.applyAncillaryData(table)` replaces observations on a prepared tree without
recomputing distances, layout or profile membership. Typing tables join original
isolate IDs and regenerate profile summaries from all members, including unmatched
isolates whose ancillary values become empty. Newick tables join node IDs and may
aggregate several rows per node. The server publishes an immutable revision in a
single transaction; failures leave the source revision intact.
