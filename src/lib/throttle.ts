// Live updates while dragging a control, without flooding the device: `push`
// sends at most once per `ms` (always delivering the latest value), and `end`
// cancels anything pending and sends the final value straight away.
export function createThrottle<T>(send: (v: T) => void, ms = 250) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { v: T } | undefined;
  const fire = (v: T) => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    last = Date.now();
    send(v);
  };
  return {
    push(v: T) {
      pending = { v };
      const wait = ms - (Date.now() - last);
      if (wait <= 0) fire(v);
      else if (timer === undefined) timer = setTimeout(() => pending && fire(pending.v), wait);
    },
    end: fire,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
