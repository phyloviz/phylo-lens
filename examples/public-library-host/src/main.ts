import { createPhyloLensView } from "phylo-lens-client";

const container = document.getElementById("graph-root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Missing PhyloLens container.");
}

const view = createPhyloLensView({
  container,
  apiUrl: "http://localhost:8000",
});

void loadExampleTree();

async function loadExampleTree(): Promise<void> {
  await view.load({
    content: "(A:1,(B:2,C:4)N:3)R;",
    name: "example-tree",
    sourceFormat: "newick",
    metadataSchema: [{ key: "country", type: "string" }],
    metadataByNodeId: {
      A: { country: "PT" },
      B: { country: "PT" },
      C: { country: "ES" },
    },
  });
}
