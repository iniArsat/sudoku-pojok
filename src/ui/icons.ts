// Ikon piksel kecil, dibuat dari grid huruf lalu diubah menjadi data URL.

import { gridImage, outline, type Grid, type PixelImage } from "../render/pixel";

const K = "#3a2a2a";

interface IconArt {
  grid: Grid;
  palette: Record<string, string>;
  outline?: boolean;
}

const ICONS = {
  urung: {
    grid: ["..k......", ".kk......", "kkkkkkk..", ".kk....k.", "..k.....k", "........k", ".......k.", "..kkkkk.."],
    palette: { k: K },
  },
  hapus: {
    grid: ["....ppp..", "...ppppp.", "..wppppp.", ".wwwppp..", "wwwwwp...", ".www.....", "..w......", "kkkkkkkkk"],
    palette: { p: "#e98aa9", w: "#f6efe4", k: "#9a8f86" },
  },
  catatan: {
    grid: [".......rr", "......ryr", ".....yyr.", "....yyy..", "...yyy...", "..yyy....", ".wyy.....", "kw......."],
    palette: { y: "#f0c24e", r: "#e2574a", w: "#f2d8b0", k: K },
  },
  petunjuk: {
    grid: ["..yyyy...", ".yYyyyy..", "yYyyyyyy.", "yyyyyyyy.", ".yyyyyy..", "..kkkk...", "..kkkk...", "...kk...."],
    palette: { y: "#f6d04d", Y: "#fff6c0", k: "#8a8f96" },
  },
  level: {
    grid: ["bb.bb.bb.", "bb.bb.bb.", ".........", "bb.oo.bb.", "bb.oo.bb.", ".........", "bb.bb.bb.", "bb.bb.bb."],
    palette: { b: "#5b8fd6", o: "#e8913a" },
  },
  atur: {
    grid: ["...gg....", ".g.gg.g..", "..gggg...", "ggg..ggg.", "ggg..ggg.", "..gggg...", ".g.gg.g..", "...gg...."],
    palette: { g: "#8a8f96" },
  },
  ciutkan: {
    grid: [".........", ".........", ".........", ".........", "kkkkkkkk.", "kkkkkkkk.", ".........", "........."],
    palette: { k: K },
  },
  bintang: {
    grid: ["....y....", "...yYy...", "yyyyYyyyy", ".yyyyyyy.", "..yyyyy..", ".yyy.yyy.", ".yy...yy."],
    palette: { y: "#f2c43a", Y: "#fff0a8" },
    outline: true,
  },
  bintangKosong: {
    grid: ["....g....", "...g.g...", "gggg.gggg", ".g.....g.", "..g...g..", ".g.ggg.g.", ".gg...gg."],
    palette: { g: "#c9b8ae" },
  },
  gembok: {
    grid: ["..kkk..", ".k...k.", ".k...k.", "kkkkkkk", "kyyyyyk", "kyykyyk", "kyyyyyk", "kkkkkkk"],
    palette: { k: "#7a6a62", y: "#d9c9a8" },
  },
  salah: {
    grid: ["r...r", ".r.r.", "..r..", ".r.r.", "r...r"],
    palette: { r: "#c8443f" },
  },
  jam: {
    grid: [".kkkk.", "k..k.k", "k..k.k", "k...kk", "k....k", ".kkkk."],
    palette: { k: K },
  },
  papan: {
    grid: ["kkkkkkkkk", "kwkwkwkwk", "kkkkkkkkk", "kwkokwkwk", "kkkkkkkkk", "kwkwkwkwk", "kkkkkkkkk"],
    palette: { k: "#5b8fd6", w: "#f6efe4", o: "#e8913a" },
  },
} satisfies Record<string, IconArt>;

export type IconId = keyof typeof ICONS;

export function iconImage(id: IconId): PixelImage {
  const art = ICONS[id] as IconArt;
  const img = gridImage(art.grid, art.palette);
  return art.outline ? outline(img, K) : img;
}

const urls = new Map<string, string>();

export function toDataUrl(img: PixelImage, scale = 1): string {
  const base = document.createElement("canvas");
  base.width = img.w;
  base.height = img.h;
  base.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  if (scale === 1) return base.toDataURL("image/png");
  const big = document.createElement("canvas");
  big.width = img.w * scale;
  big.height = img.h * scale;
  const ctx = big.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, big.width, big.height);
  return big.toDataURL("image/png");
}

export function iconUrl(id: IconId, scale = 2): string {
  const key = `${id}@${scale}`;
  let url = urls.get(key);
  if (!url) {
    url = toDataUrl(iconImage(id), scale);
    urls.set(key, url);
  }
  return url;
}

export function icon(id: IconId, scale = 2, cls = "icon"): HTMLImageElement {
  const img = document.createElement("img");
  img.src = iconUrl(id, scale);
  img.className = `px ${cls}`;
  img.alt = "";
  img.draggable = false;
  return img;
}
