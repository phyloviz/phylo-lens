"""Version-independent retained Full-MST input verification.

The historical input registry names its release; dataset identity is established
by the retained SHA-256, independently of the product used to evaluate it.
"""

import hashlib
import json


def verified_fullmst_conditions(root):
    config = json.loads((root / "eval/config/rq1-final-fullmst-v022.json").read_text())
    result = []
    for condition in config["conditions"]:
        path = (
            root / config["input_source"]["relative_root"] / condition["path"]
        ).resolve()
        with path.open("rb") as f:
            actual = hashlib.file_digest(f, "sha256").hexdigest()
        if actual != condition["sha256"]:
            raise ValueError("Full-MST input checksum mismatch: " + str(path))
        result.append(
            {**condition, "absolute_path": str(path), "byte_size": path.stat().st_size}
        )
    return result
