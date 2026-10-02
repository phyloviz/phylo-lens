"""Original measurement artifacts must survive failed compaction."""

import gzip
import hashlib

import compact_evaluation_artifacts as compaction
import pytest


def test_verified_archive_round_trip(tmp_path):
    path = tmp_path / "prepared_layout.sqlite3"
    original = b"SQLite format 3\0" + bytes(range(256)) * 100
    path.write_bytes(original)
    record = compaction.compact(path)
    assert not path.exists()
    assert (
        gzip.decompress((tmp_path / "prepared_layout.sqlite3.gz").read_bytes())
        == original
    )
    assert record["original_sha256"] == hashlib.sha256(original).hexdigest()


def test_existing_archive_cannot_overwrite_original(tmp_path):
    path = tmp_path / "prepared_layout.sqlite3"
    path.write_bytes(b"original")
    path.with_name(path.name + ".gz").write_bytes(b"retained archive")
    with pytest.raises(FileExistsError):
        compaction.compact(path)
    assert path.read_bytes() == b"original"


def test_integrity_failure_retains_original(tmp_path, monkeypatch):
    path = tmp_path / "prepared_layout.sqlite3"
    path.write_bytes(b"original")
    results = iter(["original-hash", "wrong-hash"])
    monkeypatch.setattr(compaction, "digest", lambda _: next(results))
    with pytest.raises(ValueError, match="integrity mismatch"):
        compaction.compact(path)
    assert path.read_bytes() == b"original"
    assert not path.with_name(path.name + ".gz").exists()
