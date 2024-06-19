// eslint-disable-next-line no-promise-executor-return
export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param retries how much time to try
 * @param interval the initial interval in ms
 * @param intervalMultiplier multiplier by which we multiply the interval each time
 * @param fn the function to call
 * @param beforeRetry optional operation to perform before retry
 * @returns the result from the function
 */
export const retry = async <T>(
  retries: number,
  interval: number,
  intervalMultiplier: number,
  fn: () => Promise<T> | T,
  beforeRetry?: () => void,
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) {
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(String(error));
      }
    }

    if (beforeRetry) beforeRetry();

    await sleep(interval);

    return retry(
      retries - 1,
      interval * intervalMultiplier,
      intervalMultiplier,
      fn,
      beforeRetry,
    );
  }
};
