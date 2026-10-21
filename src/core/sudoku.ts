// Mesin sudoku: pemecah cepat (bitmask + MRV) untuk memastikan solusi tunggal,
// pembuat teka-teki, dan penilai kesulitan yang memecahkan seperti manusia,
// teknik termudah dulu, lalu mencatat teknik tersulit yang diperlukan.

export type Grid = number[];
export type Rng = () => number;

export const SIZE = 81;

export const rowOf = (i: number): number => Math.floor(i / 9);
export const colOf = (i: number): number => i % 9;
export const boxOf = (i: number): number => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

export const ROWS: number[][] = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c));
export const COLS: number[][] = Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c));
export const BOXES: number[][] = Array.from({ length: 9 }, (_, b) =>
  Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)),
);
/** 27 unit: 9 baris, 9 kolom, 9 kotak. */
export const UNITS: number[][] = [...ROWS, ...COLS, ...BOXES];

/** 20 sel yang "melihat" tiap sel (sebaris, sekolom, sekotak). */
export const PEERS: number[][] = Array.from({ length: SIZE }, (_, i) => {
  const set = new Set<number>([...ROWS[rowOf(i)], ...COLS[colOf(i)], ...BOXES[boxOf(i)]]);
  set.delete(i);
  return [...set];
});

const PEER_SET: Set<number>[] = PEERS.map((p) => new Set(p));

export function sees(a: number, b: number): boolean {
  return a !== b && PEER_SET[a].has(b);
}

export const ALL = 0x1ff;
export const bit = (d: number): number => 1 << (d - 1);

export function popcount(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

export function digitsOf(m: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (m & bit(d)) out.push(d);
  return out;
}

export function parseGrid(s: string): Grid {
  if (s.length !== SIZE) throw new Error("grid harus 81 karakter");
  return s.split("").map((ch) => (ch >= "1" && ch <= "9" ? Number(ch) : 0));
}

export function gridToString(g: Grid): string {
  return g.map((v) => (v ? String(v) : ".")).join("");
}

/** RNG deterministik (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Isian tidak bentrok (angka sama di baris/kolom/kotak). */
export function isConsistent(g: Grid): boolean {
  for (const unit of UNITS) {
    let seen = 0;
    for (const i of unit) {
      const v = g[i];
      if (!v) continue;
      if (seen & bit(v)) return false;
      seen |= bit(v);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pemecah cepat

/**
 * Hitung jumlah solusi sampai `limit`. Bila `out` diberikan, solusi pertama
 * disalin ke sana.
 */
export function countSolutions(g: Grid, limit = 2, out?: Grid): number {
  const cells = g.slice();
  const rowM = new Array(9).fill(0);
  const colM = new Array(9).fill(0);
  const boxM = new Array(9).fill(0);
  for (let i = 0; i < SIZE; i++) {
    const v = cells[i];
    if (!v) continue;
    const b = bit(v);
    const r = rowOf(i);
    const c = colOf(i);
    const x = boxOf(i);
    if (rowM[r] & b || colM[c] & b || boxM[x] & b) return 0;
    rowM[r] |= b;
    colM[c] |= b;
    boxM[x] |= b;
  }
  let found = 0;
  const search = (): boolean => {
    // Sel kosong dengan kandidat paling sedikit.
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < SIZE; i++) {
      if (cells[i]) continue;
      const mask = ALL & ~(rowM[rowOf(i)] | colM[colOf(i)] | boxM[boxOf(i)]);
      const n = popcount(mask);
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n <= 1) break;
      }
    }
    if (best < 0) {
      found++;
      if (found === 1 && out) for (let i = 0; i < SIZE; i++) out[i] = cells[i];
      return found >= limit;
    }
    if (bestCount === 0) return false;
    const r = rowOf(best);
    const c = colOf(best);
    const x = boxOf(best);
    let m = bestMask;
    while (m) {
      const b = m & -m;
      m &= m - 1;
      cells[best] = 31 - Math.clz32(b) + 1;
      rowM[r] |= b;
      colM[c] |= b;
      boxM[x] |= b;
      if (search()) return true;
      rowM[r] &= ~b;
      colM[c] &= ~b;
      boxM[x] &= ~b;
    }
    cells[best] = 0;
    return false;
  };
  search();
  return found;
}

export function solve(g: Grid): Grid | null {
  const out = new Array(SIZE).fill(0);
  return countSolutions(g, 1, out) === 1 ? out : null;
}

/** Papan penuh yang sah, diacak. */
export function randomSolution(rng: Rng): Grid {
  const g = new Array(SIZE).fill(0);
  const fill = (i: number): boolean => {
    if (i === SIZE) return true;
    const used = new Set<number>();
    for (const p of PEERS[i]) if (g[p]) used.add(g[p]);
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      if (used.has(d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

/**
 * Buat teka-teki dari papan penuh: kosongkan sel berpasangan (simetris putar 180°)
 * selama solusinya tetap tunggal, sampai tersisa `minGivens` angka atau tidak bisa lagi.
 */
export function makePuzzle(solution: Grid, rng: Rng, minGivens = 17): Grid {
  const puzzle = solution.slice();
  let givens = SIZE;
  const order = shuffle(Array.from({ length: 41 }, (_, i) => i), rng);
  for (const i of order) {
    if (givens <= minGivens) break;
    const j = SIZE - 1 - i;
    const removed = i === j ? [i] : [i, j];
    if (givens - removed.length < minGivens) continue;
    const keep = removed.map((k) => puzzle[k]);
    for (const k of removed) puzzle[k] = 0;
    if (countSolutions(puzzle, 2) === 1) givens -= removed.length;
    else removed.forEach((k, n) => (puzzle[k] = keep[n]));
  }
  return puzzle;
}

// ---------------------------------------------------------------------------
// Penilai kesulitan: teknik logika manusia

export type Technique =
  | "full-house"
  | "hidden-single-box"
  | "hidden-single-line"
  | "naked-single"
  | "pointing"
  | "claiming"
  | "naked-pair"
  | "x-wing"
  | "hidden-pair"
  | "naked-triple"
  | "swordfish"
  | "hidden-triple"
  | "xy-wing"
  | "xyz-wing"
  | "naked-quad"
  | "hidden-quad";

/** Bobot ala Sudoku Explainer: makin besar makin sulit. */
export const TECHNIQUE_COST: Record<Technique, number> = {
  "full-house": 1.0,
  "hidden-single-box": 1.2,
  "hidden-single-line": 1.5,
  "naked-single": 2.3,
  pointing: 2.6,
  claiming: 2.8,
  "naked-pair": 3.0,
  "x-wing": 3.2,
  "hidden-pair": 3.4,
  "naked-triple": 3.6,
  swordfish: 3.8,
  "hidden-triple": 4.0,
  "xy-wing": 4.2,
  "xyz-wing": 4.4,
  "naked-quad": 5.0,
  "hidden-quad": 5.4,
};

export const TECHNIQUE_NAME: Record<Technique, string> = {
  "full-house": "Sisa satu di baris/kolom/kotak",
  "hidden-single-box": "Satu-satunya tempat di kotak",
  "hidden-single-line": "Satu-satunya tempat di baris/kolom",
  "naked-single": "Satu-satunya angka di sel",
  pointing: "Kandidat terkunci (menunjuk)",
  claiming: "Kandidat terkunci (mengklaim)",
  "naked-pair": "Pasangan terbuka",
  "x-wing": "X-Wing",
  "hidden-pair": "Pasangan tersembunyi",
  "naked-triple": "Tripel terbuka",
  swordfish: "Swordfish",
  "hidden-triple": "Tripel tersembunyi",
  "xy-wing": "XY-Wing",
  "xyz-wing": "XYZ-Wing",
  "naked-quad": "Kuartet terbuka",
  "hidden-quad": "Kuartet tersembunyi",
};

/** Keadaan pemecahan logis: nilai dan kandidat (bitmask) tiap sel. */
export class LogicBoard {
  values: number[];
  cand: number[];

  constructor(g: Grid) {
    this.values = g.slice();
    this.cand = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
      if (this.values[i]) continue;
      let m = ALL;
      for (const p of PEERS[i]) if (this.values[p]) m &= ~bit(this.values[p]);
      this.cand[i] = m;
    }
  }

  place(i: number, d: number): void {
    this.values[i] = d;
    this.cand[i] = 0;
    const b = ~bit(d);
    for (const p of PEERS[i]) this.cand[p] &= b;
  }

  solved(): boolean {
    return this.values.every((v) => v !== 0);
  }

  /** Ada sel kosong tanpa kandidat (teka-teki tidak sah atau salah isi). */
  broken(): boolean {
    for (let i = 0; i < SIZE; i++) if (!this.values[i] && !this.cand[i]) return true;
    return false;
  }
}

export interface Placement {
  cell: number;
  digit: number;
}

export interface Step {
  tech: Technique;
  /** Sel yang diisi (teknik single). */
  place?: Placement;
  /** Kandidat yang dihapus: [sel, bitmask]. */
  eliminate?: [number, number][];
  /** Unit tempat single tersembunyi ditemukan (untuk penjelasan petunjuk). */
  unit?: number;
}

function combinations<T>(items: T[], k: number, cb: (combo: T[]) => boolean): boolean {
  const combo: T[] = [];
  const rec = (start: number): boolean => {
    if (combo.length === k) return cb(combo);
    for (let i = start; i <= items.length - (k - combo.length); i++) {
      combo.push(items[i]);
      if (rec(i + 1)) return true;
      combo.pop();
    }
    return false;
  };
  return rec(0);
}

function elimStep(tech: Technique, elims: Map<number, number>, b: LogicBoard): Step | null {
  const list: [number, number][] = [];
  for (const [cell, mask] of elims) {
    const real = b.cand[cell] & mask;
    if (real) list.push([cell, real]);
  }
  return list.length ? { tech, eliminate: list } : null;
}

function addElim(map: Map<number, number>, cell: number, mask: number): void {
  map.set(cell, (map.get(cell) ?? 0) | mask);
}

// Single --------------------------------------------------------------------

function fullHouse(b: LogicBoard): Step | null {
  for (let u = 0; u < 27; u++) {
    let empty = -1;
    let count = 0;
    let used = 0;
    for (const i of UNITS[u]) {
      if (b.values[i]) used |= bit(b.values[i]);
      else {
        empty = i;
        count++;
      }
    }
    if (count === 1) {
      const m = ALL & ~used;
      if (popcount(m) === 1 && b.cand[empty] & m) return { tech: "full-house", place: { cell: empty, digit: digitsOf(m)[0] }, unit: u };
    }
  }
  return null;
}

function hiddenSingle(b: LogicBoard, units: number[], tech: Technique): Step | null {
  for (const u of units) {
    for (let d = 1; d <= 9; d++) {
      const bd = bit(d);
      let spot = -1;
      let count = 0;
      let placed = false;
      for (const i of UNITS[u]) {
        if (b.values[i] === d) {
          placed = true;
          break;
        }
        if (b.cand[i] & bd) {
          spot = i;
          count++;
        }
      }
      if (!placed && count === 1) return { tech, place: { cell: spot, digit: d }, unit: u };
    }
  }
  return null;
}

const BOX_UNITS = Array.from({ length: 9 }, (_, i) => 18 + i);
const LINE_UNITS = Array.from({ length: 18 }, (_, i) => i);

function nakedSingle(b: LogicBoard): Step | null {
  for (let i = 0; i < SIZE; i++) {
    if (!b.values[i] && popcount(b.cand[i]) === 1) return { tech: "naked-single", place: { cell: i, digit: digitsOf(b.cand[i])[0] } };
  }
  return null;
}

// Kandidat terkunci ------------------------------------------------------------

function pointing(b: LogicBoard): Step | null {
  for (let bx = 0; bx < 9; bx++) {
    for (let d = 1; d <= 9; d++) {
      const bd = bit(d);
      const cells = BOXES[bx].filter((i) => b.cand[i] & bd);
      if (cells.length < 2) continue;
      for (const lines of [ROWS, COLS]) {
        const of = lines === ROWS ? rowOf : colOf;
        const line = of(cells[0]);
        if (!cells.every((i) => of(i) === line)) continue;
        const elims = new Map<number, number>();
        for (const i of lines[line]) if (boxOf(i) !== bx && b.cand[i] & bd) addElim(elims, i, bd);
        const step = elimStep("pointing", elims, b);
        if (step) return step;
      }
    }
  }
  return null;
}

function claiming(b: LogicBoard): Step | null {
  for (let u = 0; u < 18; u++) {
    for (let d = 1; d <= 9; d++) {
      const bd = bit(d);
      const cells = UNITS[u].filter((i) => b.cand[i] & bd);
      if (cells.length < 2) continue;
      const bx = boxOf(cells[0]);
      if (!cells.every((i) => boxOf(i) === bx)) continue;
      const elims = new Map<number, number>();
      const unitSet = new Set(UNITS[u]);
      for (const i of BOXES[bx]) if (!unitSet.has(i) && b.cand[i] & bd) addElim(elims, i, bd);
      const step = elimStep("claiming", elims, b);
      if (step) return step;
    }
  }
  return null;
}

// Himpunan terbuka dan tersembunyi ----------------------------------------------

function nakedSubset(b: LogicBoard, k: number, tech: Technique): Step | null {
  for (let u = 0; u < 27; u++) {
    const empties = UNITS[u].filter((i) => !b.values[i] && popcount(b.cand[i]) <= k);
    if (empties.length < k) continue;
    let result: Step | null = null;
    combinations(empties, k, (combo) => {
      let union = 0;
      for (const i of combo) union |= b.cand[i];
      if (popcount(union) !== k) return false;
      const elims = new Map<number, number>();
      for (const i of UNITS[u]) if (!b.values[i] && !combo.includes(i) && b.cand[i] & union) addElim(elims, i, union);
      result = elimStep(tech, elims, b);
      return result !== null;
    });
    if (result) return result;
  }
  return null;
}

function hiddenSubset(b: LogicBoard, k: number, tech: Technique): Step | null {
  for (let u = 0; u < 27; u++) {
    const cells = UNITS[u];
    const digits: number[] = [];
    const where = new Map<number, number[]>();
    for (let d = 1; d <= 9; d++) {
      const spots = cells.filter((i) => b.cand[i] & bit(d));
      if (spots.length >= 2 && spots.length <= k) {
        digits.push(d);
        where.set(d, spots);
      }
    }
    if (digits.length < k) continue;
    let result: Step | null = null;
    combinations(digits, k, (combo) => {
      const spots = new Set<number>();
      for (const d of combo) for (const i of where.get(d)!) spots.add(i);
      if (spots.size !== k) return false;
      let keep = 0;
      for (const d of combo) keep |= bit(d);
      const elims = new Map<number, number>();
      for (const i of spots) if (b.cand[i] & ~keep) addElim(elims, i, b.cand[i] & ~keep);
      result = elimStep(tech, elims, b);
      return result !== null;
    });
    if (result) return result;
  }
  return null;
}

// Ikan (X-Wing, Swordfish) --------------------------------------------------------

function fish(b: LogicBoard, n: number, tech: Technique): Step | null {
  for (let d = 1; d <= 9; d++) {
    const bd = bit(d);
    for (const [base, cover, posOf] of [
      [ROWS, COLS, colOf],
      [COLS, ROWS, rowOf],
    ] as const) {
      const lines: { line: number; pos: number }[] = [];
      for (let l = 0; l < 9; l++) {
        let pos = 0;
        let count = 0;
        for (const i of base[l]) {
          if (b.cand[i] & bd) {
            pos |= 1 << posOf(i);
            count++;
          }
        }
        if (count >= 2 && count <= n) lines.push({ line: l, pos });
      }
      if (lines.length < n) continue;
      let result: Step | null = null;
      combinations(lines, n, (combo) => {
        let union = 0;
        for (const c of combo) union |= c.pos;
        if (popcount(union) !== n) return false;
        const baseLines = new Set(combo.map((c) => c.line));
        const elims = new Map<number, number>();
        for (let p = 0; p < 9; p++) {
          if (!(union & (1 << p))) continue;
          for (const i of cover[p]) {
            const lineOfI = base === ROWS ? rowOf(i) : colOf(i);
            if (!baseLines.has(lineOfI) && b.cand[i] & bd) addElim(elims, i, bd);
          }
        }
        result = elimStep(tech, elims, b);
        return result !== null;
      });
      if (result) return result;
    }
  }
  return null;
}

// Sayap (XY-Wing, XYZ-Wing) -------------------------------------------------------

function xyWing(b: LogicBoard): Step | null {
  for (let pivot = 0; pivot < SIZE; pivot++) {
    const pm = b.cand[pivot];
    if (b.values[pivot] || popcount(pm) !== 2) continue;
    const wings = PEERS[pivot].filter((p) => !b.values[p] && popcount(b.cand[p]) === 2 && popcount(b.cand[p] & pm) === 1);
    for (let x = 0; x < wings.length; x++) {
      for (let y = x + 1; y < wings.length; y++) {
        const a = wings[x];
        const c = wings[y];
        const ma = b.cand[a];
        const mc = b.cand[c];
        // Sayap harus berbagi angka berbeda dengan poros, dan satu angka z yang sama.
        if ((ma & pm) === (mc & pm)) continue;
        const z = ma & mc & ~pm;
        if (popcount(z) !== 1) continue;
        const elims = new Map<number, number>();
        for (const i of PEERS[a]) if (i !== c && i !== pivot && sees(i, c) && b.cand[i] & z) addElim(elims, i, z);
        const step = elimStep("xy-wing", elims, b);
        if (step) return step;
      }
    }
  }
  return null;
}

function xyzWing(b: LogicBoard): Step | null {
  for (let pivot = 0; pivot < SIZE; pivot++) {
    const pm = b.cand[pivot];
    if (b.values[pivot] || popcount(pm) !== 3) continue;
    const wings = PEERS[pivot].filter((p) => !b.values[p] && popcount(b.cand[p]) === 2 && (b.cand[p] & ~pm) === 0);
    for (let x = 0; x < wings.length; x++) {
      for (let y = x + 1; y < wings.length; y++) {
        const a = wings[x];
        const c = wings[y];
        if (b.cand[a] === b.cand[c] || (b.cand[a] | b.cand[c]) !== pm) continue;
        const z = b.cand[a] & b.cand[c];
        if (popcount(z) !== 1) continue;
        const elims = new Map<number, number>();
        for (const i of PEERS[pivot]) if (i !== a && i !== c && sees(i, a) && sees(i, c) && b.cand[i] & z) addElim(elims, i, z);
        const step = elimStep("xyz-wing", elims, b);
        if (step) return step;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

/** Langkah logis termudah berikutnya, atau null bila teknik yang dikenal tidak cukup. */
export function nextStep(b: LogicBoard): Step | null {
  return (
    fullHouse(b) ??
    hiddenSingle(b, BOX_UNITS, "hidden-single-box") ??
    hiddenSingle(b, LINE_UNITS, "hidden-single-line") ??
    nakedSingle(b) ??
    pointing(b) ??
    claiming(b) ??
    nakedSubset(b, 2, "naked-pair") ??
    fish(b, 2, "x-wing") ??
    hiddenSubset(b, 2, "hidden-pair") ??
    nakedSubset(b, 3, "naked-triple") ??
    fish(b, 3, "swordfish") ??
    hiddenSubset(b, 3, "hidden-triple") ??
    xyWing(b) ??
    xyzWing(b) ??
    nakedSubset(b, 4, "naked-quad") ??
    hiddenSubset(b, 4, "hidden-quad")
  );
}

export function applyStep(b: LogicBoard, step: Step): void {
  if (step.place) b.place(step.place.cell, step.place.digit);
  for (const [cell, mask] of step.eliminate ?? []) b.cand[cell] &= ~mask;
}

export interface Grade {
  solved: boolean;
  /** Bobot teknik tersulit yang diperlukan. */
  rating: number;
  hardest: Technique;
  /** Jumlah bobot semua langkah (pemecah urutan). */
  total: number;
  steps: number;
  givens: number;
  /** Isi papan setelah pemecahan logis. */
  result: Grid;
}

export function grade(puzzle: Grid): Grade {
  const b = new LogicBoard(puzzle);
  let rating = 0;
  let hardest: Technique = "full-house";
  let total = 0;
  let steps = 0;
  for (let guard = 0; guard < 2000 && !b.solved(); guard++) {
    const step = nextStep(b);
    if (!step) break;
    applyStep(b, step);
    const cost = TECHNIQUE_COST[step.tech];
    total += cost;
    steps++;
    if (cost > rating) {
      rating = cost;
      hardest = step.tech;
    }
  }
  return {
    solved: b.solved() && !b.broken(),
    rating,
    hardest,
    total,
    steps,
    givens: puzzle.filter((v) => v).length,
    result: b.values,
  };
}
