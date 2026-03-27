// Provide minimal WebGL globals so Sigma can be imported in jsdom tests.
if (!("WebGL2RenderingContext" in globalThis)) {
  (globalThis as Record<string, unknown>).WebGL2RenderingContext = class {};
}

if (!("WebGLRenderingContext" in globalThis)) {
  (globalThis as Record<string, unknown>).WebGLRenderingContext = class {};
}
