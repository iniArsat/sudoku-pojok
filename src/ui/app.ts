// Widget Sudoku Pojok: papan 9×9, tombol angka, alat (urung, hapus, catatan,
// petunjuk), daftar 100 level, pengaturan, dan mode ciut menjadi pil kecil.

import type { Game, WinInfo } from "../core/game";
import { MAX_HINTS, THEME_UNLOCK } from "../core/game";
import { bandLabel, BANDS, level, LEVEL_COUNT, LEVELS, techniqueName } from "../core/levels";
import { BOXES, boxOf, colOf, rowOf } from "../core/sudoku";
import type { ThemeId } from "../core/types";
import { drawMascot, type Mood } from "../render/mascot";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { configureSound, playSound, unlockAudio } from "./sound";

type View = "papan" | "level" | "atur";

export interface AppActions {
  setCorner: (corner: "kanan" | "kiri") => void;
  hide: () => void;
  quit: () => void;
  autostart: () => boolean | null;
  setAutostart: (enabled: boolean) => void;
  save: () => void;
}

const THEME_NAMES: Record<ThemeId, string> = {
  kertas: "Kertas",
  malam: "Malam",
  matcha: "Matcha",
  sakura: "Sakura",
  laut: "Laut",
  kayu: "Kayu",
  retro: "Retro",
};

/** Warna contoh tiap tema (latar, garis, aksen) untuk tombol pilihan. */
const THEME_SWATCH: Record<ThemeId, [string, string, string]> = {
  kertas: ["#fff8ec", "#2a1d1a", "#e8913a"],
  malam: ["#20243a", "#cfd6ff", "#8aa2ff"],
  matcha: ["#eef5e4", "#2f4a2a", "#6aa84f"],
  sakura: ["#fff0f4", "#5a2a3a", "#e86a92"],
  laut: ["#eaf5fb", "#1f3a52", "#3f8fd1"],
  kayu: ["#f3e2c7", "#4a2e1c", "#b5652e"],
  retro: ["#0f1f12", "#7dff8a", "#ffd34d"],
};

/** Waktu dihitung hanya bila ada interaksi dalam rentang ini. */
const IDLE_PAUSE_MS = 30_000;

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

const ANIMATIONS = ["shake", "flash", "hinted"];

/** Jalankan animasi CSS sekali; kelasnya dilepas begitu selesai agar tidak terulang. */
function animate(el: HTMLElement, cls: string, delayMs = 0): void {
  stopAnimation(el);
  void el.offsetWidth;
  el.style.animationDelay = delayMs ? `${delayMs}ms` : "";
  el.classList.add(cls);
  const done = () => {
    el.classList.remove(cls);
    el.style.animationDelay = "";
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
  // Cadangan bila animationend tidak datang (elemen disembunyikan).
  window.setTimeout(done, 1600 + delayMs);
}

function stopAnimation(el: HTMLElement): void {
  for (const cls of ANIMATIONS) el.classList.remove(cls);
  el.style.animationDelay = "";
}

interface CellEl {
  el: HTMLButtonElement;
  value: HTMLSpanElement;
  notes: HTMLSpanElement[];
}

export class App {
  private root: HTMLElement;
  private widget: HTMLDivElement;
  private pill: HTMLButtonElement;
  private pillText: HTMLSpanElement;
  private mascot: HTMLCanvasElement;
  private lvBtn: HTMLButtonElement;
  private lvName: HTMLSpanElement;
  private lvBand: HTMLSpanElement;
  private mistakesEl: HTMLSpanElement;
  private timeEl: HTMLSpanElement;
  private viewEl: HTMLDivElement;
  private boardView: HTMLDivElement;
  private boardWrap: HTMLDivElement;
  private cells: CellEl[] = [];
  private pad: HTMLButtonElement[] = [];
  private undoBtn: HTMLButtonElement;
  private notesBtn: HTMLButtonElement;
  private hintBtn: HTMLButtonElement;
  private hintCount: HTMLSpanElement;
  private msg: HTMLDivElement;
  private toasts: HTMLDivElement;
  private overlay: HTMLDivElement | null = null;
  private view: View = "papan";
  private lastInteraction = 0;
  private visible = true;
  private mood: Mood = "biasa";
  private moodUntil = 0;
  private hopUntil = 0;
  private nextBlink = 0;
  private msgTimer = 0;
  /** Jumlah bintang terakhir yang diketahui (untuk kabar tema baru). */
  private knownStars = 0;

  constructor(
    private game: Game,
    private actions: AppActions,
  ) {
    this.root = document.getElementById("ui")!;

    this.mascot = h("canvas", { class: "mascot px", title: "Oyen menemanimu bermain" }) as HTMLCanvasElement;
    this.lvName = h("span", { class: "lv-name" });
    this.lvBand = h("span", { class: "lv-band" });
    this.lvBtn = h("button", { class: "lv-btn", title: "Pilih level", onclick: () => this.show(this.view === "level" ? "papan" : "level") }, this.lvName, this.lvBand);
    this.mistakesEl = h("span", { class: "stat", title: "Kesalahan" });
    this.timeEl = h("span", { class: "stat time", title: "Waktu (berhenti bila 30 detik tidak dimainkan)" });
    const header = h(
      "div",
      { class: "bar" },
      this.lvBtn,
      h("span", { class: "spacer" }),
      this.mistakesEl,
      this.timeEl,
      h("button", { class: "icon-btn", title: "Pilih level", onclick: () => this.show(this.view === "level" ? "papan" : "level") }, icon("level")),
      h("button", { class: "icon-btn", title: "Pengaturan", onclick: () => this.show(this.view === "atur" ? "papan" : "atur") }, icon("atur")),
      h("button", { class: "icon-btn", title: "Ciutkan", onclick: () => this.setCollapsed(true) }, icon("ciutkan")),
    );

    // Papan
    this.boardWrap = h("div", { class: "board-wrap" });
    const board = h("div", { class: "board", role: "grid", "aria-label": "Papan sudoku" });
    const cellEls: CellEl[] = new Array(81);
    for (let b = 0; b < 9; b++) {
      const box = h("div", { class: "box" });
      for (const i of BOXES[b]) {
        const value = h("span", { class: "v" });
        const notes = Array.from({ length: 9 }, (_, k) => h("span", null, String(k + 1)));
        const el = h(
          "button",
          {
            class: "cell",
            "aria-label": `Baris ${rowOf(i) + 1} kolom ${colOf(i) + 1}`,
            onpointerdown: (e: PointerEvent) => {
              e.preventDefault();
              this.touch();
              this.game.select(i);
            },
          },
          value,
          h("span", { class: "n" }, notes),
        );
        box.append(el);
        cellEls[i] = { el, value, notes };
      }
      board.append(box);
    }
    this.cells = cellEls;
    this.boardWrap.append(board);

    const padRow = h("div", { class: "pad" });
    for (let d = 1; d <= 9; d++) {
      const btn = h(
        "button",
        { class: "num", onclick: () => this.input(d) },
        h("b", null, String(d)),
        h("small", null, ""),
      );
      this.pad.push(btn);
      padRow.append(btn);
    }
    this.undoBtn = h("button", { class: "tool", onclick: () => this.undo() }, icon("urung"), h("span", null, "Urung"));
    const eraseBtn = h("button", { class: "tool", onclick: () => this.erase() }, icon("hapus"), h("span", null, "Hapus"));
    this.notesBtn = h("button", { class: "tool", onclick: () => this.toggleNotes() }, icon("catatan"), h("span", null, "Catatan"));
    this.hintCount = h("i", { class: "badge" }, "3");
    this.hintBtn = h("button", { class: "tool", onclick: () => this.hint() }, icon("petunjuk"), h("span", null, "Petunjuk"), this.hintCount);
    this.msg = h("div", { class: "msg hidden" });
    this.boardView = h(
      "div",
      { class: "board-view" },
      this.boardWrap,
      padRow,
      h("div", { class: "tools" }, this.undoBtn, eraseBtn, this.notesBtn, this.hintBtn),
      this.msg,
    );

    this.viewEl = h("div", { class: "view" }, this.boardView);
    this.widget = h("div", { class: "widget card", "data-hit": true }, this.mascot, header, this.viewEl);
    this.pillText = h("span", null, "");
    this.pill = h(
      "button",
      { class: "pill card hidden", "data-hit": true, title: "Buka Sudoku", onclick: () => this.setCollapsed(false) },
      icon("papan"),
      this.pillText,
    );
    this.toasts = h("div", { class: "toasts" });
    const dock = h("div", { class: "dock" }, this.toasts, this.widget, this.pill);
    this.root.append(dock);

    this.knownStars = game.totalStars();
    this.wire();
    this.applySettings();
    this.renderBoard();
    this.renderHeader();
    window.setInterval(() => this.tick(), 250);
    window.setInterval(() => this.animateMascot(), 90);
  }

  // -------------------------------------------------------------------------
  // Event

  private wire(): void {
    const g = this.game;
    g.on("board", () => this.renderBoard());
    g.on("select", () => this.renderBoard());
    g.on("mistake", ({ cell }) => {
      playSound("salah");
      this.setMood("kaget", 900);
      animate(this.cells[cell].el, "shake");
      this.renderHeader();
    });
    g.on("unit", ({ cells }) => {
      playSound("unit");
      this.setMood("senang", 1200);
      this.hop(400);
      const origin = g.selected ?? cells[0];
      for (const c of cells) {
        const dist = Math.abs(rowOf(c) - rowOf(origin)) + Math.abs(colOf(c) - colOf(origin));
        animate(this.cells[c].el, "flash", dist * 35);
      }
    });
    g.on("win", (w) => this.showWin(w));
    g.on("hint", (info) => {
      playSound("petunjuk");
      this.showMsg(info.reason);
      animate(this.cells[info.cell].el, "hinted");
    });
    g.on("level", () => {
      // Animasi lama tidak boleh terulang di papan baru.
      for (const c of this.cells) stopAnimation(c.el);
      this.msg.classList.add("hidden");
      this.closeOverlay();
      this.renderHeader();
      this.renderBoard();
      this.actions.save();
    });
    g.on("settings", () => this.applySettings());

    window.addEventListener("keydown", (e) => this.onKey(e));
    // Tombol tidak menyimpan fokus setelah diklik (Spasi/Enter tidak memicunya lagi).
    window.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement | null)?.closest("button");
      if (btn) btn.blur();
    });
    window.addEventListener("pointerdown", () => unlockAudio(), { capture: true, once: true });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.game.state.settings.collapsed) return;
    if (e.key === "Escape") {
      if (this.view !== "papan") this.show("papan");
      else this.game.select(null);
      return;
    }
    // Pintasan sistem (Ctrl/Cmd/Alt + huruf) bukan untuk permainan.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
    // Enter/Spasi tidak boleh "mengeklik ulang" tombol yang terakhir disentuh.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return;
    }
    if (this.view !== "papan" || this.overlay) return;
    const k = e.key;
    const handled = /^[1-9]$/.test(k) || ["Backspace", "Delete", "0", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "n", "N", "z", "Z", "h", "H"].includes(k);
    if (!handled) return;
    this.touch();
    if (/^[1-9]$/.test(k)) this.input(Number(k));
    else if (k === "Backspace" || k === "Delete" || k === "0") this.erase();
    else if (k === "ArrowUp") this.game.move(-1, 0);
    else if (k === "ArrowDown") this.game.move(1, 0);
    else if (k === "ArrowLeft") this.game.move(0, -1);
    else if (k === "ArrowRight") this.game.move(0, 1);
    else if (k === "n" || k === "N") this.toggleNotes();
    else if (k === "z" || k === "Z") this.undo();
    else if (k === "h" || k === "H") this.hint();
    else return;
    e.preventDefault();
  }

  /** Ada interaksi: waktu boleh berjalan. */
  private touch(): void {
    this.lastInteraction = Date.now();
    if (this.mood === "tidur") this.mood = "biasa";
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  // -------------------------------------------------------------------------
  // Aksi

  private input(d: number): void {
    this.touch();
    if (this.game.selected === null) {
      this.showMsg("Pilih sel dulu, lalu tekan angka.");
      return;
    }
    const res = this.game.input(d);
    if (res === "benar") {
      playSound("isi");
      this.hop(220);
    } else if (res === "catatan") playSound("catat");
    else if (res === "hapus") playSound("hapus");
    else if (res === "terkunci") playSound("klik");
    this.renderHeader();
  }

  private erase(): void {
    this.touch();
    if (this.game.erase() === "hapus") playSound("hapus");
  }

  private undo(): void {
    this.touch();
    if (this.game.undo()) playSound("hapus");
  }

  private toggleNotes(): void {
    this.touch();
    this.game.toggleNotes();
    playSound("klik");
  }

  private hint(): void {
    this.touch();
    if (this.game.hintsLeft() <= 0) {
      this.showMsg(`Petunjuk habis (maksimal ${MAX_HINTS} per level).`);
      return;
    }
    this.game.hint();
    this.renderHeader();
  }

  private setCollapsed(collapsed: boolean): void {
    playSound("klik");
    this.touch();
    this.game.updateSettings({ collapsed });
  }

  // -------------------------------------------------------------------------
  // Tampilan papan

  private renderBoard(): void {
    const g = this.game;
    const lv = g.levelDef;
    const cur = g.current;
    if (!lv || !cur) return;
    const sel = g.selected;
    const selVal = sel !== null ? g.value(sel) : 0;
    const highlight = g.state.settings.highlightSame;
    for (let i = 0; i < 81; i++) {
      const cell = this.cells[i];
      const v = g.value(i);
      const given = lv.puzzle[i] !== 0;
      const wrong = g.isWrong(i);
      const peer = sel !== null && i !== sel && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel));
      const cls = cell.el.classList;
      cls.toggle("given", given);
      cls.toggle("user", !given && v !== 0 && !wrong);
      cls.toggle("wrong", wrong);
      cls.toggle("sel", i === sel);
      cls.toggle("peer", peer);
      cls.toggle("same", highlight && selVal !== 0 && v === selVal && i !== sel);
      cell.value.textContent = v ? String(v) : "";
      const notes = v ? 0 : cur.notes[i];
      cls.toggle("has-notes", notes !== 0);
      for (let k = 0; k < 9; k++) {
        const on = (notes & (1 << k)) !== 0;
        cell.notes[k].classList.toggle("on", on);
        cell.notes[k].classList.toggle("same", on && highlight && selVal === k + 1);
      }
    }
    for (let d = 1; d <= 9; d++) {
      const left = g.remaining(d);
      const btn = this.pad[d - 1];
      btn.classList.toggle("done", left === 0);
      btn.lastElementChild!.textContent = left > 0 ? String(left) : "✓";
    }
    this.notesBtn.classList.toggle("on", g.notesMode);
    this.boardWrap.classList.toggle("notes-mode", g.notesMode);
    this.undoBtn.disabled = !g.canUndo();
    this.hintCount.textContent = String(g.hintsLeft());
    this.hintBtn.disabled = cur.done;
  }

  private renderHeader(): void {
    const g = this.game;
    const lv = g.levelDef;
    const cur = g.current;
    this.lvName.textContent = lv ? `Level ${lv.n}` : "Sudoku";
    this.lvBand.textContent = lv ? bandLabel(lv.band) : "";
    this.lvBtn.dataset.band = String(lv ? BANDS.indexOf(lv.band) : 0);
    clear(this.mistakesEl);
    this.mistakesEl.append(icon("salah", 2, "icon-sm"), String(cur?.mistakes ?? 0));
    this.updateTime();
  }

  private updateTime(): void {
    const cur = this.game.current;
    const ms = cur?.elapsedMs ?? 0;
    const show = this.game.state.settings.showTimer;
    this.timeEl.classList.toggle("hidden", !show);
    this.timeEl.textContent = formatTime(ms);
    this.timeEl.classList.toggle("paused", !this.running());
    this.pillText.textContent = cur ? `Lv ${cur.level}${show ? ` · ${formatTime(ms)}` : ""}${cur.done ? " ✓" : ""}` : "Sudoku";
  }

  private running(): boolean {
    const cur = this.game.current;
    return (
      !!cur &&
      !cur.done &&
      this.visible &&
      !this.game.state.settings.collapsed &&
      this.view === "papan" &&
      Date.now() - this.lastInteraction < IDLE_PAUSE_MS
    );
  }

  private lastTick = Date.now();

  private tick(): void {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.running()) this.game.tick(dt);
    this.updateTime();
  }

  // -------------------------------------------------------------------------
  // Maskot

  private setMood(mood: Mood, ms: number): void {
    this.mood = mood;
    this.moodUntil = Date.now() + ms;
  }

  private hop(ms: number): void {
    this.hopUntil = Date.now() + ms;
  }

  private animateMascot(): void {
    if (this.game.state.settings.collapsed || !this.visible) return;
    const now = Date.now();
    let mood = this.mood;
    if (now > this.moodUntil) {
      mood = now - this.lastInteraction > 120_000 ? "tidur" : "biasa";
      this.mood = mood;
    }
    if (mood === "biasa" && now >= this.nextBlink) {
      this.nextBlink = now + 2500 + Math.random() * 3500;
      this.setMood("kedip", 140);
      mood = "kedip";
    }
    let hop = 0;
    if (now < this.hopUntil) hop = Math.sin(((this.hopUntil - now) / 400) * Math.PI) * 4;
    if (this.overlay) hop = Math.abs(Math.sin(now / 160)) * 5;
    drawMascot(this.mascot, mood, Math.max(0, hop), mood === "tidur");
  }

  // -------------------------------------------------------------------------
  // Pesan, toast, menang

  private showMsg(text: string): void {
    this.msg.textContent = text;
    this.msg.classList.remove("hidden");
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.msg.classList.add("hidden"), 7000);
  }

  toast(text: string, ms = 4000): void {
    const el = h("div", { class: "card toast" }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add("hide");
      window.setTimeout(() => el.remove(), 300);
    }, ms);
  }

  private showWin(w: WinInfo): void {
    playSound("menang");
    this.setMood("senang", 4000);
    this.renderHeader();
    this.actions.save();
    const stars = h(
      "div",
      { class: "win-stars" },
      [1, 2, 3].map((n) => {
        const img = icon(n <= w.stars ? "bintang" : "bintangKosong", 4, "win-star");
        img.style.animationDelay = `${200 + n * 220}ms`;
        return img;
      }),
    );
    const next = w.level < LEVEL_COUNT ? w.level + 1 : null;
    const confetti = h(
      "div",
      { class: "confetti" },
      Array.from({ length: 26 }, (_, k) => {
        const s = h("i");
        s.style.left = `${(k * 37) % 100}%`;
        s.style.animationDelay = `${(k % 7) * 90}ms`;
        s.style.background = ["#f2c43a", "#e8913a", "#5b8fd6", "#6fae6a", "#e98aa9"][k % 5];
        return s;
      }),
    );
    this.overlay = h(
      "div",
      { class: "overlay" },
      confetti,
      h("div", { class: "win-title" }, w.level === LEVEL_COUNT ? "Semua level selesai!" : `Level ${w.level} selesai!`),
      stars,
      h("div", { class: "win-time" }, `Waktu ${formatTime(w.ms)}`, w.newBest ? h("b", { class: "best" }, " · Rekor baru!") : ` · Terbaik ${formatTime(w.bestMs)}`),
      w.stars < 3 ? h("div", { class: "note" }, "Tiga bintang: selesaikan tanpa salah dan tanpa petunjuk.") : null,
      h(
        "div",
        { class: "row center" },
        h("button", { class: "btn", onclick: () => this.game.restart() }, "Ulangi"),
        next
          ? h("button", { class: "btn btn-primary", onclick: () => this.startLevel(next) }, `Level ${next} →`)
          : h("button", { class: "btn btn-primary", onclick: () => this.show("level") }, "Lihat semua level"),
      ),
    );
    this.boardWrap.append(this.overlay);
    const before = this.knownStars;
    const after = this.game.totalStars();
    for (const [theme, need] of Object.entries(THEME_UNLOCK) as [ThemeId, number][]) {
      if (need > 0 && before < need && after >= need) this.toast(`Tema ${THEME_NAMES[theme]} terbuka! Pilih di Pengaturan.`, 6000);
    }
    this.knownStars = after;
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private startLevel(n: number): void {
    playSound("buka");
    this.touch();
    if (this.game.start(n)) this.show("papan");
  }

  // -------------------------------------------------------------------------
  // Ganti tampilan

  private show(view: View): void {
    this.view = view;
    playSound("klik");
    clear(this.viewEl);
    if (view === "papan") this.viewEl.append(this.boardView);
    else if (view === "level") this.viewEl.append(this.levelView());
    else this.viewEl.append(this.settingsView());
    this.widget.dataset.view = view;
  }

  private levelView(): HTMLElement {
    const g = this.game;
    const total = g.totalStars();
    const grid = h("div", { class: "levels" });
    for (const lv of LEVELS) {
      const rec = g.record(lv.n);
      const locked = lv.n > g.state.unlocked;
      const playing = g.inProgress(lv.n);
      grid.append(
        h(
          "button",
          {
            class: `lv${locked ? " locked" : ""}${playing ? " playing" : ""}${rec.wins ? " won" : ""}`,
            "data-band": String(BANDS.indexOf(lv.band)),
            disabled: locked,
            title: locked
              ? `Level ${lv.n}: selesaikan level ${lv.n - 1} dulu`
              : `Level ${lv.n} · ${bandLabel(lv.band)} · ${lv.givens} angka awal\nTeknik tersulit: ${techniqueName(lv.technique)}${rec.bestMs ? `\nTerbaik ${formatTime(rec.bestMs)}` : ""}${playing ? "\nBelum selesai: lanjutkan dari terakhir" : ""}`,
            onclick: () => this.startLevel(lv.n),
          },
          locked ? icon("gembok", 2, "lv-lock") : h("b", null, String(lv.n)),
          h("span", { class: "lv-stars" }, "★".repeat(rec.stars) + "☆".repeat(rec.wins ? 3 - rec.stars : 0)),
        ),
      );
    }
    const cur = g.current;
    const legend = h(
      "div",
      { class: "legend" },
      BANDS.map((b, k) => {
        const first = LEVELS.find((l) => l.band === b)!.n;
        const last = [...LEVELS].reverse().find((l) => l.band === b)!.n;
        return h("span", { class: "chip", "data-band": String(k) }, `${first}-${last} ${bandLabel(b)}`);
      }),
    );
    return h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("b", null, "Pilih Level"),
        h("span", { class: "spacer" }),
        h("span", { class: "total-stars" }, icon("bintang", 1, "icon-sm"), ` ${total}/${LEVEL_COUNT * 3}`),
      ),
      grid,
      legend,
      cur && !cur.done && level(cur.level)
        ? h("button", { class: "btn small back", onclick: () => this.show("papan") }, `‹ Lanjutkan level ${cur.level}`)
        : null,
    );
  }

  private settingsView(): HTMLElement {
    const g = this.game;
    const s = g.state.settings;
    const stars = g.totalStars();
    const rerender = () => this.show("atur");
    const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) =>
      h(
        "label",
        { class: "toggle" },
        h("input", {
          type: "checkbox",
          checked: value,
          onchange: (e: Event) => {
            onChange((e.target as HTMLInputElement).checked);
            playSound("klik");
          },
        }),
        h("span", null, label),
      );
    const chips = <T extends string | number>(opts: { v: T; label: string }[], cur: T, pick: (v: T) => void) =>
      h(
        "div",
        { class: "chips" },
        opts.map((o) =>
          h(
            "button",
            {
              class: `chip${o.v === cur ? " active" : ""}`,
              onclick: () => {
                pick(o.v);
                rerender();
              },
            },
            o.label,
          ),
        ),
      );

    const themes = h(
      "div",
      { class: "themes" },
      (Object.keys(THEME_NAMES) as ThemeId[]).map((t) => {
        const open = stars >= THEME_UNLOCK[t];
        const [bg, ink, accent] = THEME_SWATCH[t];
        return h(
          "button",
          {
            class: `theme${s.theme === t ? " active" : ""}${open ? "" : " locked"}`,
            disabled: !open,
            title: open ? THEME_NAMES[t] : `Butuh ${THEME_UNLOCK[t]} bintang`,
            onclick: () => {
              g.updateSettings({ theme: t });
              rerender();
            },
          },
          h("span", { class: "swatch", style: { background: bg, borderColor: ink } }, h("i", { style: { background: accent } })),
          h("span", null, open ? THEME_NAMES[t] : `★${THEME_UNLOCK[t]}`),
        );
      }),
    );

    const vol = h("input", { type: "range", min: 0, max: 100, value: Math.round(s.volume * 100), class: "slider" }) as HTMLInputElement;
    vol.addEventListener("change", () => g.updateSettings({ volume: Number(vol.value) / 100 }));

    const st = g.state.stats;
    const solved = Object.values(g.state.records).filter((r) => r.wins > 0).length;
    const auto = this.actions.autostart();

    return h(
      "div",
      { class: "panel settings" },
      h("div", { class: "panel-head" }, h("b", null, "Pengaturan"), h("span", { class: "spacer" }), h("button", { class: "btn small", onclick: () => this.show("papan") }, "Kembali")),
      h("div", { class: "section-title" }, "Tema"),
      themes,
      h("div", { class: "section-title" }, "Bantuan"),
      toggle("Sorot angka yang sama", s.highlightSame, (v) => g.updateSettings({ highlightSame: v })),
      toggle("Hapus catatan otomatis", s.autoNotes, (v) => g.updateSettings({ autoNotes: v })),
      toggle("Tampilkan waktu", s.showTimer, (v) => g.updateSettings({ showTimer: v })),
      h("div", { class: "section-title" }, "Posisi dan ukuran"),
      chips(
        [
          { v: "kanan", label: "Kanan bawah" },
          { v: "kiri", label: "Kiri bawah" },
        ],
        s.corner,
        (v) => this.actions.setCorner(v as "kanan" | "kiri"),
      ),
      chips(
        [
          { v: 1, label: "Kecil" },
          { v: 1.15, label: "Sedang" },
          { v: 1.3, label: "Besar" },
        ],
        s.scale,
        (v) => g.updateSettings({ scale: v as 1 | 1.15 | 1.3 }),
      ),
      h("div", { class: "section-title" }, "Suara"),
      toggle("Efek suara", s.sound, (v) => g.updateSettings({ sound: v })),
      vol,
      auto !== null ? toggle("Jalankan saat komputer menyala", auto, (v) => this.actions.setAutostart(v)) : null,
      h("div", { class: "section-title" }, "Statistik"),
      h(
        "div",
        { class: "stats" },
        h("span", null, "Level selesai"),
        h("b", null, `${solved}/${LEVEL_COUNT}`),
        h("span", null, "Bintang"),
        h("b", null, `${stars}/${LEVEL_COUNT * 3}`),
        h("span", null, "Waktu bermain"),
        h("b", null, formatTime(st.playMs)),
        h("span", null, "Hari beruntun"),
        h("b", null, String(g.currentStreak())),
        h("span", null, "Kesalahan"),
        h("b", null, String(st.mistakes)),
        h("span", null, "Petunjuk dipakai"),
        h("b", null, String(st.hints)),
      ),
      h(
        "div",
        { class: "row center" },
        h(
          "button",
          {
            class: "btn small",
            onclick: (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              // Dua kali klik agar isian tidak hilang tanpa sengaja.
              if (btn.dataset.confirm !== "1") {
                btn.dataset.confirm = "1";
                btn.textContent = "Yakin? Klik lagi";
                return;
              }
              this.game.restart();
              this.show("papan");
            },
          },
          "Ulangi level ini",
        ),
        h("button", { class: "btn small", onclick: () => this.actions.hide() }, "Sembunyikan"),
        h("button", { class: "btn small btn-danger", onclick: () => this.actions.quit() }, "Keluar"),
      ),
      h("div", { class: "note center" }, "Munculkan lagi lewat ikon Sudoku Pojok di tray."),
    );
  }

  // -------------------------------------------------------------------------
  // Pengaturan tampilan

  private applySettings(): void {
    const s = this.game.state.settings;
    this.widget.dataset.theme = s.theme;
    this.pill.dataset.theme = s.theme;
    (this.widget.style as CSSStyleDeclaration & { zoom: string }).zoom = String(s.scale);
    this.root.classList.toggle("corner-kiri", s.corner === "kiri");
    this.widget.classList.toggle("hidden", s.collapsed);
    this.pill.classList.toggle("hidden", !s.collapsed);
    configureSound(s.sound, s.volume);
    this.renderBoard();
    this.updateTime();
  }

  /** Mulai permainan pertama kali, atau lanjutkan yang terakhir. */
  boot(): void {
    const g = this.game;
    const cur = g.current;
    if (!cur) g.start(g.nextLevel());
    else if (cur.done) g.start(g.nextLevel());
    else g.start(cur.level);
    // Waktu belum berjalan sampai pemain menyentuh papan; maskot tetap bangun dulu.
    this.lastInteraction = Date.now() - IDLE_PAUSE_MS;
  }
}
