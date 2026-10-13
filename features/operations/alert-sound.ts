// Local two-note signal. Context is created/resumed only inside an explicit user gesture.
export function createAlertSound() {
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let enabled = false, nextAllowedAt = 0;
  const nodes = new Set<OscillatorNode>();
  function cancel() {
    clearTimeout(timer); timer = undefined;
    for (const node of nodes) {try {node.stop();} catch {} node.disconnect();}
    nodes.clear();
  }
  async function enable() {
    if (typeof AudioContext === "undefined") return false;
    try {
      context ??= new AudioContext();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([context.resume(), new Promise<never>((_,reject) => {deadline = setTimeout(() => reject(new Error("audio unavailable")), 2500);})]);
      } finally {clearTimeout(deadline);}
      enabled = context.state === "running";
    } catch {enabled = false;}
    return enabled;
  }
  function disable() {
    enabled = false; cancel();
    if (context?.state === "running") void context.suspend().catch(() => {});
  }
  function notify(onUnavailable: () => void) {
    if (!enabled || timer || Date.now() < nextAllowedAt) return;
    // Coalesce a burst into a single signal; consumed occurrence IDs are handled by the UI detector.
    timer = setTimeout(() => {
      timer = undefined;
      if (!enabled) return;
      if (!context || context.state !== "running") {disable();onUnavailable();return;}
      nextAllowedAt = Date.now()+2000;
      try {
        for (const [frequency,offset] of [[660,0],[880,0.16]]) {
          const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime+offset;
          oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency,start);
          gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(0.045,start+0.015);gain.gain.linearRampToValueAtTime(0,start+0.12);
          oscillator.connect(gain);gain.connect(context.destination);nodes.add(oscillator);
          oscillator.onended = () => {nodes.delete(oscillator);oscillator.disconnect();gain.disconnect();};
          oscillator.start(start);oscillator.stop(start+0.13);
        }
      } catch {disable();onUnavailable();}
    },150);
  }
  function dispose() {disable();if (context && context.state !== "closed") void context.close().catch(() => {});context = undefined;}
  return {enable,disable,notify,dispose};
}
