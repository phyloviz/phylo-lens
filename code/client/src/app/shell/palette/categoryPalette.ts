import { isRecord } from '../../../validation/guards';
export function parseCategoryColorPalette(rawInput: string, categoryOrder: string[]): Record<string, string> {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    return {};
  }

  if (trimmedInput.startsWith('{')) {
    return parseNamedCategoryColorPalette(trimmedInput);
  }

  const colorsByCategory = new Map<string, string>();
  trimmedInput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const category = categoryOrder[index];
      const color = rgbLineToHex(line);
      if (category && color) {
        colorsByCategory.set(category, color);
      }
    });

  return Object.fromEntries(colorsByCategory);
}

export function serializeCategoryColorPalette(
  colorsByCategory: Record<string, string>,
  categoryOrder: string[]
): string {
  return categoryOrder
    .map(category => hexToRgbLine(colorsByCategory[category]))
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function parseNamedCategoryColorPalette(rawInput: string): Record<string, string> {
  const parsed: unknown = JSON.parse(rawInput);
  if (!isRecord(parsed)) return {};
  const source = isRecord(parsed.colors) ? parsed.colors : parsed;
  const colorsByCategory = new Map<string, string>();
  Object.entries(source).forEach(([category, color]) => {
    if (typeof color === 'string' && isHexColor(color)) {
      colorsByCategory.set(category, color);
    }
  });

  return Object.fromEntries(colorsByCategory);
}

function rgbLineToHex(line: string): string | null {
  const cells = line.split(',').map(part => part.trim());
  if (cells.some(cell => cell === '')) return null;
  const parts = cells.map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return `#${parts.map(part => part.toString(16).padStart(2, '0')).join('')}`;
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
