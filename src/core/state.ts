// State awal dan pembersihan simpanan.

import { LEVEL_COUNT, level } from "./levels";
import type { CurrentGame, GameState, LevelRecord, Settings, Stats, ThemeId } from "./types";

export const SAVE_VERSION = 1;

export const THEME_IDS: ThemeId[] = ["kertas", "malam", "matcha", "sakura", "laut", "kayu", "retro"];

export function defaultSettings(): Settings {
  return {
    theme: "kertas",
    highlightSame: true,
    autoNotes: true,
    showTimer: true,
    sound: true,
    volume: 0.6,
    corner: "kanan",
    scale: 1,
    collapsed: false,
  };
}

export function defaultStats(): Stats {
  return { wins: 0, playMs: 0, mistakes: 0, hints: 0, streak: 0, lastWinDate: "" };
}

export function createInitialState(now: number): GameState {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    unlocked: 1,
    records: {},
    current: null,
    paused: {},
    settings: defaultSettings(),
    stats: defaultStats(),
  };
}

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(num(v, fallback, min, max));
}

function migrateCurrent(raw: unknown): CurrentGame | null {
  if (!raw || typeof raw !== "object") return null;
  const c = obj(raw);
  const lv = level(int(c.level, 0, 0, LEVEL_COUNT));
  if (!lv) return null;
  const cellsRaw = typeof c.cells === "string" && c.cells.length === 81 ? c.cells : "";
  // Angka awal selalu dipulihkan dari teka-teki; isian pemain hanya 1-9 di sel kosong.
  let cells = "";
  for (let i = 0; i < 81; i++) {
    const given = lv.puzzle[i];
    const ch = cellsRaw[i] ?? ".";
    cells += given ? String(given) : ch >= "1" && ch <= "9" ? ch : ".";
  }
  const notesRaw = Array.isArray(c.notes) ? c.notes : [];
  const notes = Array.from({ length: 81 }, (_, i) => {
    const v = notesRaw[i];
    return cells[i] === "." && typeof v === "number" && Number.isInteger(v) ? v & 0x1ff : 0;
  });
  return {
    level: lv.n,
    cells,
    notes,
    mistakes: int(c.mistakes, 0, 0, 1e6),
    hints: int(c.hints, 0, 0, 1e6),
    elapsedMs: num(c.elapsedMs, 0, 0, 1e10),
    done: bool(c.done, false),
  };
}

function migrateRecords(raw: unknown): Record<string, LevelRecord> {
  const r = obj(raw);
  const out: Record<string, LevelRecord> = {};
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const rec = obj(r[String(n)]);
    if (!Object.keys(rec).length) continue;
    const best = rec.bestMs;
    out[String(n)] = {
      stars: int(rec.stars, 0, 0, 3),
      bestMs: typeof best === "number" && Number.isFinite(best) && best > 0 ? best : null,
      wins: int(rec.wins, 0, 0, 1e6),
    };
  }
  return out;
}

function migrateSettings(raw: unknown): Settings {
  const s = obj(raw);
  const base = defaultSettings();
  const theme = typeof s.theme === "string" && (THEME_IDS as string[]).includes(s.theme) ? (s.theme as ThemeId) : base.theme;
  const scale = s.scale === 1.15 || s.scale === 1.3 ? s.scale : 1;
  return {
    theme,
    highlightSame: bool(s.highlightSame, base.highlightSame),
    autoNotes: bool(s.autoNotes, base.autoNotes),
    showTimer: bool(s.showTimer, base.showTimer),
    sound: bool(s.sound, base.sound),
    volume: num(s.volume, base.volume, 0, 1),
    corner: s.corner === "kiri" ? "kiri" : "kanan",
    scale,
    collapsed: bool(s.collapsed, base.collapsed),
  };
}

function migrateStats(raw: unknown): Stats {
  const s = obj(raw);
  return {
    wins: int(s.wins, 0, 0, 1e9),
    playMs: num(s.playMs, 0, 0, 1e13),
    mistakes: int(s.mistakes, 0, 0, 1e9),
    hints: int(s.hints, 0, 0, 1e9),
    streak: int(s.streak, 0, 0, 1e6),
    lastWinDate: typeof s.lastWinDate === "string" ? s.lastWinDate.slice(0, 10) : "",
  };
}

/** Simpanan dibuat oleh versi aplikasi yang lebih baru: jangan ditimpa. */
export class NewerSaveError extends Error {
  constructor() {
    super("simpanan dari versi yang lebih baru");
    this.name = "NewerSaveError";
  }
}

export function migrateState(raw: unknown, now: number): GameState {
  const r = obj(raw);
  if (typeof r.version !== "number") throw new Error("bukan simpanan Sudoku Pojok");
  if (r.version > SAVE_VERSION) throw new NewerSaveError();
  const records = migrateRecords(r.records);
  // Level terbuka minimal satu setelah level tertinggi yang pernah selesai.
  let unlocked = int(r.unlocked, 1, 1, LEVEL_COUNT);
  for (const [n, rec] of Object.entries(records)) if (rec.wins > 0) unlocked = Math.max(unlocked, Math.min(LEVEL_COUNT, Number(n) + 1));
  let current = migrateCurrent(r.current);
  if (current && current.level > unlocked) current = null;
  const paused: Record<string, CurrentGame> = {};
  const pausedRaw = obj(r.paused);
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const g = migrateCurrent(pausedRaw[String(n)]);
    if (g && g.level === n && n <= unlocked && !g.done && g.level !== current?.level) paused[String(n)] = g;
  }
  return {
    version: SAVE_VERSION,
    createdAt: num(r.createdAt, now, 0, now),
    unlocked,
    records,
    current,
    paused,
    settings: migrateSettings(r.settings),
    stats: migrateStats(r.stats),
  };
}
