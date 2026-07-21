import pytest

from phylo_lens_server.http.graph import dependencies


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


def test_max_active_prepare_jobs_defaults_to_unbounded(monkeypatch) -> None:
    monkeypatch.delenv(dependencies.ENV_MAX_ACTIVE_PREPARE_JOBS, raising=False)

    assert dependencies.max_active_prepare_jobs() is None


def test_max_active_prepare_jobs_parses_positive_integer(monkeypatch) -> None:
    monkeypatch.setenv(dependencies.ENV_MAX_ACTIVE_PREPARE_JOBS, "3")

    assert dependencies.max_active_prepare_jobs() == 3


def test_max_active_prepare_jobs_rejects_non_positive_integer(monkeypatch) -> None:
    monkeypatch.setenv(dependencies.ENV_MAX_ACTIVE_PREPARE_JOBS, "0")

    with pytest.raises(ValueError) as exc_info:
        dependencies.max_active_prepare_jobs()

    assert dependencies.ENV_MAX_ACTIVE_PREPARE_JOBS in str(exc_info.value)


def test_prepare_job_backend_defaults_to_local(monkeypatch) -> None:
    monkeypatch.delenv(dependencies.ENV_PREPARE_JOB_BACKEND, raising=False)

    assert dependencies.prepare_job_backend() == dependencies.PREPARE_JOB_BACKEND_LOCAL


def test_prepare_job_backend_reads_configured_value(monkeypatch) -> None:
    monkeypatch.setenv(dependencies.ENV_PREPARE_JOB_BACKEND, "postgres")

    assert dependencies.prepare_job_backend() == dependencies.PREPARE_JOB_BACKEND_POSTGRES


def test_postgres_dsn_requires_value(monkeypatch) -> None:
    monkeypatch.delenv(dependencies.ENV_POSTGRES_DSN, raising=False)

    with pytest.raises(ValueError) as exc_info:
        dependencies.postgres_dsn()

    assert dependencies.ENV_POSTGRES_DSN in str(exc_info.value)


def test_postgres_dsn_reads_configured_value(monkeypatch) -> None:
    monkeypatch.setenv(dependencies.ENV_POSTGRES_DSN, "postgresql://example")

    assert dependencies.postgres_dsn() == "postgresql://example"


def test_postgres_layout_store_uses_postgres_dsn(monkeypatch) -> None:
    dependencies.get_prepared_layout_store.cache_clear()
    monkeypatch.setenv(dependencies.ENV_PREPARE_JOB_BACKEND, "postgres")
    monkeypatch.setenv(dependencies.ENV_POSTGRES_DSN, "postgresql://example")

    store = dependencies.get_prepared_layout_store()

    assert store.path == "postgresql://example"
    dependencies.get_prepared_layout_store.cache_clear()


def test_shutdown_prepare_job_registry_skips_unstarted_registry() -> None:
    dependencies.get_prepare_job_registry.cache_clear()

    dependencies.shutdown_prepare_job_registry_if_started()

    assert dependencies.get_prepare_job_registry.cache_info().currsize == 0
