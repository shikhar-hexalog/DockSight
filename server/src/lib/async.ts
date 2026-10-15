export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Runs fn over list with at most `limit` calls in flight, keeping order. */
export async function mapWithLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(list.length);

  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next++;
      results[index] = await fn(list[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));

  return results;
}
