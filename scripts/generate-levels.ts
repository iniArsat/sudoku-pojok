// Membuat 100 level sudoku dengan kesulitan yang naik bertahap, lalu menulisnya ke
// src/core/levels.json. Deterministik (benih tetap), jadi hasilnya selalu sama.
//
//   npx tsx scripts/generate-levels.ts
//
// Kesulitan diukur dengan pemecah logis (src/core/sudoku.ts): teknik tersulit yang
// diperlukan, lalu jumlah langkah. Teka-teki yang butuh tebakan tidak dipakai.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grade, gridToString, makePuzzle, randomSolution, seededRng, type Grade, type Grid } from "../src/core/sudoku";

interface Candidate {
  puzzle: Grid;
  solution: Grid;
  grade: Grade;
}

interface Band {
  name: string;
  count: number;
  accept: (g: Grade) => boolean;
  /** Target jumlah angka awal per urutan (untuk level termudah); null = seminimal mungkin. */
  givens?: (k: number) => number;
}

const BANDS: Band[] = [
  { name: "sangat mudah", count: 10, accept: (g) => g.rating <= 1.2, givens: (k) => 46 - k },
  { name: "mudah", count: 10, accept: (g) => g.rating === 1.5, givens: (k) => 36 - Math.floor(k / 2) },
  { name: "santai", count: 12, accept: (g) => g.rating === 1.5 && g.givens <= 31 },
  { name: "sedang", count: 13, accept: (g) => g.rating === 2.3 && g.givens <= 30 },
  { name: "menantang", count: 13, accept: (g) => g.rating >= 2.6 && g.rating <= 2.8 && g.givens <= 30 },
  { name: "sulit", count: 12, accept: (g) => g.rating >= 3.0 && g.rating <= 3.4 && g.givens <= 30 },
  { name: "sangat sulit", count: 10, accept: (g) => g.rating >= 3.6 && g.rating <= 3.8 && g.givens <= 30 },
  { name: "ahli", count: 10, accept: (g) => g.rating >= 4.0 && g.rating <= 4.2 && g.givens <= 30 },
  { name: "master", count: 10, accept: (g) => g.rating >= 4.4 && g.givens <= 30 },
];

const rng = seededRng(20261021);
const levels: { p: string; s: string; r: number; t: string; g: number; b: string }[] = [];
const seen = new Set<string>();

function candidate(minGivens: number): Candidate {
  const solution = randomSolution(rng);
  const puzzle = makePuzzle(solution, rng, minGivens);
  const g = grade(puzzle);
  // Pemeriksaan silang: hasil pemecahan logis harus sama dengan solusi asli.
  if (g.solved && gridToString(g.result) !== gridToString(solution)) throw new Error("pemecah logis salah: " + gridToString(puzzle));
  return { puzzle, solution, grade: g };
}

const started = Date.now();
// Kumpulan teka-teki minimal untuk pita yang lebih sulit.
const pool: Candidate[] = [];
const needMinimal = BANDS.filter((b) => !b.givens);

function enough(): boolean {
  return needMinimal.every((band) => pool.filter((c) => c.grade.solved && band.accept(c.grade)).length >= band.count);
}

for (let n = 0; n < 200000 && !enough(); n++) {
  const c = candidate(17);
  const key = gridToString(c.puzzle);
  if (!c.grade.solved || seen.has(key)) continue;
  seen.add(key);
  pool.push(c);
  if (pool.length % 200 === 0) {
    const counts = needMinimal.map((b) => `${b.name}:${pool.filter((x) => b.accept(x.grade)).length}`).join(" ");
    console.log(`${pool.length} teka-teki, ${Math.round((Date.now() - started) / 1000)} dtk  ${counts}`);
  }
}

for (const band of BANDS) {
  let picked: Candidate[] = [];
  if (band.givens) {
    for (let k = 0; k < band.count; k++) {
      for (let tries = 0; tries < 500; tries++) {
        const c = candidate(band.givens(k));
        if (c.grade.solved && band.accept(c.grade) && c.grade.givens === band.givens(k)) {
          picked.push(c);
          break;
        }
      }
    }
  } else {
    // Ambil merata dari yang memenuhi, diurutkan dari yang paling ringan.
    // Urutan: teknik lebih mudah dulu, lalu angka awal lebih banyak (lebih mudah) dulu.
    const ok = pool
      .filter((c) => band.accept(c.grade))
      .sort((a, b) => a.grade.rating - b.grade.rating || b.grade.givens - a.grade.givens || a.grade.total - b.grade.total);
    for (let k = 0; k < band.count && ok.length; k++) picked.push(ok[Math.min(ok.length - 1, Math.floor((k * ok.length) / band.count))]);
    picked = [...new Set(picked)];
  }
  if (picked.length < band.count) throw new Error(`pita ${band.name} hanya ${picked.length}/${band.count}`);
  for (const c of picked) {
    levels.push({
      p: gridToString(c.puzzle),
      s: gridToString(c.solution),
      r: c.grade.rating,
      t: c.grade.hardest,
      g: c.grade.givens,
      b: band.name,
    });
  }
}

const out = fileURLToPath(new URL("../src/core/levels.json", import.meta.url));
writeFileSync(out, JSON.stringify(levels).replace(/\},\{/g, "},\n{") + "\n");
console.log(`Selesai: ${levels.length} level dalam ${Math.round((Date.now() - started) / 1000)} detik → ${out}`);
