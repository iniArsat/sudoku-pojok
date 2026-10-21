import { describe, expect, it } from "vitest";
import { LEVELS, LEVEL_COUNT } from "../src/core/levels";
import {
  countSolutions,
  grade,
  gridToString,
  isConsistent,
  makePuzzle,
  parseGrid,
  PEERS,
  randomSolution,
  seededRng,
  solve,
  UNITS,
} from "../src/core/sudoku";

describe("mesin sudoku", () => {
  it("unit dan tetangga", () => {
    expect(UNITS).toHaveLength(27);
    for (const unit of UNITS) expect(new Set(unit).size).toBe(9);
    for (const peers of PEERS) expect(peers).toHaveLength(20);
  });

  it("memecahkan teka-teki dan mendeteksi solusi ganda", () => {
    const easy = parseGrid("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
    expect(countSolutions(easy)).toBe(1);
    expect(gridToString(solve(easy)!)).toBe("534678912672195348198342567859761423426853791713924856961537284287419635345286179");
    const empty = new Array(81).fill(0);
    expect(countSolutions(empty, 2)).toBe(2);
    const broken = easy.slice();
    broken[2] = 5; // dua angka 5 di baris pertama
    expect(countSolutions(broken)).toBe(0);
  });

  it("penilai mengenali teknik dan tidak salah menghapus kandidat", () => {
    const xwing = parseGrid("1.....569492.561.8.561.924...964.8.1.64.1....218.356.4.4.5...169.5.614.2621.....5");
    const g = grade(xwing);
    expect(g.solved).toBe(true);
    expect(g.hardest).toBe("x-wing");
    expect(gridToString(g.result)).toBe(gridToString(solve(xwing)!));
  });

  it("pembuat menghasilkan teka-teki bersolusi tunggal yang cocok dengan papan asal", () => {
    const rng = seededRng(7);
    for (let n = 0; n < 15; n++) {
      const solution = randomSolution(rng);
      expect(isConsistent(solution)).toBe(true);
      expect(solution.every((v) => v >= 1 && v <= 9)).toBe(true);
      const puzzle = makePuzzle(solution, rng, 17);
      expect(countSolutions(puzzle)).toBe(1);
      puzzle.forEach((v, i) => v && expect(v).toBe(solution[i]));
      const g = grade(puzzle);
      if (g.solved) expect(gridToString(g.result)).toBe(gridToString(solution));
    }
  });
});

describe("100 level", () => {
  it("ada 100 level, semuanya sah, bersolusi tunggal, dan bisa dipecahkan tanpa menebak", () => {
    expect(LEVEL_COUNT).toBe(100);
    const seen = new Set<string>();
    for (const lv of LEVELS) {
      const key = gridToString(lv.puzzle);
      expect(seen.has(key), `level ${lv.n} kembar`).toBe(false);
      seen.add(key);
      expect(isConsistent(lv.solution)).toBe(true);
      lv.puzzle.forEach((v, i) => v && expect(v).toBe(lv.solution[i]));
      expect(countSolutions(lv.puzzle), `level ${lv.n}`).toBe(1);
      const g = grade(lv.puzzle);
      expect(g.solved, `level ${lv.n}`).toBe(true);
      expect(g.rating).toBe(lv.rating);
      expect(gridToString(g.result)).toBe(gridToString(lv.solution));
    }
  });

  it("kesulitan tidak pernah turun antar-pita, dan level akhir jauh lebih sulit", () => {
    const bandOrder = [...new Set(LEVELS.map((l) => l.band))];
    for (let i = 1; i < LEVELS.length; i++) {
      expect(bandOrder.indexOf(LEVELS[i].band)).toBeGreaterThanOrEqual(bandOrder.indexOf(LEVELS[i - 1].band));
    }
    // Teknik tersulit per pita naik (pita yang dibuat dari jumlah angka awal boleh sama).
    const maxRating = (band: string) => Math.max(...LEVELS.filter((l) => l.band === band).map((l) => l.rating));
    for (let b = 3; b < bandOrder.length; b++) expect(maxRating(bandOrder[b])).toBeGreaterThan(maxRating(bandOrder[b - 1]));
    expect(LEVELS[0].givens).toBeGreaterThan(LEVELS[99].givens + 15);
    expect(LEVELS[99].rating).toBeGreaterThanOrEqual(4.4);
    expect(LEVELS[0].rating).toBeLessThanOrEqual(1.2);
  });
});
