# Typing distance reference audit — 2026-09-17

The reported maximum-distance discrepancy is resolved: **both trees have maximum
edge distance 90**, not 90 versus 91. No change to PhyloLens distance computation
is required. This completes the numerical reference evidence for #9 and adds
membership/topology evidence for #10.

## Inputs and methods

The researcher supplied 403 isolates with 3044 loci. Global exclusion of every
locus containing the token `0` removes 1940 loci and retains 1104. The supplied
PHYLOViZ Online2 export contains exactly those retained names and indices, all
403 original profiles, and the same 303 groups of equivalent profiles.

The audit executes the repository-pinned PhyloLib 1.0.1 JAR using `distance hamming`
and `algorithm goeburstfullmst`, retaining duplicate profiles at the algorithm
boundary. This run used Amazon Corretto OpenJDK 21.0.7 on macOS ARM64. Direct
Hamming counts provide an independent numerical oracle; Kruskal on the complete
unique-profile graph certifies minimum spanning weights without relying on
PhyloLib's choice among equal-distance links.

The Online export has no stored `distanceMatrix`. Its `subsetProfiles` were
matched to node IDs by the export's ordering, then individually verified against
the local retained profiles. All representative-pair distances were reconstructed
from these verified profiles. This is not a claim that a stored Online matrix
was downloaded or that its server-side tie-breaking implementation was executed.

## Results

| Check | Result |
| --- | ---: |
| Original profiles and isolate membership matching Online | 403 / 403 |
| Unique profiles matching Online | 303 / 303 |
| PhyloLib isolate-pair distances checked against direct Hamming | 81 003 |
| Online reconstructed unique-profile pairs checked against PhyloLib | 45 753 |
| Pair-distance mismatches | 0 |
| Exported Online edges checked against direct Hamming | 302 / 302 |
| Edges in each contracted tree | 302 |
| Shared edges after aligning profile identity | 300 |
| Alternative edges in each tree | 2 |
| Weights of the alternative edges | 21 and 22 in each tree |
| Maximum edge distance | 90 in each tree |
| Total edge distance | 3573 in each tree |
| Minimum-spanning certificate | Both trees match independent Kruskal weights |

The two alternative edges are compatible with choices between equal-weight MST
connections. Exact goeBURST tie-breaking parity is not asserted or required by
#9; distances, membership and minimum spanning weights agree.

## Why the Online interface reported 91

In the deployed [graphFunctions.js](https://online2.phyloviz.net/javascripts/App/main/graphFunctions.js),
`maxLinkValue` is calculated from actual link values and then incremented by one.
The deployed [buttonsFunctions.js](https://online2.phyloviz.net/javascripts/App/main/buttonsFunctions.js)
uses that incremented value both for control bounds and the dataset information
field labelled **Max. Link Distance**. Thus a tree whose maximum edge is 90 is
reported as 91 in that information field. The earlier project notes mistook this
presentation value for an edge-distance discrepancy; those notes are superseded
by the direct export comparison here. PhyloLens should not add one to distances
to reproduce that display value.

## Reproduce locally

Save the JSON response from the shared dataset's read-only
`GET /api/utils/phylovizInput?dataset_id=<shared-dataset-token>` endpoint. Keep the
export and input TSV outside the repository. The streaming `/nodes` endpoint was
not required; it timed out during this audit.

```sh
.venv/bin/python scripts/audit-typing-reference.py \
  /path/to/profiles.tsv /path/to/online-export.json \
  --phylolib-jar /path/to/phylolib.jar
```

The command checks the JAR against `code/server/phylolib.jar.sha256`, runs both
Java stages in a temporary directory, validates every comparison, and prints only
aggregate counts and SHA-256 hashes. It makes no network requests and does not
change the application. Any failed invariant exits unsuccessfully.

Synthetic tests cover reordered matrix IDs, corrupted distances and matrices,
changed Online profiles/membership/loci, nonminimum trees with valid edge values,
and valid equal-weight alternative trees:

```sh
.venv/bin/pytest code/server/tests/test_typing_reference_audit.py -q
```

Input fingerprints for this run (raw files and the private share token are not
committed):

- Profiles: `b2e8a4749b8dbd61482f764953cd006085f0bdd599e4c7bac11e22aee92643ab`
- Online JSON export: `863c307cfc9d38d7389293ebf53d4a31356f5a7c96a8e459fb24692f2861b5c9`
- PhyloLib JAR: `3bf2020ec474a177682ccb2dc1b5b5c71f39e16f4e2012e24cfb8cbbaa673503`
- Online graphFunctions.js: `5184eb74781b3b3758bd095f21d258673370b6f8ef54c1c68eb33cfe60be91ee`
- Online buttonsFunctions.js: `ce73af69afe51bc12b26c97c6e3e250e0d2c91510a3dbdfb7b1c6bd93177d70c`
