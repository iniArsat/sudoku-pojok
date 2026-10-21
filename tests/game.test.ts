import { describe, expect, it } from "vitest";
import { dateKey, Game, MAX_HINTS, starsFor, yesterdayKey } from "../src/core/game";
import { LEVELS } from "../src/core/levels";
import { createInitialState, migrateState, NewerSaveError } from "../src/core/state";

function newGame(): Game {
  return new Game(createInitialState(Date.now()));
}

/** Isi semua sel kosong level yang sedang dimainkan dengan jawaban benar. */
function solveAll(g: Game): void {
  const lv = g.levelDef!;
  for (let i = 0; i < 81; i++) {
    if (g.value(i)) continue;
    g.select(i);
    g.input(lv.solution[i]);
  }
}

function firstEmpty(g: Game): number {
  for (let i = 0; i < 81; i++) if (!g.value(i)) return i;
  return -1;
}

describe("permainan", () => {
  it("level 1 terbuka, level 2 terkunci", () => {
    const g = newGame();
    expect(g.start(2)).toBe(false);
    expect(g.start(1)).toBe(true);
    expect(g.current?.cells.replace(/\./g, "").length).toBe(LEVELS[0].givens);
  });

  it("angka benar terkunci, angka salah dihitung dan bisa dihapus", () => {
    const g = newGame();
    g.start(1);
    const lv = g.levelDef!;
    const i = firstEmpty(g);
    g.select(i);
    const wrong = (lv.solution[i] % 9) + 1;
    expect(g.input(wrong)).toBe("salah");
    expect(g.isWrong(i)).toBe(true);
    expect(g.current!.mistakes).toBe(1);
    expect(g.erase()).toBe("hapus");
    expect(g.value(i)).toBe(0);
    expect(g.input(lv.solution[i])).toBe("benar");
    expect(g.isLocked(i)).toBe(true);
    expect(g.input(wrong)).toBe("terkunci");
    expect(g.erase()).toBe("terkunci");
    // Angka awal tidak bisa diubah.
    const given = lv.puzzle.findIndex((v) => v !== 0);
    g.select(given);
    expect(g.input(1)).toBe("terkunci");
  });

  it("catatan, hapus catatan otomatis, dan urung", () => {
    const g = newGame();
    g.start(1);
    const lv = g.levelDef!;
    const i = firstEmpty(g);
    const d = lv.solution[i];
    const peer = [...Array(81).keys()].find((p) => p !== i && !g.value(p) && Math.floor(p / 9) === Math.floor(i / 9))!;
    g.toggleNotes();
    g.select(peer);
    expect(g.input(d)).toBe("catatan");
    expect(g.current!.notes[peer]).toBe(1 << (d - 1));
    g.toggleNotes();
    g.select(i);
    g.input(d);
    expect(g.current!.notes[peer]).toBe(0);
    expect(g.undo()).toBe(true);
    expect(g.value(i)).toBe(0);
    expect(g.current!.notes[peer]).toBe(1 << (d - 1));
  });

  it("menang: bintang, rekor, level berikutnya terbuka", () => {
    const g = newGame();
    const wins: number[] = [];
    g.on("win", (w) => wins.push(w.stars));
    g.start(1);
    for (let k = 0; k < 60; k++) g.tick(1000);
    solveAll(g);
    expect(wins).toEqual([3]);
    expect(g.current!.done).toBe(true);
    expect(g.state.unlocked).toBe(2);
    expect(g.record(1)).toEqual({ stars: 3, bestMs: 60_000, wins: 1 });
    expect(g.totalStars()).toBe(3);
    // Main ulang dengan kesalahan: bintang terbaik tetap 3.
    g.start(1);
    const i = firstEmpty(g);
    g.select(i);
    g.input((g.levelDef!.solution[i] % 9) + 1);
    g.input((g.levelDef!.solution[i] % 9) + 1); // menekan angka yang sama menghapusnya
    solveAll(g);
    expect(wins).toEqual([3, 2]);
    expect(g.record(1).stars).toBe(3);
    expect(g.record(1).wins).toBe(2);
    expect(g.state.unlocked).toBe(2);
  });

  it("petunjuk: mengisi sel dengan alasan, terbatas", () => {
    const g = newGame();
    g.start(1);
    const lv = g.levelDef!;
    const h = g.hint()!;
    expect(h.digit).toBe(lv.solution[h.cell]);
    expect(g.value(h.cell)).toBe(h.digit);
    expect(h.reason.length).toBeGreaterThan(10);
    for (let k = 1; k < MAX_HINTS; k++) expect(g.hint()).not.toBeNull();
    expect(g.hint()).toBeNull();
    expect(g.hintsLeft()).toBe(0);
  });

  it("petunjuk di sel salah yang dipilih", () => {
    const g = newGame();
    g.start(1);
    const lv = g.levelDef!;
    const i = firstEmpty(g);
    g.select(i);
    g.input((lv.solution[i] % 9) + 1);
    const h = g.hint()!;
    expect(h.cell).toBe(i);
    expect(g.isWrong(i)).toBe(false);
  });

  it("pindah level tidak menghapus permainan yang belum selesai", () => {
    const g = newGame();
    g.start(1);
    solveAll(g);
    g.start(2);
    const i = firstEmpty(g);
    g.select(i);
    g.input(g.levelDef!.solution[i]);
    for (let k = 0; k < 5; k++) g.tick(1000);
    g.start(1); // main ulang level 1; level 2 disimpan
    expect(g.inProgress(2)).toBe(true);
    expect(g.state.paused["2"].elapsedMs).toBe(5000);
    g.start(2);
    expect(g.current!.level).toBe(2);
    expect(g.value(i)).toBe(g.levelDef!.solution[i]);
    expect(g.current!.elapsedMs).toBe(5000);
    expect(g.state.paused["2"]).toBeUndefined();
    expect(g.state.paused["1"]).toBeDefined();
    // Ulangi membuang isian.
    g.restart();
    expect(g.value(i)).toBe(0);
  });

  it("urung petunjuk memulihkan catatan tetangga", () => {
    const g = newGame();
    g.start(1);
    const lv = g.levelDef!;
    const i = firstEmpty(g);
    const d = lv.solution[i];
    const peer = [...Array(81).keys()].find((p) => p !== i && !g.value(p) && Math.floor(p / 9) === Math.floor(i / 9))!;
    g.toggleNotes();
    g.select(peer);
    g.input(d);
    g.toggleNotes();
    g.select(i);
    g.hint();
    expect(g.current!.notes[peer]).toBe(0);
    g.undo();
    expect(g.value(i)).toBe(0);
    expect(g.current!.notes[peer]).toBe(1 << (d - 1));
  });

  it("hari beruntun dan tanggal kemarin", () => {
    const now = new Date(2026, 2, 1, 10).getTime();
    expect(yesterdayKey(now)).toBe("2026-02-28");
    const g = newGame();
    g.state.stats.streak = 4;
    g.state.stats.lastWinDate = dateKey(now);
    expect(g.currentStreak(now)).toBe(4);
    expect(g.currentStreak(now + 2 * 86_400_000)).toBe(0);
  });

  it("bintang", () => {
    expect(starsFor(0, 0)).toBe(3);
    expect(starsFor(2, 1)).toBe(2);
    expect(starsFor(3, 0)).toBe(1);
    expect(starsFor(0, 2)).toBe(1);
  });

  it("tema terbuka dengan bintang", () => {
    const g = newGame();
    g.updateSettings({ theme: "malam" });
    expect(g.state.settings.theme).toBe("kertas");
    for (let n = 1; n <= 4; n++) {
      g.start(n);
      solveAll(g);
    }
    expect(g.totalStars()).toBe(12);
    g.updateSettings({ theme: "malam" });
    expect(g.state.settings.theme).toBe("malam");
  });
});

describe("simpanan", () => {
  it("bolak-balik tanpa perubahan", () => {
    const g = newGame();
    g.start(1);
    const i = firstEmpty(g);
    g.select(i);
    g.input(g.levelDef!.solution[i]);
    const copy = migrateState(JSON.parse(JSON.stringify(g.state)), Date.now());
    expect(copy).toEqual(g.state);
  });

  it("simpanan dari versi lebih baru tidak dimuat (agar tidak ditimpa)", () => {
    expect(() => migrateState({ version: 99 }, Date.now())).toThrow(NewerSaveError);
  });

  it("permainan tertunda ikut dibersihkan", () => {
    const s = migrateState(
      { version: 1, unlocked: 3, paused: { "2": { level: 2, cells: "" }, "9": { level: 9, cells: "" }, "3": { level: 1, cells: "" } } },
      Date.now(),
    );
    expect(Object.keys(s.paused)).toEqual(["2"]);
  });

  it("membersihkan data rusak", () => {
    const s = migrateState(
      {
        version: 1,
        unlocked: 500,
        records: { "1": { stars: 9, bestMs: -3, wins: 1 }, constructor: { stars: 3 } },
        current: { level: 1, cells: "x".repeat(81), notes: [999999], mistakes: -2 },
        settings: { theme: "ungu", scale: 9, corner: "atas" },
      },
      Date.now(),
    );
    expect(s.unlocked).toBe(100);
    expect(s.records["1"]).toEqual({ stars: 3, bestMs: null, wins: 1 });
    expect(Object.keys(s.records)).toEqual(["1"]);
    expect(s.current!.cells.replace(/\./g, "").length).toBe(LEVELS[0].givens);
    expect(s.current!.mistakes).toBe(0);
    expect(s.settings.theme).toBe("kertas");
    expect(s.settings.scale).toBe(1);
    expect(s.settings.corner).toBe("kanan");
    // Level yang belum terbuka tidak bisa jadi permainan aktif.
    const t = migrateState({ version: 1, unlocked: 1, current: { level: 50, cells: "" } }, Date.now());
    expect(t.current).toBeNull();
  });
});
