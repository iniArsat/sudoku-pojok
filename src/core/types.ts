// Tipe state permainan. Semua bisa diserialisasi ke JSON.

export interface LevelRecord {
  /** 0 = belum pernah selesai, 1..3 bintang terbaik. */
  stars: number;
  /** Waktu tercepat (ms), null bila belum selesai. */
  bestMs: number | null;
  /** Berapa kali diselesaikan. */
  wins: number;
}

export interface CurrentGame {
  level: number;
  /** 81 karakter: angka 1-9 atau "." untuk kosong (termasuk angka awal). */
  cells: string;
  /** Catatan pensil per sel (bitmask angka 1-9). */
  notes: number[];
  mistakes: number;
  hints: number;
  elapsedMs: number;
  done: boolean;
}

export type ThemeId = "kertas" | "malam" | "matcha" | "sakura" | "laut" | "kayu" | "retro";

export interface Settings {
  theme: ThemeId;
  /** Sorot angka yang sama di seluruh papan. */
  highlightSame: boolean;
  /** Hapus catatan di baris/kolom/kotak saat angka benar dimasukkan. */
  autoNotes: boolean;
  /** Tampilkan waktu. */
  showTimer: boolean;
  sound: boolean;
  volume: number;
  corner: "kanan" | "kiri";
  /** Perbesaran widget. */
  scale: 1 | 1.15 | 1.3;
  /** Widget sedang diciutkan menjadi pil kecil. */
  collapsed: boolean;
}

export interface Stats {
  wins: number;
  playMs: number;
  mistakes: number;
  hints: number;
  /** Hari berturut-turut menyelesaikan minimal satu level, dan tanggal terakhirnya. */
  streak: number;
  lastWinDate: string;
}

export interface GameState {
  version: number;
  createdAt: number;
  /** Level tertinggi yang sudah terbuka (1..100). */
  unlocked: number;
  /** Catatan per level, kunci = nomor level. */
  records: Record<string, LevelRecord>;
  current: CurrentGame | null;
  /** Permainan yang ditinggal di tengah jalan, per nomor level (dilanjutkan saat dibuka lagi). */
  paused: Record<string, CurrentGame>;
  settings: Settings;
  stats: Stats;
}
