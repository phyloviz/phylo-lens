"""Resolve only an original production run whose complete release validation passed."""

from __future__ import annotations

import os
import re
import subprocess
import sys

from release_github import request
from release_version import tag_version

REQUIRED_JOBS = {
    "Validate release / Detect changes",
    "Validate release / Client validation",
    "Validate release / Server validation",
    "Validate release / Evaluation smokes (RQ2-RQ4)",
    "Validate release / Docker service validation (amd64)",
    "Validate release / Docker service validation (arm64)",
    "Validate release / CI required",
    "Reserve immutable release tag",
}


def validate_run(run: dict, jobs: list[dict], sha: str) -> None:
    if (
        run.get("repository", {}).get("full_name") != "phyloviz/phylo-lens"
        or run.get("path") != ".github/workflows/release-npm.yml"
        or run.get("head_branch") != "main"
        or run.get("event") not in {"push", "workflow_dispatch"}
        or run.get("head_sha") != sha
        or run.get("status") != "completed"
        or run.get("conclusion") not in {"success", "failure"}
    ):
        raise ValueError(
            "Recovery requires the original completed production release run at this tag"
        )
    passed = {job["name"] for job in jobs if job.get("conclusion") == "success"}
    if not REQUIRED_JOBS.issubset(passed):
        raise ValueError("Original release validation/tag reservation did not all pass")


def main(tag: str, run_id: str) -> None:
    version = tag_version(tag)
    if not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise ValueError("Run ID must be a positive integer")
    sha = subprocess.check_output(
        ["git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"], text=True
    ).strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], check=True)
    run = request(f"actions/runs/{run_id}")
    if run is None:
        raise ValueError("Original release run was not found")
    jobs = []
    page = 1
    while True:
        result = request(f"actions/runs/{run_id}/jobs?per_page=100&page={page}")
        if result is None:
            raise ValueError("Original release jobs were not found")
        batch = result["jobs"]
        jobs.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    validate_run(run, jobs, sha)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"version={version}\nsha={sha}\nrun_id={run_id}\ntag={tag}\n")
    print(f"Verified original production run {run_id} for {tag} at {sha}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
