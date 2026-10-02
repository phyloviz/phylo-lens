# Chapter 5 revision handoff

## What the author must attach

1. The current Chapter 5 LaTeX source, all tables it inputs, and its current PDF.
2. The supervisor feedback (included as `reference/supervisor-feedback.txt`).
3. This complete handoff bundle: current reports, protocol, audits, figure data,
   the updated generator, 14 generated figures and proposed captions.
   Completed RQ1 evidence is already included: 50 measurements + 10 excluded warm-ups.
4. Verified EnteroBase scheme/version, download date, original profiles/loci and
   subset extraction details, if the author can supply them. Missing details stay
   explicitly unresolved; retained Newick does not establish them.

This handoff does not include or change the thesis source. The current
bundle includes the completed RQ1 audit and its plotting observations, but omits large databases,
source trees and browser resource samples unnecessary for editorial work.
The separate Zenodo publication bundle preserves those reproducibility artefacts.

## Prompt to paste into ChatGPT

Revise my attached Chapter 5 LaTeX against the supervisor feedback, using the
attached current evidence bundle. Begin by reading eval/CURRENT_EVALUATION.md,
eval/CURRENT_RESULTS_20261002.md, the campaign REPORT.md files and audit results.
Use reports for definitions and caveats, JSON/CSV for numbers. The updated
generator is eval/tools/generate_chapter5_figures.py; delivered figure PDFs, CSVs
and proposed captions are in eval/results/derived/chapter5-figures-current/.

First produce a feedback-to-evidence checklist: resolved, partly resolved or
still missing, with exact source filenames. Then revise the chapter and its
included tables, preserving its scientific scope and linking every substantive
claim to the available measurements. Return a list of remaining questions; do
not invent data, causal explanations, versions, confidence intervals or a DOI.

Use the current local source fingerprint and base commit as the implementation
identity; package 0.2.2 alone is insufficient. Keep historical MSAGL and historical
external/RQ1 evidence explicitly distinct. Do not pool observations across
versions, platforms, protocols or repetitions. RQ1 is now complete and audited,
with 50 successful measurements and 10 excluded warm-ups. Replace old RQ1 values
with this current native-path campaign, explicitly describing the environment
change. At 200k its median is 100.023 s, versus 108.153 s in the current external
first-output campaign; the independent-campaign median difference is 8.130 s,
not a paired causal decomposition.

The current RQ4 has one excluded warm-up and seven measurements per scenario;
small=2, intermediate=88, large=3,796 members. Use measured HTTP/server/timer
phases rather than guessing that large latency is browser rendering. Phase
medians need not sum to the total median; nested phases must not be stacked.
RQ3 validates all 15 prepared levels against canonical membership, coordinates
and weighted quotient edges. Hop depth is not branch length or evolutionary
threshold. RQ2 replay workload units historically count triangle glyphs in
addition to their node representation: distinguish protocol units from unique
nodes+edges. Integrated RQ2 supplies the actual viewport link to prepared LoD.

Physical display refresh was not controlled. Nominal 100 Hz display-mode
metadata is available for the current campaign; do not infer physical refresh
from frame intervals. CPU equivalents are measured CPU-seconds/wall-seconds,
not physical cores used. External first-visual predicates and representations
differ; do not claim equivalent full-tree rendering. The historical ~60-second
cross-campaign difference has no measured causal decomposition. Current phase
measurements do not retrospectively explain it.

For historical MSAGL, show adapted-edge-input→tile-ready total alongside paired
per-observation total_ms-parse_ms, then summarize each distribution separately.
Its parse includes decoding/native graph construction; Newick adaptation and
first rendered frame were not measured. Do not label that total true
Newick→first-frame end-to-end or subtract medians to obtain the paired metric.
Do not claim weighted layout or label equivalence for this baseline.

Use consistent units and rounding with siunitx, explicit failure/invalid/warm-up
exclusion rules, figure references in the text and operational timing boundaries.
Keep unresolved provenance and measurement limitations visible.

Use the delivered title-free vector PDFs and plotting CSVs, selecting the relevant
figures for the chapter; not every auxiliary figure needs inclusion. Adapt the
proposed CAPTIONS.tex snippets, maintain their measurement limitations and add
figure references in the surrounding text. The current generator is already
updated and tested. If changing presentation, keep data and statistical boundaries
unchanged and regenerate using that script. Do not silently reuse old figures.
Return the revised chapter, included tables, proposed figure captions/references
and an explicit list of unresolved issues.

## Current figure inputs and requirements

| Figure | Input | Requirement |
|---|---|---|
| RQ1 time/RSS | Completed user RQ1 audited observations | Completed/audited; new native protocol, not historical OCI data |
| RQ2 replay time/heap | current-evidence observations.json + timing-dispersion.json | Five measured observations per condition; exclude warm-ups; distinguish workload units/unique graph elements |
| RQ2 integrated | Same observations, campaign rq2-integrated | Separate from replay; actual viewport workloads, not global prepared counts |
| RQ3 reduction | current-prepared-100k/rq3.json | All 15 discrete levels; grouped bars or categorical dots without connecting lines; label LoD and hop depth, not τ |
| RQ4 actions | current-evidence timing-dispersion.json | Seven measurements; median/P25/P75; explicit 2/88/3796 targets |
| RQ4 phases | Same dispersion file + REPORT.md | Outside legend; HTTP absent for local collapse means unavailable, not zero; avoid stacking overlapping intervals |
| External first visual | current-external-combined summary.json or summary.csv | Three measurements per cell; different native visual boundaries explicit; x counts canonical nodes, not leaves |
| MSAGL total/excluding construction | msagl-paired-observations.csv + provenance report | Paired differences; retain failures/timeouts as censored/count evidence, never successful values at the timeout |

- No internal figure title: no `ax.set_title`, `plt.title` or `fig.suptitle`.
  Descriptive title/caption belongs in LaTeX `\caption{...}`.
- Keep axis labels, units, legend and optional panel letters; these are not titles.
- Uniform fonts/style across external and internal plots. Check legibility at
  the actual thesis column width; use approximately 9–10 pt axis/legend text.
- Identify logarithmic axes explicitly in labels or captions. Use consistent
  ×10³ canonical-node ticks across size-series plots.
- Use visible P25–P75 whiskers and small markers. If an interval remains narrower
  than its marker, state that in the caption; do not artificially enlarge it.
- Put legends outside the data region if they cover markers, especially RQ4 phases.
- RQ3 levels are categories. Do not draw continuity between selected hop cuts.
- If all-15-level linear bars hide coarse levels, add a separate log-count panel
  or table; do not silently omit levels or imply repeated statistical samples.
- Export vector PDF for `\includegraphics` and PNG only for preview.
- Captions state the metric boundary, repetitions, exclusions, median/P25/P75,
  log scales and tool-specific limitations. RQ3 is deterministic, with no error bars.
- Include source hashes and plotting CSVs; independently check tables/figures
  agree with reports before delivering them.

## Local generation procedure

From the phylo-lens repository root, using the installed plotting environment:

```sh
rtk proxy .venv/bin/python eval/tools/generate_chapter5_figures.py
```

Output: `eval/results/derived/chapter5-figures-current/`. To choose a different
folder, add `--output-dir /absolute/path/Images`. Fourteen PDFs/PNGs, CSVs,
provenance sidecars, frame diagnostics, manifest and proposed captions are already
included in this complete bundle. The generator uses only Matplotlib and the
Python standard library; the pinned environment is eval/requirements-figures.txt.
See eval/FIGURES.md for a per-figure guide and installation on another machine.
No benchmark or database restoration is needed. Raw measurements are unchanged.

The older Downloads generator has been superseded for current evidence; its old
schemas/titles are not used by the new generator. The present editor handoff is
separate from the larger Zenodo reproducibility bundle.
