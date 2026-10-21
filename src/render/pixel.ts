// Gambar piksel mentah (RGBA) dan pembantu warna. Murni, tanpa DOM, agar bisa
// diuji di Node dan dipakai untuk membuat pratinjau PNG.

export interface PixelImage {
  w: number;
  h: number;
  /** RGBA, panjang w*h*4. */
  data: Uint8ClampedArray;
}

export type RGB = [number, number, number];

export function createImage(w: number, h: number): PixelImage {
  return { w, h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
}

const rgbCache = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let c = rgbCache.get(hex);
  if (!c) {
    const v = hex.replace("#", "");
    const full = v.length === 3 ? v.split("").map((ch) => ch + ch).join("") : v;
    const n = parseInt(full.slice(0, 6), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

export function toHex(c: RGB): string {
  return "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** Gelapkan (f < 1) atau terangkan (f > 1) warna. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = rgb(hex);
  if (f <= 1) return toHex([r * f, g * f, b * f]);
  const t = f - 1;
  return toHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
}

export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

export function setPixel(img: PixelImage, x: number, y: number, hex: string, alpha = 255): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const [r, g, b] = rgb(hex);
  const i = (y * img.w + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = alpha;
}

export function alphaAt(img: PixelImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return 0;
  return img.data[(y * img.w + x) * 4 + 3];
}

/** Tempel src ke dst di (dx, dy); piksel transparan dilewati. */
export function blit(dst: PixelImage, src: PixelImage, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      const a = src.data[si + 3];
      if (a === 0) continue;
      const di = (ty * dst.w + tx) * 4;
      if (a === 255) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
      } else {
        const t = a / 255;
        dst.data[di] = dst.data[di] * (1 - t) + src.data[si] * t;
        dst.data[di + 1] = dst.data[di + 1] * (1 - t) + src.data[si + 1] * t;
        dst.data[di + 2] = dst.data[di + 2] * (1 - t) + src.data[si + 2] * t;
        dst.data[di + 3] = Math.max(dst.data[di + 3], a);
      }
    }
  }
}

/** Cerminkan gambar secara horizontal. */
export function flipX(img: PixelImage): PixelImage {
  const out = createImage(img.w, img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const si = (y * img.w + x) * 4;
      const di = (y * img.w + (img.w - 1 - x)) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/** Tambah garis tepi 1 piksel di sekeliling bentuk (gambar membesar 1 piksel tiap sisi). */
export function outline(img: PixelImage, color: string): PixelImage {
  const out = createImage(img.w + 2, img.h + 2);
  blit(out, img, 1, 1);
  const [r, g, b] = rgb(color);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      if (alphaAt(out, x, y) !== 0) continue;
      const near =
        alphaAt(img, x - 2, y - 1) > 127 || alphaAt(img, x, y - 1) > 127 || alphaAt(img, x - 1, y - 2) > 127 || alphaAt(img, x - 1, y) > 127;
      if (!near) continue;
      const i = (y * out.w + x) * 4;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sprite dari grid huruf

export type Grid = readonly string[];

/**
 * Ubah grid huruf menjadi gambar. Huruf "." transparan; huruf lain dicari di palet.
 * Huruf yang tidak ada di palet juga transparan.
 */
export function gridImage(grid: Grid, palette: Record<string, string | null | undefined>): PixelImage {
  const h = grid.length;
  const w = Math.max(0, ...grid.map((row) => row.length));
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (color) setPixel(img, x, y, color);
    }
  }
  return img;
}

/** Potong ruang kosong di sekeliling gambar. Mengembalikan gambar dan geseran kiri-atasnya. */
export function trim(img: PixelImage): { img: PixelImage; x: number; y: number } {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { img: createImage(1, 1), x: 0, y: 0 };
  const out = createImage(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) {
    const from = (y * img.w + x0) * 4;
    out.data.set(img.data.subarray(from, from + out.w * 4), (y - y0) * out.w * 4);
  }
  return { img: out, x: x0, y: y0 };
}
