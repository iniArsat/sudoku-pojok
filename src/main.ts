// Titik masuk: inti permainan, widget, dan jembatan desktop.

import "./ui/style.css";
import { Game } from "./core/game";
import { AutoSaver, loadState } from "./core/save";
import { ClickThroughController, htmlHitTest } from "./platform/clickThrough";
import {
  createSaveBackend,
  dockWindow,
  getAutostart,
  hideWindow,
  isTauri,
  onQuitRequested,
  onVisibilityChanged,
  quitApp,
  setAutostart,
  setClickThrough,
} from "./platform/desktop";
import { App } from "./ui/app";

async function main(): Promise<void> {
  const backend = createSaveBackend();
  const { state, problem } = await loadState(backend, Date.now());
  const game = new Game(state);

  // Simpanan rusak diamankan dulu; bila gagal dibaca, jangan menimpa apa pun.
  let saveBlocked = problem === "gagal-baca" || problem === "versi-baru";
  if (problem === "rusak") {
    try {
      await backend.preserveBroken?.();
    } catch (err) {
      console.error("Gagal mengamankan simpanan rusak.", err);
      saveBlocked = true;
    }
  }
  const saver = new AutoSaver(saveBlocked ? { load: async () => null, save: async () => {} } : backend, () => game.state, 15_000);

  if (!isTauri) document.body.classList.add("browser");

  let autostart = await getAutostart();
  const app = new App(game, {
    setCorner: (corner) => {
      game.updateSettings({ corner });
      void dockWindow(corner);
    },
    hide: () => {
      void saver.saveNow();
      void hideWindow();
    },
    quit: async () => {
      await saver.saveNow();
      await quitApp();
    },
    autostart: () => autostart,
    setAutostart: (enabled) => {
      void setAutostart(enabled).then((v) => {
        // Bila gagal, pertahankan nilai lama (pilihan tidak hilang dari pengaturan).
        if (v !== null) autostart = v;
        else app.toast("Gagal mengubah pengaturan jalankan otomatis.");
      });
    },
    save: () => void saver.saveNow(),
  });
  app.boot();
  saver.start();
  game.on("settings", () => void saver.saveNow());

  if (problem === "versi-baru") {
    app.toast("Simpanan dibuat oleh versi Sudoku Pojok yang lebih baru. Pasang versi terbaru agar progres tidak hilang; untuk sementara progres tidak disimpan.", 15000);
  } else if (problem === "gagal-baca") {
    app.toast("Simpanan tidak bisa dibaca. Progres tidak disimpan dulu agar data lama aman. Coba buka ulang aplikasinya.", 15000);
  } else if (problem === "rusak") {
    app.toast(
      saveBlocked
        ? "Simpanan rusak dan tidak bisa diamankan. Progres tidak disimpan dulu."
        : "Simpanan lama rusak, jadi permainan dimulai dari awal. Salinannya disimpan sebagai save-rusak-*.json.",
      15000,
    );
  }

  const clickThrough = new ClickThroughController(htmlHitTest, () => {});
  clickThrough.start();

  await onVisibilityChanged((v) => {
    app.setVisible(v);
    if (v) clickThrough.reset();
    else void saver.saveNow();
  });
  await onQuitRequested(async () => {
    await saver.saveNow();
    await quitApp();
  });
  window.addEventListener("beforeunload", () => void saver.saveNow());
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  // Hanya saat pengembangan: akses dari konsol, misalnya sp.game.state.unlocked = 100.
  if (import.meta.env.DEV) Object.assign(window, { sp: { game, app } });

  await dockWindow(game.state.settings.corner);
  void setClickThrough(true);
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `Sudoku Pojok gagal dimulai: ${String(err)}`;
});
