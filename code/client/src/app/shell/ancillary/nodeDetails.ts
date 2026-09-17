import { readNodeAnnotations } from "../../../ancillary/ancillaryAccess";
import type { PositionedNode } from "../../../contracts/positioned";

// A LoD representative combines profiles; it is not a single biological profile.
export function renderNodeDetails(container: HTMLElement, node: PositionedNode): void {
  const members = node.attributes?.member_count;
  const isCluster = typeof members === "number" && members > 1;
  const records = node.attributes?.isolates;
  const ids = Array.isArray(records)
    ? records.flatMap((record: unknown) =>
        record && typeof record === "object" && "id" in record && typeof record.id === "string" ? [record.id] : [],
      )
    : [];
  const count = readNodeAnnotations(node.attributes).profileSummary.isolateCount;
  const isolateCount = typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : ids.length;
  const heading = document.createElement("p");
  heading.className = "node-details-title";
  heading.textContent = `${isCluster ? "Cluster" : ids.length ? "Profile" : "Node"}: ${node.id}`;
  const summary = document.createElement("p");
  summary.textContent = [
    isCluster ? `${members} profiles` : "",
    isolateCount ? `${isolateCount} ${isolateCount === 1 ? "isolate" : "isolates"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  container.append(heading, summary);

  if (isCluster || ids.length === 0) return;
  const details = document.createElement("details");
  details.className = "node-isolate-details";
  const label = document.createElement("summary");
  label.textContent = `Original isolate IDs (${ids.length})`;
  const list = document.createElement("ul");
  list.className = "node-isolate-list";
  list.append(
    ...ids.map((id) => {
      const item = document.createElement("li");
      item.textContent = id;
      return item;
    }),
  );
  details.append(label, list);
  container.append(details);
}
