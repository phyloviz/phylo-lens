# Typing correctness fixture

`missing-loci.tsv` and `missing-loci-ancillary.tsv` are synthetic, non-sensitive
inputs. Expected results are in `missing-loci.expected.json`.

L3 is excluded because iso-A has 0; L4 is excluded because iso-C has 0.
All pairwise distances use the same remaining loci L1 and L2. In particular,
iso-B / iso-D has distance 2 (not 3 even though neither row has a zero).
The matrix is hand-checkable and is not a PHYLOViZ Online export.

iso-A and iso-B must eventually share one profile node with count 2 and a
50/50 Portugal/Spain country pie. The expected profile groups specify issue #10;
the grouping implementation is covered by the profile-membership regression tests.

Real-PhyloLib integration requires the pinned service runtime. Unit tests also
verify the normalized matrix supplied to the conversion boundary, independently
of Java, Graphviz and Docker availability.
