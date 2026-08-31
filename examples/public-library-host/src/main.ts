import { createPhyloLensView } from "@phyloviz/phylo-lens";
import "./style.css";

const datasets = {
  outbreak: {
    name: "Outbreak cluster",
    content:
      "((PT-01:0.4,PT-02:0.6)A:0.9,((PT-03:0.3,PT-04:0.5)B:0.7,(PT-05:0.4,(PT-06:0.2,PT-07:0.2)C:0.3)D:0.6)E:0.8,((PT-08:0.5,PT-09:0.7)F:0.8,(PT-10:0.4,(PT-11:0.3,PT-12:0.4)G:0.5)H:0.7)I:0.9)Root;",
  },
  forest: {
    name: "Two lineages",
    content:
      "((Alpha-1:0.5,Alpha-2:0.6)Alpha:0.8,(Alpha-3:0.4,Alpha-4:0.7)Beta:0.9)Lineage-A;(Beta-1:0.5,(Beta-2:0.4,Beta-3:0.6)Gamma:0.7)Lineage-B;",
  },
} as const;

const container = requiredElement("graph-root", HTMLElement);
const status = requiredElement("status", HTMLElement);
const datasetName = requiredElement("dataset-name", HTMLElement);
const exportButton = requiredElement("export-png", HTMLButtonElement);

const view = createPhyloLensView({
  container,
  apiUrl: import.meta.env.VITE_PHYLO_LENS_API_URL ?? "",
});

document.querySelectorAll<HTMLInputElement>('input[name="dataset"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      void loadDataset(input.value as keyof typeof datasets);
    }
  });
});

exportButton.addEventListener("click", () => void exportVisibleView());
void loadDataset("outbreak");

async function loadDataset(key: keyof typeof datasets): Promise<void> {
  const dataset = datasets[key];
  datasetName.textContent = dataset.name;
  status.dataset.state = "loading";
  status.textContent = `Preparing ${dataset.name.toLowerCase()}…`;
  exportButton.disabled = true;

  try {
    await view.load({
      content: dataset.content,
      name: key,
      sourceFormat: "newick",
    });
    status.dataset.state = "ready";
    status.textContent = "Ready — use the mouse to pan and zoom the graph.";
    exportButton.disabled = false;
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? `Could not load the graph: ${error.message}` : "Could not load the graph.";
  }
}

async function exportVisibleView(): Promise<void> {
  exportButton.disabled = true;
  status.textContent = "Preparing PNG export…";

  try {
    const png = await view.exportPng();
    const downloadUrl = URL.createObjectURL(png);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "phylo-lens-view.png";
    link.click();
    URL.revokeObjectURL(downloadUrl);
    status.textContent = "PNG downloaded.";
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? `Could not export PNG: ${error.message}` : "Could not export PNG.";
  } finally {
    exportButton.disabled = false;
  }
}

function requiredElement<T extends HTMLElement>(id: string, elementType: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) {
    throw new Error(`Missing required element: #${id}.`);
  }
  return element;
}
