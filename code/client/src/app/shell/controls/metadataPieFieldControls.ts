import { collectMetadataFieldSummaries } from "../../../components/ancillaryWheel";
import type { PositionedGraph } from "../../../contracts/positioned";
import { formatPieFieldOption } from "../ancillary/categorySummaries";
import { getSelectedOptions } from "./selectOptions";

export default function (select: HTMLSelectElement | undefined) {
  return {
    updateOptions: updateOptions,
    toggleOption: toggleOption,
  };

  function updateOptions(graph: PositionedGraph | null): void {
    if (!select) {
      return;
    }

    const previousValues = new Set(getSelectedOptions(select));
    select.innerHTML = "";

    const automaticOption = document.createElement("option");
    automaticOption.value = "";
    automaticOption.textContent = "Auto pie fields";
    select.appendChild(automaticOption);

    if (!graph) {
      select.disabled = true;
      return;
    }

    const summaries = collectMetadataFieldSummaries(graph);
    const keys = summaries.map((summary) => summary.key);
    summaries.forEach((summary) => {
      const option = document.createElement("option");
      option.value = summary.key;
      option.textContent = formatPieFieldOption(summary);
      option.title = `${summary.key}: ${summary.uniqueValueCount} unique values in the current graph`;
      select.appendChild(option);
    });

    select.disabled = keys.length === 0;
    [...select.options].forEach((option) => {
      option.selected = previousValues.has(option.value);
    });
  }

  function toggleOption(event: MouseEvent): boolean {
    if (!select || !(event.target instanceof HTMLOptionElement)) {
      return false;
    }

    event.preventDefault();
    const clickedOption = event.target;
    const selectedValue = clickedOption.value;

    if (selectedValue === "") {
      [...select.options].forEach((option) => {
        option.selected = option === clickedOption;
      });
      return true;
    }

    clickedOption.selected = !clickedOption.selected;
    const automaticOption = [...select.options].find((option) => option.value === "");
    if (automaticOption) {
      automaticOption.selected = false;
    }

    return true;
  }
}
