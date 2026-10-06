from dataclasses import dataclass


@dataclass(frozen=True)
class LayoutFailureDiagnostics:
    algorithm: str = "sfdp"
    stage: str = "global_layout"
    exit_status: int | None = None
    timeout_seconds: float | None = None
    stderr: str | None = None
    detail: str | None = None

    def as_dict(self) -> dict[str, str | int | float | None]:
        return {
            "algorithm": self.algorithm,
            "stage": self.stage,
            "exit_status": self.exit_status,
            "timeout_seconds": self.timeout_seconds,
            "stderr": self.stderr,
            "detail": self.detail,
        }


class GraphvizLayoutError(RuntimeError):
    def __init__(self, message: str, diagnostics: LayoutFailureDiagnostics) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics
