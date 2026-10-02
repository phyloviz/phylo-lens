# Current Chapter 5 figure generator

From the repository root:

```sh
rtk proxy .venv/bin/python eval/tools/generate_chapter5_figures.py
```

Matplotlib 3.10.8 is installed in the local `.venv`. For another environment:

```sh
rtk proxy python -m pip install -r eval/requirements-figures.txt
rtk proxy python eval/tools/generate_chapter5_figures.py --root /path/to/extracted/bundle
```

`--output-dir /absolute/path/Images` chooses another destination; the default is
`eval/results/derived/chapter5-figures-current/`. No server, browser, Graphviz
process, dataset download, database restoration or benchmark is launched.
The generator reads already audited evidence and checks current campaign
fingerprints. The old Downloads script is superseded for these new results.

## Outputs

Fourteen figures, each with vector `.pdf`, preview `.png`, plotting `.csv` and
`.provenance.json`. `FIGURES_MANIFEST.json` records all source/output hashes;
`CAPTIONS.md` and `CAPTIONS.tex` propose external thesis captions and labels.
`frame-pacing-observations.csv` retains each measured repetition's frame summary.
Generated captions are proposed text, not edits to the thesis. Choose relevant
figures and reference each included one; the auxiliary plots need not all appear.

| File stem | Content / placement |
|---|---|
| F1-rq1-preparation-time | RQ1 public POST→polled ready |
| F1b-rq1-peak-rss | RQ1 process-tree peak RSS |
| F1c-rq1-sfdp-wall | Auxiliary measured SFDP wall span |
| F2-rq2-client-visualization-scalability | Isolated replay latency |
| F2b-rq2-client-heap | Replay JavaScript heap delta |
| F2c-rq2-integrated-viewport | Actual adaptive viewport replies; link RQ2 to RQ3 |
| F2d-rq2-frame-pacing | Per-observation P95 frame interval; no pooled frames |
| F3-rq3-lod-effectiveness | All 15 discrete cuts, grouped materialization percentages |
| F3b-rq3-representation-counts | Auxiliary log counts showing coarse levels clearly |
| F4-rq4-interaction-responsiveness | Seven current actions; 2/88/3,796 members |
| F4b-rq4-phase-decomposition | Measured phase intervals, outside legend; no stacking |
| F5-external-first-visualization | Current three-tool native first-output comparison |
| F6-msagljs-fullmst-comparison | Current RQ1 vs historical MSAGL total and paired total-minus-construction |
| F6b-msagljs-input-construction | Auxiliary historical decoding/construction cost |

No figure has an embedded title. Axis labels, legends and units remain.
Median/P25/P75 intervals are drawn where statistical repetitions exist; RQ3 is
deterministic. Intervals narrower than markers are identified in captions.
Logarithmic axes are declared. LoD/hop labels are categorical, not evolutionary
thresholds. Captions retain timing boundaries, warm-up exclusions, repetition
counts and comparison limitations.

MSAGL remains a historical MDS architectural baseline on its original runtime,
not a matched current-version performance experiment. Its total starts from
adapted edge input and ends at TileMap ready: Newick adaptation and first painted
frame are unmeasured. `total-parse` is calculated/verified per observation before
summarizing. The 100k timeout marker denotes a censoring deadline, not a successful
measurement at 300 seconds.

## Thesis integration

Copy the selected PDFs into your thesis `Images/`, then adapt the generated
`CAPTIONS.tex` snippets. Use the PDFs in `\includegraphics`; PNGs are previews.
Do not put titles back into the images. Keep the statistical/operational caveats
when shortening captions. All figures have a 7-inch canvas and 9–10 point text;
placing them at half-width also halves the text size, so use full text width or
regenerate a specifically sized layout.
