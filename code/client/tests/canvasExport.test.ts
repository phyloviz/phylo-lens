import { describe, expect, it, vi } from "vitest";

import { exportCanvasLayersAsPng } from "../src/render/export/canvasExport";

describe("exportCanvasLayersAsPng", () => {
  it("composites every visible renderer layer without changing the source canvases", async () => {
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    first.width = second.width = 400;
    first.height = second.height = 240;
    const sourceSizes = [first.width, first.height, second.width, second.height];
    const drawImage = vi.fn();
    const output = document.createElement("canvas");
    Object.defineProperty(output, "getContext", { value: vi.fn(() => ({ drawImage })) });
    Object.defineProperty(output, "toBlob", {
      value: (callback: BlobCallback, type?: string) => callback(new Blob(["png"], { type })),
    });
    const documentRef = { createElement: vi.fn(() => output) } as unknown as Document;

    const blob = await exportCanvasLayersAsPng([first, second], documentRef);

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(drawImage).toHaveBeenNthCalledWith(1, first, 0, 0, 400, 240);
    expect(drawImage).toHaveBeenNthCalledWith(2, second, 0, 0, 400, 240);
    expect([first.width, first.height, second.width, second.height]).toEqual(sourceSizes);
  });
});
