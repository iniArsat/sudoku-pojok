// Jembatan ke sisi Rust (Tauri). Di browser biasa semua fungsi menjadi no-op,
// jadi game tetap bisa dikembangkan dan diuji dengan `npm run dev`.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LocalStorageBackend, type SaveBackend } from "../core/save";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface CursorInfo {
  x: number;
  y: number;
  inside: boolean;
}

/** Ukuran jendela (piksel logis): widget di pojok, sisanya ruang untuk kabar. */
export const WINDOW_WIDTH = 470;
export const WINDOW_HEIGHT = 760;

/** Tempelkan jendela ke pojok kanan bawah atau kiri bawah layar. */
export async function dockWindow(corner: "kanan" | "kiri"): Promise<void> {
  if (!isTauri) return;
  await invoke("dock_window", { corner, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
}

export async function setClickThrough(ignore: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_click_through", { ignore });
}

export async function cursorInWindow(): Promise<CursorInfo | null> {
  if (!isTauri) return null;
  return invoke<CursorInfo>("cursor_in_window");
}

export async function hideWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("hide_window");
}

export async function quitApp(): Promise<void> {
  if (!isTauri) {
    window.close();
    return;
  }
  await invoke("quit_app");
}

/** Tray meminta keluar: simpan dulu, lalu panggil quitApp(). */
export async function onQuitRequested(cb: () => void): Promise<void> {
  if (!isTauri) return;
  await listen("request-quit", () => cb());
}

/** Jendela disembunyikan/ditampilkan (tray atau game layar penuh). */
export async function onVisibilityChanged(cb: (visible: boolean) => void): Promise<void> {
  if (!isTauri) {
    document.addEventListener("visibilitychange", () => cb(document.visibilityState === "visible"));
    return;
  }
  await listen<boolean>("visibility-changed", (e) => cb(e.payload));
  // Event bisa terkirim sebelum pendengar siap; tanyakan keadaan sekarang sekali.
  cb(await invoke<boolean>("window_visible"));
}

/** Munculkan jendela yang disembunyikan pengguna (tidak berlaku saat ada aplikasi layar penuh). */
export async function showWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_window_cmd");
}

/** Jalankan Sudoku Pojok saat komputer menyala. */
export async function getAutostart(): Promise<boolean | null> {
  if (!isTauri) return null;
  try {
    return await invoke<boolean>("get_autostart");
  } catch {
    return null;
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean | null> {
  if (!isTauri) return null;
  try {
    return await invoke<boolean>("set_autostart", { enabled });
  } catch {
    return null;
  }
}

class TauriSaveBackend implements SaveBackend {
  load(): Promise<string | null> {
    return invoke<string | null>("load_save");
  }

  save(data: string): Promise<void> {
    return invoke("write_save", { data });
  }

  loadBackup(): Promise<string | null> {
    return invoke<string | null>("load_backup");
  }

  preserveBroken(): Promise<void> {
    return invoke("preserve_broken_save");
  }
}

export function createSaveBackend(): SaveBackend {
  return isTauri ? new TauriSaveBackend() : new LocalStorageBackend();
}
