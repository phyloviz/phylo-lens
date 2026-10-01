# Rooted-hop representation growth experiment (PR #38)

This is the frozen exploratory comparison against the selection policy in PR #38.
`CURRENT` denotes that historical powers-of-two baseline, not the policy
implemented by this follow-up. `nearest` here minimizes absolute count error;
production instead minimizes multiplicative error in log space, uses gamma 2,
and removes cuts redundant with full detail. The viewport-budget section also
records historical behaviour; see `docs/LOD_AND_CLUSTERING.md` and
`docs/API_REFERENCE.md` for the implemented policy and current API.

Reproduce the frozen comparison from repository root:

```sh
rtk proxy .venv/bin/python scripts/evaluate_lod_growth.py
rtk proxy .venv/bin/python -m pytest scripts/test_evaluate_lod_growth.py code/server/tests/test_prepared_layout.py code/server/tests/test_lod_schema.py -q
```

## Current policy and formula

`selected_depths(max_depth, max_levels=12)` starts at zero, appends powers of two strictly below maximum while reserving one slot for maximum, then appends maximum. Negative depths or fewer than one level raise; depth zero or a one-level budget returns only maximum. For maximum 12000: `[0,1,2,4,8,16,32,64,128,256,512,12000]`. Membership remains rooted-hop only.

For a rooted forest, deleting the explicit prefix leaves one connected component per depth d+1 node. Thus the actual `clusters_at_depth()` count is precisely prefix size plus n[d+1]. This includes singleton hidden branches. R is nondecreasing: R(d+1)-R(d)=n[d+2] before the final cut. For positive maximum depth, the last two counts are always equal, not merely sometimes equal: maximum-depth children are singleton branches. Maximum remains explicitly selected.

## Candidate rules

The isolated helper derives a contiguous histogram and all counts, starts at zero, and advances toward gamma times the previous count. Threshold uses the first count at or above target; nearest compares both bracketing counts, breaks ties toward smaller depth, and canonicalizes plateaus to their earliest depth. Only strictly growing intermediate counts qualify. When target exceeds the final count, selection stops and maximum is appended. No level cap. Finite gamma must exceed one. Precomputation is O(N+D); bisect selection costs O(L log D). Tests include rooted forests, deterministic generated forests at every cut, invalid inputs, deterministic selection, and the final plateau.

All selected depths in all five cases were checked with real clusters and independent checks of exact coverage, connectivity, one boundary edge, attachment depth, refinement, and singleton finest detail. No sibling grouping is introduced.

## Summary

Each cell gives **levels / sum R / largest multiplicative jump**. T = threshold, N = nearest. Full exact counts, ratios, depths, histogram runs, absolute jumps, and membership rows are in `lod_growth_results.json` and in the per-case appendix below.

| Tree (nodes, maximum depth) | Current | T 1.5 | T 2 | T 2.5 | N 1.5 | N 2 | N 2.5 |
|---|---|---|---|---|---|---|---|
| path (12,001, 12,000) | 12 / 13,046 / 23.35× | 22 / 36,261 / 1.67× | 14 / 28,383 / 2.00× | 11 / 25,540 / 2.60× | 23 / 36,284 / 1.50× | 14 / 28,383 / 2.00× | 11 / 24,155 / 2.50× |
| balanced (8,191, 12) | 6 / 9,302 / 16.24× | 13 / 24,559 / 2.33× | 13 / 24,559 / 2.33× | 7 / 13,645 / 5.00× | 13 / 24,559 / 2.33× | 13 / 24,559 / 2.33× | 12 / 16,368 / 2.33× |
| star (10,001, 1) | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× | 2 / 20,002 / 1.00× |
| irregular (2,314, 1,200) | 12 / 14,492 / 223.20× | 4 / 5,109 / 223.20× | 4 / 5,667 / 223.20× | 3 / 3,435 / 223.20× | 4 / 5,109 / 223.20× | 4 / 5,667 / 223.20× | 3 / 3,435 / 223.20× |
| phyloviz-spneumoniae (379, 25) | 7 / 867 / 2.87× | 9 / 1,015 / 2.33× | 7 / 731 / 2.87× | 6 / 860 / 5.00× | 11 / 1,353 / 2.33× | 8 / 882 / 2.33× | 7 / 841 / 2.87× |

## Interpretation and storage

Path gamma 2 uses cuts through 8190 before final 12000: maximum absolute jump falls from 11487 to 4096, maximum ratio from 23.35 to 2. The balanced binary gamma 2.5 threshold skips alternate depths and reaches a 5× jump, whereas nearest takes mostly consecutive depths and peaks at 2.33×. Gamma 1.5 and 2 both select every depth on binary because one hop already exceeds their targets; their final step is count-identical. Nearest is materially different on the realistic fixture as well, so neither is silently preferred by the implementation.

Star cut zero already has root + 10000 singleton child branches, R=10001. Cut one also has 10001. A hypothetical whole-tree representation would jump from 1 to 10001; rooted-hop cuts cannot interpolate this. The irregular tree jumps from R(0)=5 to R(1)=1116 (223.2×), unavoidable with any depth selector. These are topology limitations, not selector defects. The existing realistic PHYLoviZ Newick fixture is only 8212 bytes and was parsed locally using the real parser, with its existing component roots.

Across threshold experiments, sum R ranges from 1.48N to 3.02N. Geometric growth bounds intermediate cluster-record sums: for fixed gamma, sum R <= (gamma/(gamma-1)+1)N, including an additional explicit final level. This is a conservative bound that covers the final count plateau. Nearest does not enforce gamma growth per step; do not apply that proof to it. Its observed sums range from 1.48N to 3.57N.

However cluster membership is stored per level: exactly N×L rows, not sum R. Path gamma 1.5: 264022 membership rows versus current 144012; gamma 2: 168014; gamma 2.5: 132011. For fixed gamma threshold has O(log N) levels and therefore O(N log N) membership materialization in the worst case. Removing the cap does not make all stored state linear. Prepared edges and layout work also merit measurement before adoption; this experiment reports counts rather than runtime/byte benchmarks.

## Exact current viewport budget behavior

Client default is 6000 (`viewportQuery.ts`); server query default is 2500 with validated range 1..20000 (`http/graph/schemas.py`), for viewport and region requests. An invalid HTTP budget fails validation; the 20000 bound is a request limit, not a strict final response-size bound. Client camera ratio and tier count select the tier independently of the budget. Server honors explicit lod_level; otherwise zoom < 1 selects zero and zoom >= 1 selects original detail. Finest or higher requested level resolves to original nodes rather than prepared representatives.

Both SQLite and PostgreSQL first select the tier and filter spatially, then LIMIT. Cluster filtering uses overlapping cluster bounding boxes and non-null x; representatives sort by member_count DESC, cluster_id ascending. Edges survive only when both returned representatives are present. Equal-sized clusters can be omitted by lexical ID order; large aggregates win over small explicit nodes. There is no topology-coverage guarantee or automatic fallback to a smaller tier.

Original detail filters node positions by viewport, sorts by cluster_id then node_id ascending, and limits the initial slice. It then adds ALL one-hop neighbors of that slice and incident edges, without applying the original budget again. Consequently responses can exceed max_nodes (even 20000). Their total_node_count is the spatial count plus surfaced neighbor count; their truncated flag compares that total with final returned count. With no bounds, omitted initial nodes can be added as neighbors and still leave truncated=true, because this count includes additions. It is not necessarily a distinct global-node count.

Cluster expansion sorts the focused node first, then node_id, limits members, and may append adjacent representatives. Its total counts members but truncated compares that against members plus neighbor representatives, potentially masking a missing member. Existing tests exercise limited expansion and detail neighbor surfacing. Region requests instead return only in-bounds nodes and internal edges.

`truncated=true` is NOT the only client signal: responses also include total_node_count and returned nodes/edges. They provide no omitted-region identities or coverage map. Deterministic ID ordering can omit arbitrary topological regions. The budget constrains query slices rather than tier selection today.

## Recommendation

Representation growth is a sound basis for replacing powers-of-two hop spacing: it adapts to topology and removes cap-induced jumps. Gamma 2 is a useful starting point, with both policies retained for review: threshold has the stronger geometric-storage argument, while nearest visibly improves some overshoots. It cannot solve unavoidable one-hop branching explosions or enforce a rendering budget. Before production adoption, account for N×L membership storage and design budget-aware tier choice with an explicit response when even cut zero is over budget. The offline script does not implement that redesign. The follow-up production
implementation now selects tiers from prospective viewport counts; see the
current documentation linked above.

## Exact per-case results

Histogram runs are `[first_depth, last_depth, nodes_per_depth]`. Ratios below are rounded for readability; JSON preserves floating precision.

### path

Maximum depth: 12000; nodes: 12001. Histogram runs: `[[0, 12000, 1]]`. Invariants: passed.

**CURRENT**

- Depths: `[0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 12000]`
- R: `[2, 3, 4, 6, 10, 18, 34, 66, 130, 258, 514, 12001]`
- Ratios: `[1.5, 1.3333, 1.5, 1.6667, 1.8, 1.8889, 1.9412, 1.9697, 1.9846, 1.9922, 23.3482]`
- Levels: 12; sum R: 13046; membership rows: 144012; max absolute jump: 11487; max multiplicative jump: 23.3482.

**threshold gamma=1.5**

- Depths: `[0, 1, 3, 6, 10, 16, 25, 39, 60, 91, 138, 208, 313, 471, 708, 1063, 1596, 2395, 3594, 5392, 8089, 12000]`
- R: `[2, 3, 5, 8, 12, 18, 27, 41, 62, 93, 140, 210, 315, 473, 710, 1065, 1598, 2397, 3596, 5394, 8091, 12001]`
- Ratios: `[1.5, 1.6667, 1.6, 1.5, 1.5, 1.5, 1.5185, 1.5122, 1.5, 1.5054, 1.5, 1.5, 1.5016, 1.5011, 1.5, 1.5005, 1.5, 1.5002, 1.5, 1.5, 1.4833]`
- Levels: 22; sum R: 36261; membership rows: 264022; max absolute jump: 3910; max multiplicative jump: 1.6667.

**nearest gamma=1.5**

- Depths: `[0, 1, 2, 4, 7, 11, 17, 26, 40, 61, 92, 139, 209, 314, 472, 709, 1064, 1597, 2396, 3595, 5393, 8090, 12000]`
- R: `[2, 3, 4, 6, 9, 13, 19, 28, 42, 63, 94, 141, 211, 316, 474, 711, 1066, 1599, 2398, 3597, 5395, 8092, 12001]`
- Ratios: `[1.5, 1.3333, 1.5, 1.5, 1.4444, 1.4615, 1.4737, 1.5, 1.5, 1.4921, 1.5, 1.4965, 1.4976, 1.5, 1.5, 1.4993, 1.5, 1.4997, 1.5, 1.4999, 1.4999, 1.4831]`
- Levels: 23; sum R: 36284; membership rows: 276023; max absolute jump: 3909; max multiplicative jump: 1.5000.

**threshold gamma=2.0**

- Depths: `[0, 2, 6, 14, 30, 62, 126, 254, 510, 1022, 2046, 4094, 8190, 12000]`
- R: `[2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 12001]`
- Ratios: `[2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 1.465]`
- Levels: 14; sum R: 28383; membership rows: 168014; max absolute jump: 4096; max multiplicative jump: 2.0000.

**nearest gamma=2.0**

- Depths: `[0, 2, 6, 14, 30, 62, 126, 254, 510, 1022, 2046, 4094, 8190, 12000]`
- R: `[2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 12001]`
- Ratios: `[2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 1.465]`
- Levels: 14; sum R: 28383; membership rows: 168014; max absolute jump: 4096; max multiplicative jump: 2.0000.

**threshold gamma=2.5**

- Depths: `[0, 3, 11, 31, 81, 206, 518, 1298, 3248, 8123, 12000]`
- R: `[2, 5, 13, 33, 83, 208, 520, 1300, 3250, 8125, 12001]`
- Ratios: `[2.5, 2.6, 2.5385, 2.5152, 2.506, 2.5, 2.5, 2.5, 2.5, 1.477]`
- Levels: 11; sum R: 25540; membership rows: 132011; max absolute jump: 4875; max multiplicative jump: 2.6000.

**nearest gamma=2.5**

- Depths: `[0, 3, 10, 28, 73, 185, 465, 1165, 2915, 7290, 12000]`
- R: `[2, 5, 12, 30, 75, 187, 467, 1167, 2917, 7292, 12001]`
- Ratios: `[2.5, 2.4, 2.5, 2.5, 2.4933, 2.4973, 2.4989, 2.4996, 2.4998, 1.6458]`
- Levels: 11; sum R: 24155; membership rows: 132011; max absolute jump: 4709; max multiplicative jump: 2.5000.

### balanced

Maximum depth: 12; nodes: 8191. Histogram runs: `[[0, 0, 1], [1, 1, 2], [2, 2, 4], [3, 3, 8], [4, 4, 16], [5, 5, 32], [6, 6, 64], [7, 7, 128], [8, 8, 256], [9, 9, 512], [10, 10, 1024], [11, 11, 2048], [12, 12, 4096]]`. Invariants: passed.

**CURRENT**

- Depths: `[0, 1, 2, 4, 8, 12]`
- R: `[3, 7, 15, 63, 1023, 8191]`
- Ratios: `[2.3333, 2.1429, 4.2, 16.2381, 8.0068]`
- Levels: 6; sum R: 9302; membership rows: 49146; max absolute jump: 7168; max multiplicative jump: 16.2381.

**threshold gamma=1.5**

- Depths: `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
- R: `[3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 8191]`
- Ratios: `[2.3333, 2.1429, 2.0667, 2.0323, 2.0159, 2.0079, 2.0039, 2.002, 2.001, 2.0005, 2.0002, 1.0]`
- Levels: 13; sum R: 24559; membership rows: 106483; max absolute jump: 4096; max multiplicative jump: 2.3333.

**nearest gamma=1.5**

- Depths: `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
- R: `[3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 8191]`
- Ratios: `[2.3333, 2.1429, 2.0667, 2.0323, 2.0159, 2.0079, 2.0039, 2.002, 2.001, 2.0005, 2.0002, 1.0]`
- Levels: 13; sum R: 24559; membership rows: 106483; max absolute jump: 4096; max multiplicative jump: 2.3333.

**threshold gamma=2.0**

- Depths: `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
- R: `[3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 8191]`
- Ratios: `[2.3333, 2.1429, 2.0667, 2.0323, 2.0159, 2.0079, 2.0039, 2.002, 2.001, 2.0005, 2.0002, 1.0]`
- Levels: 13; sum R: 24559; membership rows: 106483; max absolute jump: 4096; max multiplicative jump: 2.3333.

**nearest gamma=2.0**

- Depths: `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
- R: `[3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 8191]`
- Ratios: `[2.3333, 2.1429, 2.0667, 2.0323, 2.0159, 2.0079, 2.0039, 2.002, 2.001, 2.0005, 2.0002, 1.0]`
- Levels: 13; sum R: 24559; membership rows: 106483; max absolute jump: 4096; max multiplicative jump: 2.3333.

**threshold gamma=2.5**

- Depths: `[0, 2, 4, 6, 8, 10, 12]`
- R: `[3, 15, 63, 255, 1023, 4095, 8191]`
- Ratios: `[5.0, 4.2, 4.0476, 4.0118, 4.0029, 2.0002]`
- Levels: 7; sum R: 13645; membership rows: 57337; max absolute jump: 4096; max multiplicative jump: 5.0000.

**nearest gamma=2.5**

- Depths: `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]`
- R: `[3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191]`
- Ratios: `[2.3333, 2.1429, 2.0667, 2.0323, 2.0159, 2.0079, 2.0039, 2.002, 2.001, 2.0005, 2.0002]`
- Levels: 12; sum R: 16368; membership rows: 98292; max absolute jump: 4096; max multiplicative jump: 2.3333.

### star

Maximum depth: 1; nodes: 10001. Histogram runs: `[[0, 0, 1], [1, 1, 10000]]`. Invariants: passed.

**CURRENT**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**threshold gamma=1.5**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**nearest gamma=1.5**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**threshold gamma=2.0**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**nearest gamma=2.0**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**threshold gamma=2.5**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

**nearest gamma=2.5**

- Depths: `[0, 1]`
- R: `[10001, 10001]`
- Ratios: `[1.0]`
- Levels: 2; sum R: 20002; membership rows: 20002; max absolute jump: 0; max multiplicative jump: 1.0000.

### irregular

Maximum depth: 1200; nodes: 2314. Histogram runs: `[[0, 0, 1], [1, 1, 4], [2, 2, 1111], [3, 1200, 1]]`. Invariants: passed.

**CURRENT**

- Depths: `[0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1200]`
- R: `[5, 1116, 1117, 1119, 1123, 1131, 1147, 1179, 1243, 1371, 1627, 2314]`
- Ratios: `[223.2, 1.0009, 1.0018, 1.0036, 1.0071, 1.0141, 1.0279, 1.0543, 1.103, 1.1867, 1.4222]`
- Levels: 12; sum R: 14492; membership rows: 27768; max absolute jump: 1111; max multiplicative jump: 223.2000.

**threshold gamma=1.5**

- Depths: `[0, 1, 559, 1200]`
- R: `[5, 1116, 1674, 2314]`
- Ratios: `[223.2, 1.5, 1.3823]`
- Levels: 4; sum R: 5109; membership rows: 9256; max absolute jump: 1111; max multiplicative jump: 223.2000.

**nearest gamma=1.5**

- Depths: `[0, 1, 559, 1200]`
- R: `[5, 1116, 1674, 2314]`
- Ratios: `[223.2, 1.5, 1.3823]`
- Levels: 4; sum R: 5109; membership rows: 9256; max absolute jump: 1111; max multiplicative jump: 223.2000.

**threshold gamma=2.0**

- Depths: `[0, 1, 1117, 1200]`
- R: `[5, 1116, 2232, 2314]`
- Ratios: `[223.2, 2.0, 1.0367]`
- Levels: 4; sum R: 5667; membership rows: 9256; max absolute jump: 1116; max multiplicative jump: 223.2000.

**nearest gamma=2.0**

- Depths: `[0, 1, 1117, 1200]`
- R: `[5, 1116, 2232, 2314]`
- Ratios: `[223.2, 2.0, 1.0367]`
- Levels: 4; sum R: 5667; membership rows: 9256; max absolute jump: 1116; max multiplicative jump: 223.2000.

**threshold gamma=2.5**

- Depths: `[0, 1, 1200]`
- R: `[5, 1116, 2314]`
- Ratios: `[223.2, 2.0735]`
- Levels: 3; sum R: 3435; membership rows: 6942; max absolute jump: 1198; max multiplicative jump: 223.2000.

**nearest gamma=2.5**

- Depths: `[0, 1, 1200]`
- R: `[5, 1116, 2314]`
- Ratios: `[223.2, 2.0735]`
- Levels: 3; sum R: 3435; membership rows: 6942; max absolute jump: 1198; max multiplicative jump: 223.2000.

### phyloviz-spneumoniae

Maximum depth: 25; nodes: 379. Histogram runs: `[[0, 0, 1], [1, 1, 2], [2, 2, 4], [3, 3, 8], [4, 5, 14], [6, 6, 20], [7, 7, 24], [8, 8, 12], [9, 9, 14], [10, 10, 20], [11, 11, 14], [12, 12, 20], [13, 13, 30], [14, 16, 28], [17, 17, 26], [18, 18, 22], [19, 19, 14], [20, 20, 12], [21, 21, 10], [22, 22, 6], [23, 23, 4], [24, 25, 2]]`. Invariants: passed.

**CURRENT**

- Depths: `[0, 1, 2, 4, 8, 16, 25]`
- R: `[3, 7, 15, 43, 113, 307, 379]`
- Ratios: `[2.3333, 2.1429, 2.8667, 2.6279, 2.7168, 1.2345]`
- Levels: 7; sum R: 867; membership rows: 2653; max absolute jump: 194; max multiplicative jump: 2.8667.

**threshold gamma=1.5**

- Depths: `[0, 1, 2, 3, 5, 7, 11, 14, 25]`
- R: `[3, 7, 15, 29, 63, 99, 167, 253, 379]`
- Ratios: `[2.3333, 2.1429, 1.9333, 2.1724, 1.5714, 1.6869, 1.515, 1.498]`
- Levels: 9; sum R: 1015; membership rows: 3411; max absolute jump: 126; max multiplicative jump: 2.3333.

**nearest gamma=1.5**

- Depths: `[0, 1, 2, 3, 4, 5, 7, 10, 13, 18, 25]`
- R: `[3, 7, 15, 29, 43, 63, 99, 147, 225, 343, 379]`
- Ratios: `[2.3333, 2.1429, 1.9333, 1.4828, 1.4651, 1.5714, 1.4848, 1.5306, 1.5244, 1.105]`
- Levels: 11; sum R: 1353; membership rows: 4169; max absolute jump: 118; max multiplicative jump: 2.3333.

**threshold gamma=2.0**

- Depths: `[0, 1, 2, 4, 6, 12, 25]`
- R: `[3, 7, 15, 43, 87, 197, 379]`
- Ratios: `[2.3333, 2.1429, 2.8667, 2.0233, 2.2644, 1.9239]`
- Levels: 7; sum R: 731; membership rows: 2653; max absolute jump: 182; max multiplicative jump: 2.8667.

**nearest gamma=2.0**

- Depths: `[0, 1, 2, 3, 5, 9, 14, 25]`
- R: `[3, 7, 15, 29, 63, 133, 253, 379]`
- Ratios: `[2.3333, 2.1429, 1.9333, 2.1724, 2.1111, 1.9023, 1.498]`
- Levels: 8; sum R: 882; membership rows: 3032; max absolute jump: 126; max multiplicative jump: 2.3333.

**threshold gamma=2.5**

- Depths: `[0, 2, 4, 8, 16, 25]`
- R: `[3, 15, 43, 113, 307, 379]`
- Ratios: `[5.0, 2.8667, 2.6279, 2.7168, 1.2345]`
- Levels: 6; sum R: 860; membership rows: 2274; max absolute jump: 194; max multiplicative jump: 5.0000.

**nearest gamma=2.5**

- Depths: `[0, 1, 2, 4, 8, 15, 25]`
- R: `[3, 7, 15, 43, 113, 281, 379]`
- Ratios: `[2.3333, 2.1429, 2.8667, 2.6279, 2.4867, 1.3488]`
- Levels: 7; sum R: 841; membership rows: 2653; max absolute jump: 168; max multiplicative jump: 2.8667.
