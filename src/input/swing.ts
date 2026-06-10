/**
 * SPACE is the sole gameplay input (§Inputs): timestamped at DOM event time,
 * key-repeat ignored, judged synchronously on arrival (analytic, sub-tick) so
 * input→judgment latency is handler-execution time — F3-observable, < 2 ms.
 */
export function attachSwingInput(opts: {
  onSwing: (domTimeMs: number) => void;
}): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    if (e.repeat) return; // key-repeat ignored (§What)
    e.preventDefault();
    opts.onSwing(e.timeStamp);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
