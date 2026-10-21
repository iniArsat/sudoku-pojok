// 100 level yang dibuat oleh scripts/generate-levels.ts. Kesulitan naik dari
// level 1 (banyak angka awal, cukup satu teknik dasar) sampai level 100 (perlu
// teknik lanjutan seperti XYZ-Wing).

import data from "./levels.json";
import { parseGrid, TECHNIQUE_NAME, type Grid, type Technique } from "./sudoku";

interface RawLevel {
  p: string;
  s: string;
  r: number;
  t: string;
  g: number;
  b: string;
}

export interface LevelDef {
  /** Nomor level, mulai 1. */
  n: number;
  puzzle: Grid;
  solution: Grid;
  rating: number;
  technique: Technique;
  givens: number;
  band: string;
}

export const LEVELS: LevelDef[] = (data as RawLevel[]).map((raw, i) => ({
  n: i + 1,
  puzzle: parseGrid(raw.p),
  solution: parseGrid(raw.s),
  rating: raw.r,
  technique: raw.t as Technique,
  givens: raw.g,
  band: raw.b,
}));

export const LEVEL_COUNT = LEVELS.length;

export function level(n: number): LevelDef | null {
  return Number.isInteger(n) && n >= 1 && n <= LEVEL_COUNT ? LEVELS[n - 1] : null;
}

/** "sangat mudah" → "Sangat Mudah". */
export function bandLabel(band: string): string {
  return band.replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/** Urutan pita kesulitan (untuk warna di daftar level). */
export const BANDS = [...new Set(LEVELS.map((l) => l.band))];

export function techniqueName(t: Technique): string {
  return TECHNIQUE_NAME[t] ?? t;
}
