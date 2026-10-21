// Sistem simpan: serialisasi JSON berversi + backend penyimpanan yang bisa ditukar.

import { createInitialState, migrateState, NewerSaveError } from "./state";
import type { GameState } from "./types";

export interface SaveBackend {
  /** null bila belum ada simpanan; melempar error bila file ada tetapi gagal dibaca. */
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
  /** Cadangan simpanan sebelumnya, dipakai bila simpanan utama rusak. */
  loadBackup?(): Promise<string | null>;
  /** Salin simpanan yang tidak bisa dipakai ke file terpisah sebelum ditimpa. */
  preserveBroken?(): Promise<void>;
}

/** Backend untuk mode browser (pengembangan tanpa Tauri). */
export class LocalStorageBackend implements SaveBackend {
  constructor(private key = "sudoku-pojok-save") {}

  async load(): Promise<string | null> {
    try {
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  async save(data: string): Promise<void> {
    try {
      localStorage.setItem(this.key, data);
    } catch {
      // Penyimpanan penuh atau diblokir: abaikan, autosave berikutnya mencoba lagi.
    }
  }
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

let newerSeen = false;

function parseSave(raw: string | null, now: number): GameState | null {
  if (!raw) return null;
  try {
    return migrateState(JSON.parse(raw) as unknown, now);
  } catch (err) {
    if (err instanceof NewerSaveError) newerSeen = true;
    return null;
  }
}

/**
 * Hasil memuat:
 * - "baru": belum ada simpanan, mulai permainan baru.
 * - "rusak": ada simpanan tetapi tidak bisa dipakai (dan cadangannya juga tidak).
 *   File lama harus diamankan dulu sebelum disimpan ulang.
 * - "gagal-baca": file tidak bisa dibaca (misalnya terkunci). Jangan menyimpan apa pun
 *   agar data lama tidak tertimpa.
 * - "versi-baru": simpanan dibuat versi aplikasi yang lebih baru. Jangan ditimpa.
 */
export type LoadProblem = "baru" | "rusak" | "gagal-baca" | "versi-baru" | null;

/** Muat state dari backend. Bila simpanan utama rusak, coba cadangan; bila tidak ada, mulai baru. */
export async function loadState(
  backend: SaveBackend,
  now: number,
): Promise<{ state: GameState; fresh: boolean; problem: LoadProblem }> {
  let main: string | null = null;
  let readFailed = false;
  newerSeen = false;
  try {
    main = await backend.load();
  } catch (err) {
    readFailed = true;
    console.warn("Gagal membaca simpanan utama.", err);
  }
  const fromMain = parseSave(main, now);
  if (fromMain) return { state: fromMain, fresh: false, problem: null };

  let backup: string | null = null;
  if (backend.loadBackup) {
    try {
      backup = await backend.loadBackup();
    } catch (err) {
      readFailed = true;
      console.warn("Gagal membaca cadangan simpanan.", err);
    }
    const fromBackup = parseSave(backup, now);
    if (fromBackup) {
      console.warn("Simpanan utama tidak bisa dipakai; memakai cadangan.");
      return { state: fromBackup, fresh: false, problem: null };
    }
  }
  const problem: LoadProblem = newerSeen
    ? "versi-baru"
    : readFailed
      ? "gagal-baca"
      : main !== null || backup !== null
        ? "rusak"
        : "baru";
  return { state: createInitialState(now), fresh: true, problem };
}

export class AutoSaver {
  private timer: number | undefined;
  private saving: Promise<void> | null = null;

  constructor(
    private backend: SaveBackend,
    private getState: () => GameState,
    private intervalMs = 60_000,
  ) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => void this.saveNow(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Simpan sekarang. Tidak pernah melempar error; mengembalikan false bila gagal. */
  async saveNow(): Promise<boolean> {
    // Satu penyimpanan pada satu waktu; panggilan berikutnya menunggu yang berjalan.
    if (this.saving) await this.saving.catch(() => undefined);
    this.saving = this.backend.save(serialize(this.getState())).finally(() => {
      this.saving = null;
    });
    try {
      await this.saving;
      return true;
    } catch (err) {
      console.error("Gagal menyimpan permainan.", err);
      return false;
    }
  }
}
