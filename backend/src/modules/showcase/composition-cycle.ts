/**
 * Состав изделия (СИ): изделие не может входить само в себя — ни прямо, ни через вложенные изделия на любой глубине.
 * graph: изделие → изделия в его составе (строки lineType 'product'). Чистая функция — тест рядом.
 */
export function wouldCycle(rootId: string, newChildren: string[], graph: Map<string, string[]>): string | null {
  for (const start of newChildren) {
    if (start === rootId) return start;
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === rootId) return start;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(graph.get(cur) ?? []));
    }
  }
  return null;
}
