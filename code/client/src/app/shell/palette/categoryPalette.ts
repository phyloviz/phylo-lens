export function parseCategoryColorPalette(
  rawInput: string,
  categoryOrder: string[],
): Record<string, string> {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    return {};
  }

  if (trimmedInput.startsWith("{")) {
    return parseNamedCategoryColorPalette(trimmedInput);
  }

  const colorsByCategory: Record<string, string> = {};
  trimmedInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const category = categoryOrder[index];
      const color = rgbLineToHex(line);
      if (category && color) {
        colorsByCategory[category] = color;
      }
    });

  return colorsByCategory;
}

export function serializeCategoryColorPalette(
  colorsByCategory: Record<string, string>,
  categoryOrder: string[],
): string {
  return categoryOrder
    .map((category) => hexToRgbLine(colorsByCategory[category]))
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function parseNamedCategoryColorPalette(
  rawInput: string,
): Record<string, string> {
  const parsed: unknown = JSON.parse(rawInput);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  const source =
    record.colors &&
    typeof record.colors === "object" &&
    !Array.isArray(record.colors)
      ? (record.colors as Record<string, unknown>)
      : record;
  const colorsByCategory: Record<string, string> = {};
  Object.entries(source).forEach(([category, color]) => {
    if (typeof color === "string" && isHexColor(color)) {
      colorsByCategory[category] = color;
    }
  });

  return colorsByCategory;
}

function rgbLineToHex(line: string): string | null {
  const parts = line.split(",").map((part) => Number(part.trim()));
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }

  return `#${parts
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgbLine(color: string | undefined): string | null {
  if (!color || !isHexColor(color)) {
    return null;
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `${red},${green},${blue}`;
}
