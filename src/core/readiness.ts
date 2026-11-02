export const PING_TIMEOUT_MS = 2_000;

/** Rejects when `work` has not settled within `ms`; the work itself keeps running. */
export function withinDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not answer within ${ms} ms`));
    }, ms);
  });

  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
  });
}
