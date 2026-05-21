#!/bin/sh -e
set -x

cd "$(dirname "$0")/.."
ruff check --fix src
ruff format src