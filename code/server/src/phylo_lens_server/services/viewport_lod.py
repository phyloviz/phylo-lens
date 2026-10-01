"""Choose among existing structural tiers; never discard representations."""

VIEWPORT_LOD_HYSTERESIS_RATIO = 0.15
VIEWPORT_LOD_EARLY_REFINEMENT_FACTOR = 2


def select_viewport_lod_level(
    counts: dict[int, int],
    semantic_level: int,
    target_representations: int,
    previous_level: int | None = None,
) -> int:
    """Zoom is a preference; spare viewport capacity permits early refinement.

    Each tier ahead of the preferred tier gets half the base target. Scan all
    tiers because local representation counts need not be monotonic. Count the
    prospective representation, including finest-tier one-hop neighbors.
    Density hysteresis uses each tier's own target, so zooming out tightens the
    condition for keeping an early-refined tier. Never truncate a valid tier.
    """
    if target_representations < 1:
        raise ValueError("Viewport representation target must be positive.")
    levels = sorted(counts)
    if not levels:
        return semantic_level

    # Integer comparisons avoid overflow and preserve positive-count checks even
    # when a caller supplies a very large preferred-tier offset.
    def scaled_count(level: int) -> int:
        return counts[level] * VIEWPORT_LOD_EARLY_REFINEMENT_FACTOR ** max(
            0, level - semantic_level
        )

    fitting = [
        level for level in levels if scaled_count(level) <= target_representations
    ]
    chosen = max(fitting) if fitting else levels[0]
    if previous_level in levels:
        previous_count = scaled_count(previous_level)
        if previous_count <= target_representations * (
            1 + VIEWPORT_LOD_HYSTERESIS_RATIO
        ):
            if chosen < previous_level:
                return previous_level
            if chosen > previous_level:
                # If the finest fitting tier is near its threshold, still take
                # a comfortable intermediate refinement instead of freezing.
                comfortable = [
                    level
                    for level in levels
                    if level > previous_level
                    and scaled_count(level)
                    <= target_representations * (1 - VIEWPORT_LOD_HYSTERESIS_RATIO)
                ]
                return max(comfortable) if comfortable else previous_level
    return chosen
