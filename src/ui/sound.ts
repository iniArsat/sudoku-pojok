// Bunyi kecil dengan WebAudio (tanpa file audio).

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let enabled = true;
let volume = 0.6;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      bus = ctx.createGain();
      bus.gain.value = enabled ? volume : 0;
      bus.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function configureSound(on: boolean, vol: number): void {
  enabled = on;
  volume = Math.min(1, Math.max(0, vol));
  if (ctx && bus) bus.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.05);
}

export function unlockAudio(): void {
  if (enabled) audio();
}

function tone(freqs: number[], duration: number, type: OscillatorType = "triangle", vol = 0.05, delay = 0): void {
  const a = audio();
  if (!a || !bus) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  const step = duration / Math.max(1, freqs.length - 1);
  osc.frequency.setValueAtTime(freqs[0], t0);
  freqs.forEach((f, i) => osc.frequency.linearRampToValueAtTime(f, t0 + i * step));
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(bus);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export type SoundId = "klik" | "isi" | "catat" | "salah" | "hapus" | "unit" | "menang" | "petunjuk" | "buka";

const lastPlayed = new Map<SoundId, number>();

export function playSound(id: SoundId): void {
  if (!enabled || volume <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(id) ?? -Infinity) < 35) return;
  lastPlayed.set(id, now);
  switch (id) {
    case "klik":
      tone([880, 760], 0.04, "square", 0.015);
      break;
    case "isi":
      tone([660, 990], 0.08, "triangle", 0.04);
      break;
    case "catat":
      tone([1200, 1100], 0.04, "sine", 0.03);
      break;
    case "hapus":
      tone([500, 380], 0.07, "triangle", 0.03);
      break;
    case "salah":
      tone([220, 170], 0.18, "square", 0.025);
      break;
    case "unit":
      tone([784], 0.18, "sine", 0.045);
      tone([1046], 0.3, "sine", 0.04, 0.09);
      break;
    case "petunjuk":
      tone([1046, 1318, 1568], 0.25, "sine", 0.035);
      break;
    case "buka":
      tone([523, 784], 0.15, "triangle", 0.04);
      break;
    case "menang":
      [523, 659, 784, 1046].forEach((f, i) => tone([f], 0.35, "triangle", 0.05, i * 0.11));
      tone([1318], 0.7, "sine", 0.04, 0.5);
      break;
  }
}
