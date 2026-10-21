// Klik tembus per area. Jendela menutupi pojok layar tetapi
// hanya menangkap klik di atas kamar atau UI. Caranya: jendela
// diatur mengabaikan kursor, lalu posisi kursor dicek berkala; saat kursor
// berada di atas sesuatu yang bisa diklik, pengabaian dimatikan.

import { cursorInWindow, isTauri, setClickThrough } from "./desktop";

export type HitTest = (x: number, y: number) => boolean;
export type HoverHandler = (x: number | null, y: number | null) => void;

const POLL_MS = 50;
/** Status klik tembus dikirim ulang berkala, untuk berjaga dari balapan dengan sisi Rust. */
const REASSERT_MS = 2000;

export class ClickThroughController {
  private ignoring = true;
  private busy = false;
  private lastSent = 0;
  private timer: number | undefined;

  constructor(
    private hitTest: HitTest,
    private onHover: HoverHandler,
    /** true selama tombol mouse ditekan di jendela (misalnya menyeret penggeser). */
    private isCapturing: () => boolean = () => false,
  ) {}

  start(): void {
    if (!isTauri) {
      // Mode browser: tidak ada klik tembus, cukup teruskan posisi mouse untuk hover.
      window.addEventListener("pointermove", (e) => this.onHover(e.clientX, e.clientY));
      window.addEventListener("pointerleave", () => this.onHover(null, null));
      return;
    }
    void setClickThrough(true);
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  /** Jendela baru ditampilkan lagi: sisi Rust sudah memasang klik tembus. */
  reset(): void {
    this.ignoring = true;
    this.lastSent = 0;
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const cursor = await cursorInWindow();
      if (!cursor) return;
      // Selama menyeret, jendela tetap menangkap mouse walau kursor keluar dari jendela.
      const interactive = this.isCapturing() || (cursor.inside && this.hitTest(cursor.x, cursor.y));
      this.onHover(cursor.inside ? cursor.x : null, cursor.inside ? cursor.y : null);
      const now = Date.now();
      if (interactive === this.ignoring || now - this.lastSent > REASSERT_MS) {
        this.ignoring = !interactive;
        this.lastSent = now;
        await setClickThrough(this.ignoring);
      }
    } catch {
      // Jendela sedang tersembunyi atau berpindah monitor; coba lagi di putaran berikutnya.
    } finally {
      this.busy = false;
    }
  }
}

/** Elemen HTML yang bisa diklik ditandai dengan atribut data-hit. */
export function htmlHitTest(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return !!el?.closest("[data-hit]");
}
