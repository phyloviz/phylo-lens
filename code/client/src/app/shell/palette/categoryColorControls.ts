import type { PositionedGraph } from "../../../contracts/positioned";
import {
  selectPieSliceKeys,
  pieGroupingForFields,
  MAX_PIE_SLICE_KEYS,
  type PieCategoryGrouping,
} from "../../../render/mapping/pieMapping";
import { buildAncillaryWheelStats } from "../../../components/ancillaryWheel";
import { isHexColor } from "./categoryPalette";

export const CATEGORY_COLOR_INPUT_SELECTOR = "[data-category-color]";

export default function (container: HTMLElement | undefined) {
  let renderedFields: string[] = [];
  let renderedGrouping: PieCategoryGrouping = {};
  return {
    readGrouping: () => {
      const grouping = new Map(Object.entries(renderedGrouping));
      container?.querySelectorAll<HTMLSelectElement>("[data-category-grouping]").forEach((select) => {
        const category = select.dataset.categoryGrouping!;
        if (select.value === "separate" || select.value === "other") grouping.set(category, select.value);
        else grouping.delete(category);
      });
      return { fields: renderedFields, grouping: Object.fromEntries(grouping) };
    },
    render: render,
    readSelectedColors: readSelectedColors,
    readEditableOrder: readEditableOrder,
  };

  function render({
    graph,
    selectedFields,
    categoryColorOverrides,
    palette,
    categoryGrouping = {},
  }: {
    graph: PositionedGraph | null;
    selectedFields: string[];
    categoryColorOverrides: Record<string, string>;
    palette?: string[];
    categoryGrouping?: PieCategoryGrouping;
  }): void {
    if (!container) {
      return;
    }

    container.innerHTML = "";
    renderedFields = selectedFields;
    renderedGrouping = categoryGrouping;
    const selectedField = selectedFields[0];
    if (!graph || !selectedField) {
      appendEmptyMessage(container, "Choose a pie field");
      return;
    }
    const categories =
      buildAncillaryWheelStats(graph, {
        fields: selectedFields,
        palette,
        categoryColors: categoryColorOverrides,
        groupCategories: false,
      })?.slices ?? [];
    if (categories.length === 0) {
      appendEmptyMessage(container, "No categories");
      return;
    }

    const separateKeys = new Set(
      selectPieSliceKeys(
        new Map(categories.map((category) => [category.key, category.value])),
        pieGroupingForFields(selectedFields, categoryGrouping),
      ),
    );
    const help = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "How Other grouping works";
    help.append(summary);
    appendEmptyMessage(
      help,
      "Automatic shows up to 12 categories. With more categories, the 11 most frequent in this view stay separate and the rest form gray Other (grouped); ties use a fixed order. Separate reserves a slot; Other always groups the category. Palette length does not change this limit.",
    );
    container.append(help);
    const requested = Object.values(categoryGrouping).filter((mode) => mode === "separate").length;
    if (requested > MAX_PIE_SLICE_KEYS - 1)
      appendEmptyMessage(
        container,
        "More than 11 categories requested separately: the first 11 in a fixed category order keep their slots, including while offscreen. The excess stays in Other (grouped) until a slot is released.",
      );
    categories.forEach((category) => {
      const color = category.color;
      const label = document.createElement("div");
      label.className = "category-color-row";
      label.title = category.label;

      const input = document.createElement("input");
      input.type = "color";
      input.value = color;
      input.dataset.initialColor = input.value;
      input.dataset.categoryColor = category.category;
      input.setAttribute("aria-label", `${category.label} color`);

      const name = document.createElement("span");
      name.className = "category-color-name";
      name.textContent = category.label;

      const count = document.createElement("span");
      count.className = "category-color-count";
      count.textContent = `n = ${category.value}, ${category.percentage.toFixed(1)}%${separateKeys.has(category.key) ? "" : " · in Other"}`;

      const grouping = document.createElement("select");
      grouping.dataset.categoryGrouping = category.category;
      grouping.setAttribute("aria-label", `${category.label} grouping`);
      for (const [value, text] of [
        ["auto", "Automatic"],
        ["separate", "Separate"],
        ["other", "Other"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        grouping.append(option);
      }
      grouping.value = Object.hasOwn(categoryGrouping, category.category)
        ? categoryGrouping[category.category]
        : "auto";

      label.appendChild(input);
      label.appendChild(name);
      label.appendChild(count);
      label.appendChild(grouping);
      container.appendChild(label);
    });
  }

  function readSelectedColors(changedOnly = false): Record<string, string> | undefined {
    if (!container) {
      return undefined;
    }

    const colorsByCategory = new Map<string, string>();
    categoryColorInputs(container).forEach((input) => {
      const category = input.dataset.categoryColor;
      const color = input.value.trim();
      if (category && !input.disabled && isHexColor(color) && (!changedOnly || color !== input.dataset.initialColor)) {
        colorsByCategory.set(category, color);
      }
    });

    return colorsByCategory.size ? Object.fromEntries(colorsByCategory) : undefined;
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
