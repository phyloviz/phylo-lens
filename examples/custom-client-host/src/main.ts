import { createPhyloLensView, toNodeId } from "@phyloviz/phylo-lens";
import { createPrecomputedClient, EXAMPLE_NEWICK } from "./precomputedClient";
import "./style.css";

const container = document.getElementById("tree");
const status = document.getElementById("status");
const query = document.getElementById("query");
if (
  !(container instanceof HTMLElement) ||
  !(status instanceof HTMLElement) ||
  !(query instanceof HTMLInputElement)
) {
  throw new Error("The example page is incomplete.");
}
const view = createPhyloLensView({
  container,
  graphClient: createPrecomputedClient(),
});
document.getElementById("find")?.addEventListener("click", async () => {
  try {
    const result = await view.searchNodes({ query: query.value });
    const match = result.matches[0];
    if (!match) {
      status.textContent = "No matching node.";
      return;
    }
    await view.focusNode(toNodeId(match.nodeId), {
      x: match.x ?? null,
      y: match.y ?? null,
      clusterId: match.clusterId,
    });
    status.textContent = `Selected ${match.nodeId}.`;
  } catch (error) {
    status.textContent = String(error);
  }
});
document.getElementById("export")?.addEventListener("click", async () => {
  const blob = await view.exportPng();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "phylo-lens-custom-client.png";
  link.click();
  URL.revokeObjectURL(url);
});
void view
  .load({
    content: EXAMPLE_NEWICK,
    name: "precomputed-example",
    sourceFormat: "newick",
    visualMapping: { colorField: "country" },
  })
  .then(() => {
    status.textContent = "Ready · custom client · no API service";
  })
  .catch((error) => {
    status.textContent = String(error);
  });
window.addEventListener("pagehide", () => view.dispose(), { once: true });
