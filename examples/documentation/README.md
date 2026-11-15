# Documentation examples

These synthetic examples are used for the visual manual and browser checks.
They contain no research or personal data.

- `overview.nwk`: a fully labelled, balanced 127-node tree and a separate
  three-node component. Every branch length is one arbitrary example unit.
- `overview-ancillary.csv`: deterministic fictional country observations, one
  per canonical input label, for illustrating colors and pies.
- `detail-groups.nwk`: a fully labelled 4,095-node balanced tree, large enough
  to demonstrate automatic levels of detail with the default viewer settings.
- `typing.tsv`: five synthetic isolates, four unique four-locus profiles.
  At nLV 3 it yields a three-profile component and an isolated fourth profile.
- `typing-ancillary.csv`: one fictional country observation per original isolate.

Newick branch units are illustrative path-length units; they are not allelic
distances. The typing fixture's Hamming distances are AB=1, AC=4, AD=4, BC=3,
BD=4 and CD=4. A and A2 have the same profile. The two inference modes and nLV
boundaries are also checked against this hand-calculated oracle in server tests.

Regenerate and verify screenshots with the workflow in
[the documentation maintenance guide](../../docs/DOCUMENTATION_SITE.md).
