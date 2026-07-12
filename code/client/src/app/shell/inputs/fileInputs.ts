export type AncillaryTableFormat = "auto" | "csv" | "tsv";

export function readTextFile(file: File): Promise<string> {
  return file.text();
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function resolveAncillaryFormat(selectedFormat: string | undefined, filename: string): AncillaryTableFormat {
  if (selectedFormat === "auto" || selectedFormat === "csv" || selectedFormat === "tsv") {
    return selectedFormat;
  }

  const normalizedFilename = filename.toLowerCase();
  if (normalizedFilename.endsWith(".tsv") || normalizedFilename.endsWith(".txt")) {
    return "tsv";
  }
  if (normalizedFilename.endsWith(".csv")) {
    return "csv";
  }
  return "auto";
}
