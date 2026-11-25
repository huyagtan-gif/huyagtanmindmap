// N6: энгийн санах ойн rate limit (нэг процесс). Жишээ: 5 удаа / 15 мин.
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
const hits = (g.__rl ??= new Map());

export function rateLimit(key: string, max = 5, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t: number) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t: number) => now - t < windowMs)) hits.delete(k);
  return true;
}
