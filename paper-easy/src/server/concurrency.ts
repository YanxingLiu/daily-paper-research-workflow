export async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(Math.trunc(concurrency), 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    })
  );
}
