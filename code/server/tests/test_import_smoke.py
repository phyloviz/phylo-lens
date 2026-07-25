import subprocess
import sys


def test_sqlite_layout_repository_imports_first_in_clean_interpreter() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "import phylo_lens_server.repository.layout.sqlite_layout_repository",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
