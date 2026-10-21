// Maskot piksel: kucing oren kecil yang duduk di atas papan dan bereaksi pada
// permainan (berkedip, senang saat benar, kaget saat salah, melompat saat menang).

import { createImage, blit, gridImage, outline, type Grid, type PixelImage } from "./pixel";

export type Mood = "biasa" | "kedip" | "senang" | "kaget" | "tidur";

const BODY: Grid = [
  ".d.....d......",
  "dnd...dnd.....",
  "aaaaaaaaa.....",
  "aaaaaaaaaa....",
  "EEEEEEEEEE....",
  "EEEEEEEEEE....",
  "ccanncaaa.....",
  ".cccccaab.....",
  "..aabaabaa..ab",
  ".caabaabaaa.ab",
  ".ccaaaaaaaaab.",
  ".ccaabaabaab..",
  "..cc.cc.aaa...",
];

/** Dua baris mata (baris 4-5) per suasana hati. */
const EYES: Record<Mood, [string, string]> = {
  biasa: ["aeaaaaeaaa", "aeaaaaeaaa"],
  kedip: ["aaaaaaaaaa", "eeaaaeeaaa"],
  senang: ["eaeaaeaeaa", "aaaaaaaaaa"],
  kaget: ["aeeaaeeaaa", "aeeaaeeaaa"],
  tidur: ["aaaaaaaaaa", "eeaaaeeaaa"],
};

const PALETTE = { a: "#f0a24e", b: "#c87a2c", c: "#fff1dc", d: "#c87a2c", n: "#f19aa8", e: "#2a1d1a" };

const cache = new Map<Mood, PixelImage>();

export function mascotImage(mood: Mood): PixelImage {
  let img = cache.get(mood);
  if (!img) {
    const [r4, r5] = EYES[mood];
    const grid = BODY.map((row, y) => (y === 4 ? r4 + row.slice(10) : y === 5 ? r5 + row.slice(10) : row));
    img = outline(gridImage(grid, PALETTE), "#3a2a2a");
    cache.set(mood, img);
  }
  return img;
}

/** Gambar maskot ke kanvas dengan geseran vertikal (untuk lompatan). */
export function drawMascot(canvas: HTMLCanvasElement, mood: Mood, hop = 0, zzz = false): void {
  const img = mascotImage(mood);
  const W = img.w + 6;
  const H = img.h + 6;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const frame = createImage(W, H);
  blit(frame, img, 0, 6 - Math.round(hop));
  if (zzz) {
    const z = gridImage(["zzz", ".z.", "zzz"], { z: "#6a78b8" });
    blit(frame, z, W - 4, 0);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), W, H), 0, 0);
}
