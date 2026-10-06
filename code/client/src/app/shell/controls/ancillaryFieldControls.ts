import { getAncillaryFields } from '../../../ancillary/ancillaryFields';
import type { PositionedGraph } from '../../../contracts/positioned';
import { formatAncillaryFieldLabel } from '../ancillary/ancillaryFieldLabel';
import { getSelectedOptions } from './selectOptions';

export default function (select: HTMLSelectElement | undefined) {
  return {
    setSelection: setSelection,
    updateOptions: updateOptions,
    toggleOption: toggleOption,
  };

  // Seed explicit payload fields before metadata arrives; each new dataset starts
  // with its own mapping instead of inheriting the previous dataset's selection.
  function setSelection(fields: readonly string[]): void {
    if (!select) return;
    select.replaceChildren(
      ...fields.map(field => {
        const option = document.createElement('option');
        option.value = field;
        option.textContent = field;
        option.selected = true;
        return option;
      })
    );
  }

  function updateOptions(graph: PositionedGraph | null): void {
    if (!select) {
      return;
    }

    const previousValues = new Set(getSelectedOptions(select));
    select.innerHTML = '';

    const automaticOption = document.createElement('option');
    automaticOption.value = '';
    automaticOption.textContent = 'None — neutral nodes';
    select.appendChild(automaticOption);

    if (!graph) {
      select.disabled = true;
      return;
    }

    const fields = getAncillaryFields(graph);
    for (const key of previousValues) {
      if (key && !fields.some(field => field.name === key)) fields.push({ name: key, distinctValueCount: 0 });
    }
    const keys = fields.map(field => field.name);
    fields.forEach(field => {
      const option = document.createElement('option');
      option.value = field.name;
      option.textContent = formatAncillaryFieldLabel(field);
      option.title = `${field.name}: ${field.distinctValueCount} unique values in the current graph`;
      select.appendChild(option);
    });

    select.disabled = keys.length === 0;
    [...select.options].forEach(option => {
      option.selected =
        previousValues.has(option.value) || (option.value === '' && !keys.some(key => previousValues.has(key)));
    });
  }

  function toggleOption(event: MouseEvent): boolean {
    if (!select || !(event.target instanceof HTMLOptionElement)) {
      return false;
    }

    event.preventDefault();
    const clickedOption = event.target;
    const selectedValue = clickedOption.value;

    if (selectedValue === '') {
      [...select.options].forEach(option => {
        option.selected = option === clickedOption;
      });
      return true;
    }

    clickedOption.selected = !clickedOption.selected;
    const automaticOption = [...select.options].find(option => option.value === '');
    if (automaticOption) {
      automaticOption.selected = false;
    }

    return true;
  }
}
