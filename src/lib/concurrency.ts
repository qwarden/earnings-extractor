const DEFAULT_CONCURRENCY = parseInt(
  process.env.MAX_CONCURRENT_EXTRACTIONS || "3",
  10
);

export async function processBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  let active = 0;

  async function worker(workerId: number) {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      active++;
      console.log(
        `[concurrency] worker ${workerId} starting item ${index + 1}/${items.length} (${active} active)`
      );
      const start = Date.now();
      results[index] = await fn(items[index]);
      active--;
      console.log(
        `[concurrency] worker ${workerId} finished item ${index + 1}/${items.length} in ${((Date.now() - start) / 1000).toFixed(1)}s (${active} active)`
      );
    }
  }

  console.log(
    `[concurrency] processing ${items.length} items with ${Math.min(concurrency, items.length)} workers (max ${concurrency})`
  );
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    (_, i) => worker(i)
  );
  await Promise.all(workers);

  return results;
}
