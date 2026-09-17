import type { PositionedGraph } from "../../../contracts/positioned";
import { PIE_OTHER_SLICE_KEY } from "../../../render/mapping/pieMapping";
import { buildAncillaryWheelStats } from "../../../components/ancillaryWheel";
import { isHexColor } from "./categoryPalette";

export const CATEGORY_COLOR_INPUT_SELECTOR = "[data-category-color]";

export default function (container: HTMLElement | undefined) {
  return {
    render: render,
    readSelectedColors: readSelectedColors,
    readEditableOrder: readEditableOrder,
  };

  function render({
    graph,
    selectedFields,
    categoryColorOverrides,
  }: {
    graph: PositionedGraph | null;
    selectedFields: string[];
    categoryColorOverrides: Record<string, string>;
  }): void {
    if (!container) {
      return;
    }

    container.innerHTML = "";
    const selectedField = selectedFields[0];
    if (!graph || !selectedField) {
      appendEmptyMessage(container, "Choose a pie field");
      return;
    }
    const categories =
      buildAncillaryWheelStats(graph, { fields: selectedFields, categoryColors: categoryColorOverrides })?.slices ?? [];
    if (categories.length === 0) {
      appendEmptyMessage(container, "No categories");
      return;
    }

    categories.forEach((category) => {
      const color = category.color;
      const label = document.createElement("label");
      label.className = "category-color-row";
      label.title = category.label;

      const input = document.createElement("input");
      input.type = "color";
      input.value = color;
      input.dataset.initialColor = input.value;
      input.dataset.categoryColor = category.category;
      input.disabled = category.key === PIE_OTHER_SLICE_KEY;
      input.setAttribute("aria-label", `${category.label} color`);

      const name = document.createElement("span");
      name.className = "category-color-name";
      name.textContent = category.label;

      const count = document.createElement("span");
      count.className = "category-color-count";
      count.textContent = `n = ${category.value}, ${category.percentage.toFixed(1)}%`;

      label.appendChild(input);
      label.appendChild(name);
      label.appendChild(count);
      container.appendChild(label);
    });
  }

  function readSelectedColors(changedOnly = false): Record<string, string> | undefined {
    if (!container) {
      return undefined;
    }

    const colorsByCategory: Record<string, string> = {};
    categoryColorInputs(container).forEach((input) => {
      const category = input.dataset.categoryColor;
      const color = input.value.trim();
      if (category && !input.disabled && isHexColor(color) && (!changedOnly || color !== input.dataset.initialColor)) {
        colorsByCategory[category] = color;
      }
    });

    return Object.keys(colorsByCategory).length > 0 ? colorsByCategory : undefined;
  }

  function readEditableOrder(): string[] {
    if (!container) {
      return [];
    }

    return categoryColorInputs(container)
      .filter((input) => !input.disabled && input.dataset.categoryColor)
      .map((input) => input.dataset.categoryColor as string);
  }
}

function appendEmptyMessage(container: HTMLElement, message: string): void {
  const empty = document.createElement("span");
  empty.className = "category-color-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function categoryColorInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>(CATEGORY_COLOR_INPUT_SELECTOR)];
}
