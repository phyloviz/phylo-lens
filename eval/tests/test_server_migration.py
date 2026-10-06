from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys


def test_evaluation_hooks_follow_current_owners_and_keep_measurement_labels(tmp_path):
    root = Path(__file__).parents[2]
    profile = tmp_path / "preparation.jsonl"
    program = """
import time
from fastapi.testclient import TestClient
from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store, get_prepare_job_registry
import local_eval_server
with TestClient(local_eval_server.app) as client:
    job=client.post('/api/graph/prepare',json={'format':'newick','dataset_name':'measurement-boundaries','content':'(a:1,b:2)root;'}).json()
    deadline=time.monotonic()+5
    while True:
        status=client.get('/api/graph/prepare/'+job['job_id']).json()
        if status['status']!='pending' or time.monotonic()>deadline: break
        time.sleep(.005)
    assert status['status']=='ready',status
    response=client.post('/api/graph/viewport',json={'dataset_id':'measurement-boundaries','lod_target_representations':20})
    assert response.status_code==200,response.text
    timing=response.headers['server-timing']
    assert 'query;dur=' in timing and 'construction;dur=' in timing,timing
get_prepare_job_registry.cache_clear()
get_prepared_layout_store.cache_clear()
"""
    result = subprocess.run(
        [sys.executable, "-c", program],
        cwd=root,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PYTHONPATH": f"{root}/eval/scripts:{root}/code/server/src",
            "PHYLO_LENS_EVAL_PROFILE": str(profile),
            "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(tmp_path / "store"),
        },
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    records = [json.loads(line) for line in profile.read_text().splitlines()]
    phases = {record["phase"] for record in records}
    assert {
        "input_normalization",
        "lod_construction",
        "index_construction",
        "base_layout",
        "persistence.publish",
        "graphviz_process_only",
    } <= phases
    assert all(
        record["start_monotonic_s"] <= record["end_monotonic_s"]
        and record["wall_s"] >= 0
        for record in records
    )
