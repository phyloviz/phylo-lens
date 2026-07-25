# Input formats

PhyloLens accepts graph topology and sample metadata as separate inputs. The
service normalizes every supported source into one canonical graph before layout
preparation. Downstream clustering, persistence, viewport queries, and rendering
do not depend on the original source format.

## Supported sources

| Source | `format` / `sourceFormat` | Purpose |
| --- | --- | --- |
| Newick | `newick` | Import one phylogenetic tree or a disconnected forest |
| Typing profiles | `typing_data` | Derive a goeBURST relationship graph from MLST/cgMLST allelic profiles |
| Ancillary table | `ancillary_data` | Join epidemiological, clinical, geographic, or other sample attributes to graph nodes |
| Direct metadata | `metadata_schema` and `metadata_by_node_id` | Supply typed metadata programmatically |

The public browser API exposes the same input concepts as
`POST /api/graph/prepare`. See the [client API](../code/client/README.md) and
[HTTP API reference](./API_REFERENCE.md).

## Newick

### Accepted structure

PhyloLens accepts standard parenthesized Newick topology with:

- leaf labels;
- labeled or unlabeled internal nodes;
- branch lengths;
- quoted labels, including escaped single quotes;
- Newick comments enclosed in `[...]`;
- one tree with or without a trailing semicolon;
- multiple semicolon-terminated trees in one document.

Example:

```newick
('isolate 1':1.0,('isolate 2':2.0,'isolate 3':4.0)'internal clade':3.0)root;
```

A multi-tree document is interpreted as a **forest**. Components remain
disconnected; PhyloLens does not add a synthetic root or connecting edges.
Generated identifiers are namespaced per component to avoid collisions.

### Node identifiers

Explicit labels are normalized to stable, lowercase slug identifiers. For
example:

```text
"Isolate 42 / Lisbon" → isolate_42_lisbon
```

Unlabeled leaves and internal nodes receive deterministic generated identifiers
based on traversal order. Explicit labels are preferred whenever metadata must
be joined to a node.

Because normalization can transform punctuation and whitespace, applications
that provide `metadata_by_node_id` should use the canonical identifiers expected
by the graph, not presentation labels with arbitrary formatting.

### Branch lengths and edge distances

Newick branch lengths become canonical edge distances.

- finite, non-negative values are preserved;
- negative values are clamped to `0` and produce a warning;
- non-finite values are rejected;
- when **all** edges omit branch lengths, the normalizer assigns distance `1.0`
  to every edge and records a warning;
- when only some edges omit branch lengths, preparation rejects the graph because
  every edge entering threshold-based clustering must have a distance.

The all-unweighted fallback preserves topology but does not create biological
branch-length information. Any evaluation that relies on phylogenetic distance
should use a weighted input.

### Empty children and parser warnings

The parser tolerates selected dialect variations, including benign trailing
separators emitted by some tools. Recoverable conditions are returned in the
prepare result `warnings`. Structurally invalid Newick is rejected before job
submission.

### Metadata joins for Newick

Ancillary tables are joined only to **explicitly labeled** Newick nodes.
Generated identifiers for unlabeled leaves or internal nodes are not considered
stable external join targets.

## Typing profiles

### Purpose

`typing_data` accepts an allelic-profile matrix and derives a relationship graph
through the bundled PhyloLib command-line application:

```text
profile matrix
  → Hamming distance matrix
  → goeBURST (lvs = 3)
  → Newick tree or forest
  → canonical PhyloLens graph
```

The current service uses:

```text
java -jar /app/phylolib.jar distance hamming
java -jar /app/phylolib.jar algorithm goeburst --lvs=3
```

This path is appropriate for MLST and cgMLST-style profiles represented as
categorical allele identifiers. The resulting graph is a typing-derived
relationship structure; it should not be described as an inferred evolutionary
phylogeny without an analysis that supports that interpretation.

### Table contract

The content is passed to PhyloLib as an `ml:` dataset. It is expected to contain:

- a header row;
- one identifier column followed by locus columns;
- one profile per row;
- tab-separated values.

Example:

```tsv
ST	adk	fumC	gdh
ST1	1	2	4
ST2	1	3	4
ST3	8	9	10
```

The first-column identifiers become graph node labels after goeBURST/Newick
conversion. Locus names are used by PhyloLib when interpreting the profile
matrix; they are not automatically exposed as node metadata.

### Disconnected output

PhyloLib may emit one Newick component per disconnected goeBURST component.
PhyloLens parses each component and merges them into one disconnected canonical
graph. No sequence type or profile is discarded solely because it belongs to a
separate component.

### Timeout and failures

Each PhyloLib subprocess has a configurable timeout. A timeout, unreadable JAR,
Java failure, malformed profile matrix, or invalid PhyloLib output fails the
prepare request with a structured job error. Unlike Graphviz layout failures,
typing-data conversion has no circular-layout fallback because it is required to
construct the topology itself.

## Ancillary metadata

Ancillary metadata is supplied independently from topology:

```ts
ancillaryData: {
  format: "tsv",
  join_column: "id",
  content: ancillaryTsv,
}
```

The HTTP field names are:

```json
{
  "ancillary_data": {
    "format": "tsv",
    "join_column": "id",
    "content": "..."
  }
}
```

### Supported table formats

| Value | Delimiter behavior |
| --- | --- |
| `csv` | comma |
| `tsv` | tab |
| `auto` | tab when the first line contains a tab; otherwise comma |

The first row must contain headers. `join_column` is required and must name one
of those headers. Blank join values are ignored.

### Join resolution

For each row, the service attempts:

1. an exact match against a canonical node identifier;
2. a match after applying the same slug normalization used for Newick labels.

For Newick, the eligible targets are explicitly labeled nodes. For typing data,
all canonical profile nodes are eligible.

Unmatched rows and graph nodes without ancillary rows do not fail preparation;
they produce warnings.

### Multiple rows per graph node

Multiple ancillary rows may map to the same node, which is common when several
isolates share one sequence type or allelic profile. PhyloLens stores the original
joined rows and derives one node-level summary:

- one distinct value is preserved as that scalar value;
- multiple distinct values are joined into a semicolon-separated string in
  first-seen order;
- an internal profile count records the number of joined rows;
- internal per-category counts support distribution visualizations.

Internal aggregation keys are excluded from the published metadata schema and
from search and region summaries. They remain in renderer metadata attached to
viewport nodes and representatives so the browser can construct profile counts
and categorical distribution wheels.

### Conflicts with direct metadata

Metadata is merged per node and per field. Values supplied directly through
`metadata_by_node_id` take precedence over values derived from ancillary rows for
the same node and key.

### Reserved keys

Callers must not define keys reserved for internal aggregation, including
`profile_count` and keys beginning with the internal category-count prefix.
Reserved keys are rejected during normalization.

## Direct typed metadata

Applications may provide metadata without a tabular file:

```ts
metadataSchema: [
  { key: "country", type: "string" },
  { key: "year", type: "number" },
  { key: "resistant", type: "boolean" },
],
metadataByNodeId: {
  isolate_a: { country: "Portugal", year: 2024, resistant: true },
},
```

Supported canonical types are:

| Type | Values |
| --- | --- |
| `string` | text |
| `number` | finite numeric values |
| `boolean` | `true` or `false` |
| `null` | null-only field |

Declared types control coercion. When no schema is supplied, the service infers
field types from observed values and publishes the resulting public schema with
the prepared layout.

## Reproducibility and identity

The content-derived `layout_version` includes:

- canonical topology and distances;
- node fields;
- metadata schema and metadata values;
- original ancillary rows after normalization;
- source format and stable source semantics;
- the explicit layout-pipeline version.

Equivalent dictionaries are serialized canonically, so insertion order does not
change the fingerprint. Changing persisted metadata invalidates reuse even when
topology is unchanged.

## Example files

The [`examples`](../examples/README.md) directory contains weighted and unweighted
Newick fixtures, a PHYLOViZ-derived *Streptococcus pneumoniae* tree, and matching
TSV ancillary metadata.
