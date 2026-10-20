// Run from code/client: node tests/benchmarkManualBranches.mjs
// Pure presentation benchmark; excludes network, Sigma, and GPU rendering.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/app/workbench/viewport/manualBranches.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { ManualBranches } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
);
function median(action, repeats = 10) {
  action();
  const samples = Array.from({ length: repeats }, () => {
    const start = performance.now();
    action();
    return performance.now() - start;
  });
  return Number(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3));
}
const rows = [];
for (const size of [10000, 50000, 100000]) {
  const nodes = Array.from({ length: size }, (_, i) => ({
    id: String(i),
    x: i,
    y: 0,
    attributes: {
      treeIndex: {
        componentId: String(Math.floor(i / 10) * 10),
        parentId: i % 10 === 0 ? null : String(Math.floor(i / 10) * 10),
        depth: i % 10 === 0 ? 0 : 1,
        start: i,
        end: i % 10 === 0 ? i + 10 : i + 1,
      },
    },
  }));
  const graph = { nodes, edges: [], viewMeta: { layout: 'server', lodLevel: 0 } };
  const folds = new ManualBranches();
  const batchMs = median(() => {
    folds.clear();
    folds.collapseRoots(graph);
  });
  rows.push({
    nodes: size,
    roots: size / 10,
    batch_median_ms: batchMs,
    apply_median_ms: median(() => folds.apply(graph)),
  });
}
console.log(JSON.stringify({ node: process.version, rows }, null, 2));
