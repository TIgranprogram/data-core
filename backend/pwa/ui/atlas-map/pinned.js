/** Связи закреплённого результата отмечаются до проекции полотна. */
export function atlasPinnedNodes(data, nodeId) {
  const node = data.nodes.get(nodeId);
  if (!node) return new Set();
  const selected = new Set([node.id]);
  if (node.kind === 'area') {
    for (const child of data.sectionsByBand.get(node.band) || []) selected.add(child.id);
  }
  const belongs = (id) => selected.has(id) || selected.has(data.nodes.get(id)?.section);
  const related = new Set(selected);
  for (const edge of data.edges) {
    if (edge.kind === 'structure' || (!belongs(edge.from) && !belongs(edge.to))) continue;
    related.add(edge.from);
    related.add(edge.to);
  }
  for (const id of [...related]) for (const parent of data.chain(id)) related.add(parent);
  return related;
}
