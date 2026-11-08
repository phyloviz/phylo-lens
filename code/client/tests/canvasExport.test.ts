import { describe, expect, it, vi } from 'vitest';

import { exportCanvasLayersAsPng } from '../src/render/export/canvasExport';

describe('exportCanvasLayersAsPng', () => {
  it('wraps symbol explanations below the graph without rescaling its content', async () => {
    const source = document.createElement('canvas');
    source.width = 240;
    source.height = 120;
    const drawImage = vi.fn();
    const fillText = vi.fn();
    const output = document.createElement('canvas');
    Object.defineProperty(output, 'getContext', {
      value: () => ({
        drawImage,
        fillText,
        fillRect: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 6 }),
      }),
    });
    Object.defineProperty(output, 'toBlob', { value: (callback: BlobCallback) => callback(new Blob(['png'])) });
    const documentRef = { createElement: () => output } as unknown as Document;
    const explanation = 'Triangle size shows a compressed node count, not an exact ratio or isolate count.';

    await exportCanvasLayersAsPng([source], documentRef, { width: 240, height: 120, notes: [explanation] });

    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 240, 120);
    expect(output.height).toBeGreaterThan(120);
    expect(fillText.mock.calls.map(([text]) => text).join('')).toBe(explanation);
    for (const [text, x, y] of fillText.mock.calls) {
      expect(x + text.length * 6).toBeLessThanOrEqual(output.width - 16);
      expect(y).toBeGreaterThan(120);
      expect(y).toBeLessThan(output.height);
    }
  });

  it('composites every visible renderer layer without changing the source canvases', async () => {
    const first = document.createElement('canvas');
    const second = document.createElement('canvas');
    first.width = second.width = 400;
    first.height = second.height = 240;
    const sourceSizes = [first.width, first.height, second.width, second.height];
    const drawImage = vi.fn();
    const output = document.createElement('canvas');
    Object.defineProperty(output, 'getContext', { value: vi.fn(() => ({ drawImage })) });
    Object.defineProperty(output, 'toBlob', {
      value: (callback: BlobCallback, type?: string) => callback(new Blob(['png'], { type })),
    });
    const documentRef = { createElement: vi.fn(() => output) } as unknown as Document;

    const blob = await exportCanvasLayersAsPng([first, second], documentRef);

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
    expect(drawImage).toHaveBeenNthCalledWith(1, first, 0, 0, 400, 240);
    expect(drawImage).toHaveBeenNthCalledWith(2, second, 0, 0, 400, 240);
    expect([first.width, first.height, second.width, second.height]).toEqual(sourceSizes);
  });
});
