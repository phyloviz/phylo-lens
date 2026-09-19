import { readTextFile, resolveAncillaryFormat, type AncillaryTableFormat } from "./fileInputs";

/** Read one CSV/TSV record, including quoted delimiters and escaped quotes.
 * Auto detection follows the server: a tab on the first line selects TSV.
 */
export function ancillaryHeaders(content: string, format: AncillaryTableFormat): string[] {
  const text = content.replace(/^\uFEFF/, "").trim();
  if (!text) {
    throw new Error("The ancillary table is empty.");
  }

  const delimiter = format === "tsv" || (format === "auto" && text.split(/\r?\n/, 1)[0].includes("\t")) ? "\t" : ",";
  const headers: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || field === "")) {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      headers.push(field.trim());
      field = "";
      if (c !== delimiter) break;
    } else {
      field += c;
    }

    if (i === text.length - 1) {
      headers.push(field.trim());
    }
  }

  if (quoted) throw new Error("The ancillary header contains an unclosed quote.");
  if (!headers.length || headers.some((header) => !header)) throw new Error("Ancillary columns must have names.");
  if (new Set(headers).size !== headers.length) throw new Error("Ancillary column names must be unique.");

  return headers;
}

export function ancillaryJoinColumnPicker(options: {
  fileInput?: HTMLInputElement;
  columnInput?: HTMLInputElement | HTMLSelectElement;
  formatSelect?: HTMLSelectElement;
  onError: (message: string) => void;
}) {
  let revision = 0;
  let ready: Promise<void> = Promise.resolve();

  function refresh(): Promise<void> {
    const current = ++revision;
    const select = options.columnInput;

    // Existing library hosts can keep supplying their own text input.
    if (!(select instanceof HTMLSelectElement)) return Promise.resolve();

    const previous = select.value;
    const file = options.fileInput?.files?.[0];
    const format = resolveAncillaryFormat(options.formatSelect?.value, file?.name ?? "");

    select.replaceChildren(new Option(file ? "Reading columns…" : "Choose an ancillary table first", ""));
    select.disabled = true;

    ready = (async () => {
      if (!file) return;
      try {
        const headers = ancillaryHeaders(await readTextFile(file), format);
        if (current !== revision) {
          return;
        }

        select.replaceChildren(
          new Option("Choose the node ID column", ""),
          ...headers.map((header) => new Option(header, header)),
        );
        select.value = headers.includes(previous) ? previous : headers.includes("isolate") ? "isolate" : "";
        select.disabled = false;
      } catch (error) {
        if (current !== revision) return;
        select.replaceChildren(new Option("Could not read column names", ""));
        options.onError(error instanceof Error ? error.message : "Could not read ancillary table.");
      }
    })();

    return ready;
  }

  return {
    refresh,
    whenReady: () => ready,
    dispose: () => {
      revision++;
    },
  };
}
