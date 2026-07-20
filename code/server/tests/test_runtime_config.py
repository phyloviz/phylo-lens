from pathlib import Path

from phylo_lens_server.api.graph import dependencies


def test_prepared_layout_store_dir_defaults_to_system_temp(monkeypatch) -> None:
    monkeypatch.delenv(dependencies.ENV_DATA_DIR, raising=False)
    monkeypatch.delenv(dependencies.ENV_PREPARED_LAYOUT_STORE_DIR, raising=False)

    assert dependencies.prepared_layout_store_dir() == dependencies.DEFAULT_PREPARED_LAYOUT_STORE_DIR


def test_data_dir_places_prepared_layouts_below_data_root(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv(dependencies.ENV_DATA_DIR, str(tmp_path))
    monkeypatch.delenv(dependencies.ENV_PREPARED_LAYOUT_STORE_DIR, raising=False)

    assert dependencies.prepared_layout_store_dir() == tmp_path / dependencies.PREPARED_LAYOUT_SUBDIR


def test_explicit_store_dir_overrides_data_dir(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "data"
    store_dir = tmp_path / "store"
    monkeypatch.setenv(dependencies.ENV_DATA_DIR, str(data_dir))
    monkeypatch.setenv(dependencies.ENV_PREPARED_LAYOUT_STORE_DIR, str(store_dir))

    assert dependencies.prepared_layout_store_dir() == store_dir
