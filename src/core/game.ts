// Aturan permainan: memilih sel, mengisi angka, catatan pensil, urung, petunjuk,
// bintang, dan membuka level berikutnya. Murni tanpa DOM agar mudah diuji.

import { level, LEVEL_COUNT, type LevelDef } from "./levels";
import { applyStep, BOXES, COLS, LogicBoard, nextStep, PEERS, ROWS, boxOf, colOf, rowOf, type Step } from "./sudoku";
import type { CurrentGame, GameState, LevelRecord, Settings, ThemeId } from "./types";

export const MAX_HINTS = 3;

/** Jumlah bintang yang dibutuhkan untuk membuka tiap tema. */
export const THEME_UNLOCK: Record<ThemeId, number> = {
  kertas: 0,
  malam: 10,
  matcha: 30,
  sakura: 60,
  laut: 100,
  kayu: 150,
  retro: 210,
};

export function starsFor(mistakes: number, hints: number): number {
  if (mistakes === 0 && hints === 0) return 3;
  if (mistakes <= 2 && hints <= 1) return 2;
  return 1;
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateKey(ms: number): string {
  return keyOf(new Date(ms));
}

/** Tanggal kemarin menurut kalender (aman saat pergantian jam musim panas). */
export function yesterdayKey(ms: number): string {
  const d = new Date(ms);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

export interface WinInfo {
  level: number;
  stars: number;
  ms: number;
  bestMs: number;
  newBest: boolean;
  firstWin: boolean;
  /** Level baru yang terbuka karena kemenangan ini, atau null. */
  unlockedLevel: number | null;
}

export interface HintInfo {
  cell: number;
  digit: number;
  reason: string;
}

export type InputResult = "benar" | "salah" | "catatan" | "hapus" | "terkunci" | null;

export interface GameEvents {
  board: undefined;
  mistake: { cell: number };
  /** Baris, kolom, atau kotak yang baru lengkap (sel-selnya). */
  unit: { cells: number[] };
  win: WinInfo;
  hint: HintInfo;
  level: { level: number; resumed: boolean };
  settings: undefined;
  select: undefined;
}

type Listener<T> = (payload: T) => void;

interface UndoEntry {
  cell: number;
  before: string;
  notes: [number, number][];
}

export class Game {
  selected: number | null = null;
  notesMode = false;
  private undoStack: UndoEntry[] = [];
  private listeners: { [K in keyof GameEvents]?: Listener<GameEvents[K]>[] } = {};

  constructor(public state: GameState) {}

  on<K extends keyof GameEvents>(event: K, cb: Listener<GameEvents[K]>): () => void {
    const list = (this.listeners[event] ??= []) as Listener<GameEvents[K]>[];
    list.push(cb);
    return () => {
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private emit<K extends keyof GameEvents>(event: K, ...payload: GameEvents[K] extends undefined ? [] : [GameEvents[K]]): void {
    for (const cb of [...((this.listeners[event] as Listener<GameEvents[K]>[] | undefined) ?? [])]) {
      try {
        cb(payload[0] as GameEvents[K]);
      } catch (err) {
        console.error(`Pendengar ${event} gagal`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Info

  get current(): CurrentGame | null {
    return this.state.current;
  }

  get levelDef(): LevelDef | null {
    return this.state.current ? level(this.state.current.level) : null;
  }

  /** Hari beruntun yang masih berlaku (0 bila kemarin dan hari ini belum menang). */
  currentStreak(now = Date.now()): number {
    const st = this.state.stats;
    return st.lastWinDate === dateKey(now) || st.lastWinDate === yesterdayKey(now) ? st.streak : 0;
  }

  totalStars(): number {
    return Object.values(this.state.records).reduce((sum, r) => sum + r.stars, 0);
  }

  themeUnlocked(theme: ThemeId): boolean {
    return this.totalStars() >= THEME_UNLOCK[theme];
  }

  record(n: number): LevelRecord {
    return this.state.records[String(n)] ?? { stars: 0, bestMs: null, wins: 0 };
  }

  value(i: number): number {
    const ch = this.state.current?.cells[i] ?? ".";
    return ch === "." ? 0 : Number(ch);
  }

  isGiven(i: number): boolean {
    return !!this.levelDef?.puzzle[i];
  }

  isWrong(i: number): boolean {
    const lv = this.levelDef;
    const v = this.value(i);
    return !!lv && v !== 0 && v !== lv.solution[i];
  }

  /** Sel terisi angka yang benar (tidak bisa diubah lagi). */
  isLocked(i: number): boolean {
    const lv = this.levelDef;
    return !!lv && this.value(i) === lv.solution[i];
  }

  /** Berapa kali angka ini masih perlu diisi. */
  remaining(d: number): number {
    const lv = this.levelDef;
    if (!lv) return 0;
    let placed = 0;
    for (let i = 0; i < 81; i++) if (this.value(i) === d && lv.solution[i] === d) placed++;
    return 9 - placed;
  }

  hintsLeft(): number {
    return Math.max(0, MAX_HINTS - (this.state.current?.hints ?? 0));
  }

  // -------------------------------------------------------------------------
  // Level

  /** Mulai (atau lanjutkan) level. Mengembalikan false bila level masih terkunci. */
  start(n: number): boolean {
    const lv = level(n);
    if (!lv || n > this.state.unlocked) return false;
    const cur = this.state.current;
    if (cur && cur.level === n && !cur.done) {
      this.emit("level", { level: n, resumed: true });
      return true;
    }
    // Permainan yang belum selesai disimpan dulu, dan bisa dilanjutkan nanti.
    if (cur && !cur.done) this.state.paused[String(cur.level)] = cur;
    const saved = this.state.paused[String(n)];
    if (saved && !saved.done) {
      delete this.state.paused[String(n)];
      this.state.current = saved;
      this.undoStack = [];
      this.selected = null;
      this.notesMode = false;
      this.emit("level", { level: n, resumed: true });
      this.emit("board");
      return true;
    }
    this.state.current = {
      level: n,
      cells: lv.puzzle.map((v) => (v ? String(v) : ".")).join(""),
      notes: new Array(81).fill(0),
      mistakes: 0,
      hints: 0,
      elapsedMs: 0,
      done: false,
    };
    this.undoStack = [];
    this.selected = null;
    this.notesMode = false;
    this.emit("level", { level: n, resumed: false });
    this.emit("board");
    return true;
  }

  /** Mulai ulang level yang sedang dimainkan dari awal. */
  restart(): void {
    const cur = this.state.current;
    if (!cur) return;
    delete this.state.paused[String(cur.level)];
    cur.done = true;
    this.start(cur.level);
  }

  /** Level ini punya permainan yang belum selesai. */
  inProgress(n: number): boolean {
    const cur = this.state.current;
    return (cur?.level === n && !cur.done) || !!this.state.paused[String(n)];
  }

  /** Level yang sebaiknya dimainkan berikutnya. */
  nextLevel(): number {
    const cur = this.state.current;
    if (cur && !cur.done) return cur.level;
    if (cur && cur.done) return Math.min(this.state.unlocked, cur.level + 1, LEVEL_COUNT);
    return this.state.unlocked;
  }

  // -------------------------------------------------------------------------
  // Pemilihan

  select(i: number | null): void {
    this.selected = i !== null && i >= 0 && i < 81 ? i : null;
    this.emit("select");
  }

  move(dr: number, dc: number): void {
    const from = this.selected ?? 40;
    const r = (rowOf(from) + dr + 9) % 9;
    const c = (colOf(from) + dc + 9) % 9;
    this.select(r * 9 + c);
  }

  toggleNotes(): void {
    this.notesMode = !this.notesMode;
    this.emit("select");
  }

  // -------------------------------------------------------------------------
  // Mengisi

  private setCell(i: number, ch: string): void {
    const cur = this.state.current!;
    cur.cells = cur.cells.slice(0, i) + ch + cur.cells.slice(i + 1);
  }

  private pushUndo(cell: number, touched: number[]): void {
    const cur = this.state.current!;
    this.undoStack.push({ cell, before: cur.cells[cell], notes: touched.map((t) => [t, cur.notes[t]]) });
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  /** Masukkan angka (atau catatan) di sel terpilih. */
  input(d: number): InputResult {
    const cur = this.state.current;
    const lv = this.levelDef;
    const i = this.selected;
    if (!cur || !lv || cur.done || i === null || d < 1 || d > 9) return null;
    if (this.isGiven(i) || this.isLocked(i)) return "terkunci";

    if (this.notesMode) {
      if (this.value(i) !== 0) return "terkunci";
      this.pushUndo(i, [i]);
      cur.notes[i] ^= 1 << (d - 1);
      this.emit("board");
      return "catatan";
    }

    if (this.value(i) === d) {
      // Menekan angka yang sama lagi menghapusnya.
      this.pushUndo(i, [i]);
      this.setCell(i, ".");
      this.emit("board");
      return "hapus";
    }

    const correct = lv.solution[i] === d;
    const touched = [i, ...(correct && this.state.settings.autoNotes ? PEERS[i].filter((p) => cur.notes[p] & (1 << (d - 1))) : [])];
    this.pushUndo(i, touched);
    this.setCell(i, String(d));
    cur.notes[i] = 0;
    if (correct) {
      if (this.state.settings.autoNotes) for (const p of PEERS[i]) cur.notes[p] &= ~(1 << (d - 1));
      this.emit("board");
      this.checkUnits(i);
      this.checkWin();
      return "benar";
    }
    cur.mistakes++;
    this.state.stats.mistakes++;
    this.emit("board");
    this.emit("mistake", { cell: i });
    return "salah";
  }

  /** Hapus isian salah atau catatan di sel terpilih. */
  erase(): InputResult {
    const cur = this.state.current;
    const i = this.selected;
    if (!cur || cur.done || i === null) return null;
    if (this.isGiven(i) || this.isLocked(i)) return "terkunci";
    if (this.value(i) === 0 && cur.notes[i] === 0) return null;
    this.pushUndo(i, [i]);
    this.setCell(i, ".");
    cur.notes[i] = 0;
    this.emit("board");
    return "hapus";
  }

  undo(): boolean {
    const cur = this.state.current;
    const entry = this.undoStack.pop();
    if (!cur || cur.done || !entry) return false;
    this.setCell(entry.cell, entry.before);
    for (const [cell, notes] of entry.notes) cur.notes[cell] = notes;
    this.selected = entry.cell;
    this.emit("board");
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 && !!this.state.current && !this.state.current.done;
  }

  private checkUnits(i: number): void {
    const lv = this.levelDef!;
    const full = (cells: number[]) => cells.every((c) => this.value(c) === lv.solution[c]);
    const done = new Set<number>();
    for (const unit of [ROWS[rowOf(i)], COLS[colOf(i)], BOXES[boxOf(i)]]) if (full(unit)) unit.forEach((c) => done.add(c));
    if (done.size) this.emit("unit", { cells: [...done] });
  }

  private checkWin(): void {
    const cur = this.state.current!;
    const lv = this.levelDef!;
    for (let i = 0; i < 81; i++) if (this.value(i) !== lv.solution[i]) return;
    cur.done = true;
    this.selected = null;
    this.undoStack = [];
    delete this.state.paused[String(lv.n)];
    const key = String(lv.n);
    const before = this.record(lv.n);
    const stars = starsFor(cur.mistakes, cur.hints);
    const newBest = before.bestMs === null || cur.elapsedMs < before.bestMs;
    this.state.records[key] = {
      stars: Math.max(before.stars, stars),
      bestMs: newBest ? cur.elapsedMs : before.bestMs,
      wins: before.wins + 1,
    };
    let unlockedLevel: number | null = null;
    if (lv.n < LEVEL_COUNT && this.state.unlocked <= lv.n) {
      this.state.unlocked = lv.n + 1;
      unlockedLevel = lv.n + 1;
    }
    const st = this.state.stats;
    st.wins++;
    const today = dateKey(Date.now());
    const yesterday = yesterdayKey(Date.now());
    if (st.lastWinDate !== today) st.streak = st.lastWinDate === yesterday ? st.streak + 1 : 1;
    st.lastWinDate = today;
    this.emit("win", {
      level: lv.n,
      stars,
      ms: cur.elapsedMs,
      bestMs: this.state.records[key].bestMs!,
      newBest: newBest && before.bestMs !== null,
      firstWin: before.wins === 0,
      unlockedLevel,
    });
  }

  // -------------------------------------------------------------------------
  // Petunjuk

  /** Isi satu sel dengan angka yang benar, beserta alasannya bila bisa dijelaskan. */
  hint(): HintInfo | null {
    const cur = this.state.current;
    const lv = this.levelDef;
    if (!cur || !lv || cur.done || this.hintsLeft() <= 0) return null;

    // Papan logis dari isian yang benar saja.
    const correct = lv.solution.map((v, i) => (this.value(i) === v ? v : 0));
    const board = new LogicBoard(correct);
    let target: { cell: number; step: Step | null } | null = null;
    const sel = this.selected;
    if (sel !== null && !this.isGiven(sel) && !this.isLocked(sel)) {
      target = { cell: sel, step: this.explain(board, sel) };
    } else {
      for (let guard = 0; guard < 60; guard++) {
        const step = nextStep(board);
        if (!step) break;
        if (step.place) {
          target = { cell: step.place.cell, step };
          break;
        }
        applyStep(board, step);
      }
      if (!target) {
        const empty = correct.findIndex((v) => v === 0);
        if (empty < 0) return null;
        target = { cell: empty, step: null };
      }
    }

    const i = target.cell;
    const d = lv.solution[i];
    const touched = [i, ...(this.state.settings.autoNotes ? PEERS[i].filter((p) => cur.notes[p] & (1 << (d - 1))) : [])];
    this.pushUndo(i, touched);
    this.setCell(i, String(d));
    cur.notes[i] = 0;
    if (this.state.settings.autoNotes) for (const p of PEERS[i]) cur.notes[p] &= ~(1 << (d - 1));
    cur.hints++;
    this.state.stats.hints++;
    this.selected = i;
    const info: HintInfo = { cell: i, digit: d, reason: reasonText(target.step, d) };
    this.emit("board");
    this.emit("hint", info);
    this.checkUnits(i);
    this.checkWin();
    return info;
  }

  /** Cari alasan sederhana untuk sel tertentu (single), bila ada. */
  private explain(board: LogicBoard, cell: number): Step | null {
    for (let guard = 0; guard < 60; guard++) {
      const step = nextStep(board);
      if (!step) return null;
      if (step.place?.cell === cell) return step;
      applyStep(board, step);
      if (board.values[cell]) return null;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Waktu dan pengaturan

  /** Tambah waktu bermain (hanya saat widget terbuka dan sedang dimainkan). */
  tick(dtMs: number): void {
    const cur = this.state.current;
    if (!cur || cur.done || !Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = Math.min(dtMs, 5000);
    cur.elapsedMs += dt;
    this.state.stats.playMs += dt;
  }

  updateSettings(patch: Partial<Settings>): void {
    const s = this.state.settings;
    if (patch.theme && this.themeUnlocked(patch.theme)) s.theme = patch.theme;
    if (patch.highlightSame !== undefined) s.highlightSame = patch.highlightSame;
    if (patch.autoNotes !== undefined) s.autoNotes = patch.autoNotes;
    if (patch.showTimer !== undefined) s.showTimer = patch.showTimer;
    if (patch.sound !== undefined) s.sound = patch.sound;
    if (patch.volume !== undefined) s.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.corner === "kanan" || patch.corner === "kiri") s.corner = patch.corner;
    if (patch.scale === 1 || patch.scale === 1.15 || patch.scale === 1.3) s.scale = patch.scale;
    if (patch.collapsed !== undefined) s.collapsed = patch.collapsed;
    this.emit("settings");
  }
}

function reasonText(step: Step | null, d: number): string {
  if (!step) return `Angka yang tepat di sini adalah ${d}.`;
  const unit = step.unit ?? -1;
  const where = unit < 0 ? "" : unit < 9 ? "baris ini" : unit < 18 ? "kolom ini" : "kotak ini";
  switch (step.tech) {
    case "full-house":
      return `Hanya tersisa satu sel kosong di ${where}, dan angka yang belum ada adalah ${d}.`;
    case "hidden-single-box":
    case "hidden-single-line":
      return `Di ${where}, angka ${d} hanya bisa diletakkan di sel ini.`;
    case "naked-single":
      return `Angka lain sudah ada di baris, kolom, atau kotak sel ini. Hanya ${d} yang tersisa.`;
    default:
      return `Angka yang tepat di sini adalah ${d}.`;
  }
}
