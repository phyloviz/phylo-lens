/** Model a browser-owned FileList without changing the file-reading code under test. */
export function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
}
