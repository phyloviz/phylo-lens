import pytest

from phylo_lens_server.config import settings
from phylo_lens_server.http.graph import dependencies


def test_prepared_layout_store_dir_defaults_to_system_temp(monkeypatch) -> None:
    monkeypatch.delenv(settings.ENV_DATA_DIR, raising=False)
    monkeypatch.delenv(settings.ENV_PREPARED_LAYOUT_STORE_DIR, raising=False)

    assert (
        settings.prepared_layout_store_dir() == settings.DEFAULT_PREPARED_LAYOUT_STORE_DIR
    )


def test_data_dir_places_prepared_layouts_below_data_root(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv(settings.ENV_DATA_DIR, str(tmp_path))
    monkeypatch.delenv(settings.ENV_PREPARED_LAYOUT_STORE_DIR, raising=False)

    assert (
        settings.prepared_layout_store_dir() == tmp_path / settings.PREPARED_LAYOUT_SUBDIR
    )


def test_explicit_store_dir_overrides_data_dir(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "data"
    store_dir = tmp_path / "store"
    monkeypatch.setenv(settings.ENV_DATA_DIR, str(data_dir))
    monkeypatch.setenv(settings.ENV_PREPARED_LAYOUT_STORE_DIR, str(store_dir))

    assert settings.prepared_layout_store_dir() == store_dir


def test_max_active_prepare_jobs_defaults_to_unbounded(monkeypatch) -> None:
    monkeypatch.delenv(settings.ENV_MAX_ACTIVE_PREPARE_JOBS, raising=False)

    assert settings.max_active_prepare_jobs() is None


def test_max_active_prepare_jobs_parses_positive_integer(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_MAX_ACTIVE_PREPARE_JOBS, "3")

    assert settings.max_active_prepare_jobs() == 3


def test_max_active_prepare_jobs_rejects_non_positive_integer(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_MAX_ACTIVE_PREPARE_JOBS, "0")

    with pytest.raises(ValueError) as exc_info:
        settings.max_active_prepare_jobs()

    assert settings.ENV_MAX_ACTIVE_PREPARE_JOBS in str(exc_info.value)


def test_subprocess_timeouts_default_to_conservative_values(monkeypatch) -> None:
    monkeypatch.delenv(settings.ENV_GRAPHVIZ_SFDP_TIMEOUT_SECONDS, raising=False)
    monkeypatch.delenv(settings.ENV_PHYLOLIB_TIMEOUT_SECONDS, raising=False)

    assert (
        settings.graphviz_sfdp_timeout_seconds()
        == settings.DEFAULT_GRAPHVIZ_SFDP_TIMEOUT_SECONDS
    )
    assert (
        settings.phylolib_timeout_seconds()
        == settings.DEFAULT_PHYLOLIB_TIMEOUT_SECONDS
    )


def test_subprocess_timeouts_read_positive_float_values(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_GRAPHVIZ_SFDP_TIMEOUT_SECONDS, "12.5")
    monkeypatch.setenv(settings.ENV_PHYLOLIB_TIMEOUT_SECONDS, "30")

    assert settings.graphviz_sfdp_timeout_seconds() == 12.5
    assert settings.phylolib_timeout_seconds() == 30.0


def test_subprocess_timeouts_reject_non_positive_values(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_GRAPHVIZ_SFDP_TIMEOUT_SECONDS, "0")
    monkeypatch.setenv(settings.ENV_PHYLOLIB_TIMEOUT_SECONDS, "-1")

    with pytest.raises(ValueError) as graphviz_exc:
        settings.graphviz_sfdp_timeout_seconds()
    with pytest.raises(ValueError) as phylolib_exc:
        settings.phylolib_timeout_seconds()

    assert settings.ENV_GRAPHVIZ_SFDP_TIMEOUT_SECONDS in str(graphviz_exc.value)
    assert settings.ENV_PHYLOLIB_TIMEOUT_SECONDS in str(phylolib_exc.value)


def test_prepare_job_backend_defaults_to_local(monkeypatch) -> None:
    monkeypatch.delenv(settings.ENV_PREPARE_JOB_BACKEND, raising=False)

    assert settings.prepare_job_backend() == settings.PREPARE_JOB_BACKEND_LOCAL


def test_prepare_job_backend_reads_configured_value(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_PREPARE_JOB_BACKEND, "postgres")

    assert (
        settings.prepare_job_backend() == settings.PREPARE_JOB_BACKEND_POSTGRES
    )


def test_postgres_dsn_requires_value(monkeypatch) -> None:
    monkeypatch.delenv(settings.ENV_POSTGRES_DSN, raising=False)

    with pytest.raises(ValueError) as exc_info:
        settings.postgres_dsn()

    assert settings.ENV_POSTGRES_DSN in str(exc_info.value)


def test_postgres_dsn_reads_configured_value(monkeypatch) -> None:
    monkeypatch.setenv(settings.ENV_POSTGRES_DSN, "postgresql://example")

    assert settings.postgres_dsn() == "postgresql://example"


def test_postgres_layout_store_uses_postgres_dsn(monkeypatch) -> None:
    dependencies.get_prepared_layout_store.cache_clear()
    monkeypatch.setenv(settings.ENV_PREPARE_JOB_BACKEND, "postgres")
    monkeypatch.setenv(settings.ENV_POSTGRES_DSN, "postgresql://example")

    store = dependencies.get_prepared_layout_store()

    assert store.path == "postgresql://example"
    dependencies.get_prepared_layout_store.cache_clear()


def test_shutdown_prepare_job_registry_skips_unstarted_registry() -> None:
    dependencies.get_prepare_job_registry.cache_clear()

    dependencies.shutdown_prepare_job_registry_if_started()

    assert dependencies.get_prepare_job_registry.cache_info().currsize == 0
