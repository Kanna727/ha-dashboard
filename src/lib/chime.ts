// A soft two-tone chime made with Web Audio (no sound file in the bundle).
// Browsers, iOS especially, only allow audio after a user gesture, so the
// context is created/resumed on the first touch and the chime is skipped
// silently until then.
let ctx: AudioContext | null = null;

function unlock() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
}

export function chime() {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.02;
  [659.25, 880].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const start = t0 + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
}
