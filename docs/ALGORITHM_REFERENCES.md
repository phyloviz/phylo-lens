# Algorithm references

Scientific methods, standard data structures, and PhyloLens policies have
different origins. The three books in the engineering skill guide software
design and refactoring; they are not the sources of the scientific algorithms.

| Mechanism | Foundation | Application in PhyloLens |
| --- | --- | --- |
| goeBURST inference | Francisco, Bugalho, Ramirez and Carriço (2009), [Global optimal eBURST analysis of multilocus typing data using a graphic matroid approach](https://link.springer.com/article/10.1186/1471-2105-10-152) | PhyloLib performs inference. The paper explains the graphic-matroid and greedy optimization foundation. The pinned executable establishes the exact Full MST and configurable nLV behavior used here; the paper alone does not establish those implementation details. |
| Global force-directed layout | Yifan Hu (2005), *Efficient and High Quality Force-Directed Graph Drawing*, cited by the official [Graphviz sfdp documentation](https://graphviz.org/docs/layouts/sfdp/) | The server invokes Graphviz sfdp. We use its implementation rather than reimplementing the paper. |
| Allelic connection candidates | The pigeonhole principle: at most k mismatches across k+1 nonempty blocks leaves an identical block. Related published work: Norouzi, Punjani and Fleet (CVPR 2012), [Fast Search in Hamming Space with Multi-Index Hashing](https://www.cs.toronto.edu/~norouzi/research/papers/multi_index_hashing.pdf) | `data/distance_connections.py` hashes categorical allele blocks, then verifies exact Hamming distances. This is a categorical threshold-filter adaptation, not a reproduction of the paper's binary nearest-neighbor system or its performance claims. At k ≥ the locus count, it enumerates qualifying component pairs directly. |
| Tree-path connection candidates | Standard centroid decomposition; see the [USACO Guide explanation](https://usaco.guide/plat/centroid) | `patristic_pairs` builds centroid radius buckets. Iterative traversal, pair ownership, component restrictions and decimal-distance handling are PhyloLens implementation choices. The tutorial explains the technique, not this exact algorithm. |
| Forest validation and subtree intervals | Standard depth-first traversal; see Chapter 12 of Antti Laaksonen's [Competitive Programmer's Handbook](https://cses.fi/book/book.pdf) | `domain/tree_index.py` validates forests and records traversal intervals for subtree operations. DFS is a general textbook technique, not a new phylogenetic method. |

PhyloLens defines its own rooted hop-depth LoD policy, representative selection,
component handling, metadata joins, and separation of distance overlays from the
authoritative forest. These combine established techniques with product-specific
decisions; no single paper specifies the complete pipeline. See
[LoD and clustering](LOD_AND_CLUSTERING.md), [tree indexing](TREE_INDEX.md), and
[distance operations](DISTANCE_OPERATIONS.md) for the implemented rules.

For the inference boundary, [typing-mode validation](validation/goeburst-modes.md)
records the PhyloLib version, executable checksum, inspected classes, duplicate
profile adaptation, and independent distance checks. Complete-locus deletion and
technical-root ranking are explicit PhyloLens policies; citing the goeBURST paper
does not establish parity with every PHYLOViZ implementation or setting.
