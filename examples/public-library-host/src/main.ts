import { createPhyloLensView } from "@phyloviz/phylo-lens";

const container = document.getElementById("graph-root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Missing PhyloLens container.");
}

const view = createPhyloLensView({
  container,
  apiUrl: import.meta.env.VITE_PHYLO_LENS_API_URL ?? "",
});

void loadExampleTree();

async function loadExampleTree(): Promise<void> {
  await view.load({
    content: "(A:1,(B:2,C:4)N:3)R;",
    name: "example-tree",
    sourceFormat: "newick",
  });
}
