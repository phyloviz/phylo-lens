/* Appended to the isolated PhyloLens wrapper, not to the product bundle.
 * Timestamp the rAF candidate immediately before bitmap capture; accept that
 * candidate only when its bitmap contains non-uniform graph-canvas pixels.
 */
export async function validateBitmapVisual(
  container,
  visibleSurface,
  invalidVisual,
) {
  const canvases = [...container.querySelectorAll("canvas")].filter(
    (c) =>
      visibleSurface(c).visible && /\bsigma-(nodes|edges)\b/.test(c.className),
  );
  if (!canvases.length) throw invalidVisual("No visible graph geometry canvas");
  const evidence = [];
  for (const canvas of canvases) {
    const bitmap = await createImageBitmap(canvas);
    try {
      const probe = new OffscreenCanvas(64, 48);
      const context = probe.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 64, 48);
      const pixels = context.getImageData(0, 0, 64, 48).data;
      const colors = new Set();
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) {
        const color = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`;
        colors.add(color);
        hash = Math.imul(hash ^ pixels[i], 16777619);
        hash = Math.imul(hash ^ pixels[i + 1], 16777619);
        hash = Math.imul(hash ^ pixels[i + 2], 16777619);
        hash = Math.imul(hash ^ pixels[i + 3], 16777619);
      }
      evidence.push({
        layer_class: canvas.className,
        evidence: visibleSurface(canvas),
        pixels: {
          valid: colors.size > 1,
          renderer: "copied-bitmap",
          distinct_colors: colors.size,
          sampled_pixels: 3072,
          sample_signature: String(hash >>> 0),
        },
      });
    } finally {
      bitmap.close();
    }
  }
  const valid = evidence.filter((e) => e.pixels.valid);
  if (!valid.length) throw invalidVisual("Graph canvas bitmap is uniform");
  return {
    primary_surface: evidence[0].evidence,
    canvas_evidence: evidence,
    canvas_composite: {
      visible_layers: evidence.length,
      readable_layers: valid.length,
      layer_order: evidence.map((e) => ({
        tag: "canvas",
        width: e.evidence.width,
        height: e.evidence.height,
        renderer: e.pixels.renderer,
        distinct_colors: e.pixels.distinct_colors,
        readable: e.pixels.valid,
      })),
    },
    surface_count: evidence.length,
  };
}
