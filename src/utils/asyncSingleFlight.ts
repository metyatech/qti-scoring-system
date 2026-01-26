export const createSingleFlight = <T>() => {
  let inFlight: Promise<T> | null = null;
  return (task: () => Promise<T>) => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
};
