"""Evaluation-only timings around unchanged PR #39 server operations."""

import json
import os
import resource
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from time import perf_counter

import fastapi.routing
from fastapi._compat import ModelField
from phylo_lens_server.main import app as product_app
from phylo_lens_server.pipeline import layout as preparation_layout
from phylo_lens_server.services import preparation as preparation_service
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.http.graph import router as graph_router
from starlette.responses import JSONResponse

metrics = ContextVar("evaluation_request_metrics", default=None)


def timed(owner, name, label):
    original = getattr(owner, name)

    @wraps(original)
    def wrapper(*args, **kwargs):
        start = perf_counter()
        try:
            return original(*args, **kwargs)
        finally:
            values = metrics.get()
            if values is not None:
                values[label] = values.get(label, 0) + (perf_counter() - start) * 1000

    setattr(owner, name, wrapper)


timed(SQLiteLayoutRepository, "viewport_representation_counts", "query")
timed(SQLiteLayoutRepository, "read_viewport", "query")
timed(graph_router, "graph_viewport_response_from_result", "construction")
timed(JSONResponse, "render", "json_encoding")
timed(ModelField, "serialize_json", "json_serialization")
original_serialize = fastapi.routing.serialize_response


async def serialize(*args, **kwargs):
    start = perf_counter()
    try:
        return await original_serialize(*args, **kwargs)
    finally:
        values = metrics.get()
        if values is not None:
            values["schema_serialization"] = (perf_counter() - start) * 1000


fastapi.routing.serialize_response = serialize


async def app(scope, receive, send):
    if scope["type"] != "http":
        return await product_app(scope, receive, send)
    values = {}
    token = metrics.set(values)

    async def measured_send(message):
        if message["type"] == "http.response.start":
            timing = ", ".join(
                f"{key};dur={value:.6f}" for key, value in values.items()
            )
            message["headers"] += [
                (b"server-timing", timing.encode()),
                (b"timing-allow-origin", b"*"),
                (b"access-control-expose-headers", b"server-timing,content-length"),
            ]
        await send(message)

    try:
        await product_app(scope, receive, measured_send)
    finally:
        metrics.reset(token)


# Profiling is activated only by an evaluation environment variable. The
# production package and the operation bodies are unchanged.
profile_path = os.environ.get("PHYLO_LENS_EVAL_PROFILE")
profile_lock = threading.Lock()


def usage(kind):
    value = resource.getrusage(kind)
    return value.ru_utime, value.ru_stime


@contextmanager
def preparation_span(name):
    if not profile_path:
        yield
        return
    own = usage(resource.RUSAGE_SELF)
    child = usage(resource.RUSAGE_CHILDREN)
    start = perf_counter()
    try:
        yield
    finally:
        end = perf_counter()
        own_end = usage(resource.RUSAGE_SELF)
        child_end = usage(resource.RUSAGE_CHILDREN)
        record = {
            "phase": name,
            "start_monotonic_s": start,
            "end_monotonic_s": end,
            "wall_s": end - start,
            "process_user_cpu_s": own_end[0] - own[0],
            "process_system_cpu_s": own_end[1] - own[1],
            "reaped_children_user_cpu_s": child_end[0] - child[0],
            "reaped_children_system_cpu_s": child_end[1] - child[1],
        }
        record["mean_core_equivalents"] = (
            sum(own_end) - sum(own) + sum(child_end) - sum(child)
        ) / (end - start)
        record["scope"] = (
            "whole evaluation server process plus reaped children; nested spans overlap"
        )
        with profile_lock, open(profile_path, "a") as stream:
            stream.write(json.dumps(record) + "\n")


def profile_function(owner, name, phase):
    original = getattr(owner, name)

    @wraps(original)
    def call(*args, **kwargs):
        with preparation_span(phase):
            return original(*args, **kwargs)

    setattr(owner, name, call)


if profile_path:
    original_worker_init = preparation_service.PreparationService.__init__

    @wraps(original_worker_init)
    def profiled_init(self, *args, **kwargs):
        kwargs.setdefault("stage_factory", preparation_span)
        original_worker_init(self, *args, **kwargs)

    preparation_service.PreparationService.__init__ = profiled_init
    profile_function(preparation_service, "ingest_dataset", "input_normalization")
    profile_function(
        preparation_layout,
        "graphviz_sfdp_positions",
        "graphviz_sfdp_including_dot_and_plain",
    )

    original_subprocess_run = preparation_layout.subprocess.run

    @wraps(original_subprocess_run)
    def profiled_subprocess_run(command, *args, **kwargs):
        if (
            isinstance(command, (list, tuple))
            and command
            and os.path.basename(str(command[0])) == "sfdp"
        ):
            with preparation_span("graphviz_process_only"):
                return original_subprocess_run(command, *args, **kwargs)
        return original_subprocess_run(command, *args, **kwargs)

    preparation_layout.subprocess.run = profiled_subprocess_run
