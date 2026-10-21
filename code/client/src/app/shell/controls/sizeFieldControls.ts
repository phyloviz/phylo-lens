import { readNodeAncillaryValues } from '../../../ancillary/ancillaryAccess';
import type { PositionedGraph } from '../../../contracts/positioned';
import { DEFAULT_PROFILE_COUNT_FIELD, numericAncillaryValue } from '../../../render/mapping/visualMapping';
import { isCategoryCountMetadataKey } from '../../../render/mapping/pieCategoryCounts';

/** Offer fields the size mapper can read, preserving a selection outside the current slice. */
export default function sizeFieldControls(select: HTMLSelectElement | undefined) {
  return { reset, refresh };

  function reset(field = DEFAULT_PROFILE_COUNT_FIELD): void {
    if (!select) return;
    select.replaceChildren(option(DEFAULT_PROFILE_COUNT_FIELD, 'Profile count'));
    if (field !== DEFAULT_PROFILE_COUNT_FIELD) select.append(option(field, field));
    select.value = field;
  }

  function refresh(graph: PositionedGraph | null): void {
    if (!select) return;
    const selected = select.value || DEFAULT_PROFILE_COUNT_FIELD;
    const numericFields = new Set<string>();
    for (const node of graph?.nodes ?? []) {
      for (const [field, value] of Object.entries(readNodeAncillaryValues(node.attributes))) {
        if (
          field !== DEFAULT_PROFILE_COUNT_FIELD &&
          !isCategoryCountMetadataKey(field) &&
          numericAncillaryValue(value) !== null
        )
          numericFields.add(field);
      }
    }
    select.replaceChildren(option(DEFAULT_PROFILE_COUNT_FIELD, 'Profile count'));
    for (const field of [...numericFields].sort((a, b) => a.localeCompare(b))) select.append(option(field, field));
    if (selected !== DEFAULT_PROFILE_COUNT_FIELD && !numericFields.has(selected))
      select.append(option(selected, `${selected} (not in current view)`));
    select.value = selected;
  }
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}
