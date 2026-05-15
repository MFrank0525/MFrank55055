export function countHighFrequencyTerms(tokens: string[][]): string[] {
  const totalCounter = new Map<string, number>();
  const docCounter = new Map<string, number>();
  for (const row of tokens) {
    const seen = new Set<string>();
    for (const token of row) {
      totalCounter.set(token, (totalCounter.get(token) || 0) + 1);
      if (seen.has(token)) continue;
      seen.add(token);
      docCounter.set(token, (docCounter.get(token) || 0) + 1);
    }
  }
  return [...docCounter.entries()]
    .filter(([term, count]) => count >= 2 || term.length >= 4)
    .sort((a, b) => {
      const docDiff = b[1] - a[1];
      if (docDiff !== 0) return docDiff;
      const totalDiff = (totalCounter.get(b[0]) || 0) - (totalCounter.get(a[0]) || 0);
      if (totalDiff !== 0) return totalDiff;
      return a[0].length - b[0].length;
    })
    .slice(0, 24)
    .map(([term]) => term);
}
