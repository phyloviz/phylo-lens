// Render the existing Markdown diagrams; keep their source readable if offline.
const blocks = [...document.querySelectorAll("pre > code.language-mermaid")];
if (blocks.length) {
  const originals = [];
  try {
    const { default: mermaid } =
      await import("https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
    });
    const nodes = blocks.map((code) => {
      const original = code.parentElement;
      const container = document.createElement("div");
      container.className = "mermaid";
      container.textContent = code.textContent;
      original.replaceWith(container);
      originals.push({ original, container });
      return container;
    });
    await mermaid.run({ nodes });
  } catch (error) {
    for (const { original, container } of originals)
      container.replaceWith(original);
    console.warn(
      "Diagram source retained because Mermaid could not render.",
      error,
    );
  }
}
