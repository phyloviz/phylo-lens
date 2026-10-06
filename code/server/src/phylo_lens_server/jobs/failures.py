from phylo_lens_server.domain.layout_errors import GraphvizLayoutError

from .models import FailureDetails


def error_message(error: BaseException) -> str:
    return str(error) or type(error).__name__


def error_details(error: BaseException) -> FailureDetails | None:
    if isinstance(error, GraphvizLayoutError):
        return error.diagnostics.as_dict()
    return None
