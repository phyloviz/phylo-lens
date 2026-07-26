# PhyloLens evaluation

This directory contains the reproducible evaluation foundation and the first
implemented thesis experiment: RQ1 server-side preparation scalability for the
direct-tree pipeline. It does not contain browser, LoD-ablation, interaction,
external-tool, or typing-profile benchmark results.

Install the server and evaluation dependencies in one Python environment, from
the repository root:

```bash
python -m pip install -e 'code/server[test,dev]'
python -m pip install -e 'eval[test]'
PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq1 \
  --experiment rq1-direct-tree --dataset small-balanced-newick \
  --warmups 1 --repetitions 3 --timeout-seconds 60
```

The command creates an isolated run below
`eval/results/raw/<experiment-id>/<run-id>/`. The run root contains a manifest,
resolved configuration, combined raw observations, and a summary. Each dataset
subdirectory contains its own manifest, resolved configuration, raw
observations, per-repetition stdout/stderr, and a fresh SQLite directory for
each preparation. Results are ignored by Git and are not thesis evidence until
they are generated for a recorded environment and analysed.

Regenerate summaries from raw observations only:

```bash
PYTHONPATH=eval/src python -m phylo_lens_eval.summarize \
  eval/results/raw/<experiment-id>/<run-id>
```

`config/datasets.json` is the single dataset catalog and supports the explicit
topology labels required by the study. Paths are repository-relative. The RQ1
direct-tree experiment is declared in `config/experiments.json`; command-line
overrides are copied into `resolved-config.json`.

The repository has no suitable typing-profile benchmark dataset. Consequently,
this phase does not run or report typing-profile RQ1 results. A future dataset
entry must identify a profile file, use `typing_data`, and document its source
and goeBURST interpretation before that pipeline is enabled.
