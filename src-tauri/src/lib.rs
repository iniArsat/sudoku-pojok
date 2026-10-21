//! Sisi native Sudoku Pojok: jendela transparan di pojok layar, klik tembus, ikon
//! tray, penyembunyian otomatis saat ada aplikasi layar penuh, file simpanan, dan
//! jalankan saat komputer menyala.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const MAIN: &str = "main";
/// Ukuran bawaan jendela, piksel logis (kamar di pojok, sisanya ruang panel).
const DEFAULT_W: f64 = 470.0;
const DEFAULT_H: f64 = 760.0;

#[derive(Default)]
struct Visibility {
    /// Disembunyikan pengguna lewat tray atau tombol "Sembunyikan".
    user_hidden: AtomicBool,
    /// Disembunyikan otomatis karena ada aplikasi layar penuh.
    auto_hidden: AtomicBool,
    /// Pengguna menampilkan jendela saat aplikasi layar penuh aktif: jangan
    /// disembunyikan otomatis sampai keadaan layar penuh berakhir.
    forced_visible: AtomicBool,
}

type SharedVisibility = Arc<Visibility>;

/// Pojok tempat jendela ditempel; diingat agar tray/monitor baru memakai pojok yang sama.
#[derive(Clone, Copy)]
struct Dock {
    left: bool,
    width: f64,
    height: f64,
}

type SharedDock = Arc<Mutex<Dock>>;

#[derive(Serialize)]
struct CursorInfo {
    /// Posisi kursor relatif terhadap jendela, piksel logis (sama dengan koordinat CSS).
    x: f64,
    y: f64,
    inside: bool,
}

// ---------------------------------------------------------------------------
// Jendela

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// Tempelkan jendela ke pojok kanan bawah atau kiri bawah area kerja (di atas taskbar/Dock).
fn dock(window: &WebviewWindow, d: Dock) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(m) => m,
        None => match window.primary_monitor()? {
            Some(m) => m,
            None => return Ok(()),
        },
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let w = ((d.width * scale).round() as u32).min(area.size.width);
    let h = ((d.height * scale).round() as u32).min(area.size.height);
    window.set_size(PhysicalSize::new(w, h))?;
    let x = if d.left {
        area.position.x
    } else {
        area.position.x + area.size.width as i32 - w as i32
    };
    window.set_position(PhysicalPosition::new(x, area.position.y + area.size.height as i32 - h as i32))?;
    Ok(())
}

#[tauri::command]
fn dock_window(window: WebviewWindow, state: State<'_, SharedDock>, corner: String, width: f64, height: f64) -> Result<(), String> {
    let d = Dock {
        left: corner == "kiri",
        width: width.clamp(400.0, 2000.0),
        height: height.clamp(300.0, 2000.0),
    };
    *state.lock().unwrap_or_else(|e| e.into_inner()) = d;
    dock(&window, d).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    // Di Linux jendela yang belum tampil belum punya permukaan; abaikan dengan aman.
    if !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// Tampilkan jendela lalu pasang lagi klik tembus. Urutannya penting:
/// di Linux, klik tembus hanya bisa dipasang setelah jendela tampil.
fn show_window(window: &WebviewWindow) -> tauri::Result<()> {
    window.show()?;
    window.set_ignore_cursor_events(true)
}

#[tauri::command]
fn cursor_in_window(window: WebviewWindow) -> Result<CursorInfo, String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let pos = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let rx = cursor.x - pos.x as f64;
    let ry = cursor.y - pos.y as f64;
    let inside = rx >= 0.0 && ry >= 0.0 && rx < size.width as f64 && ry < size.height as f64;
    Ok(CursorInfo {
        x: rx / scale,
        y: ry / scale,
        inside,
    })
}

fn set_user_hidden(app: &AppHandle, vis: &Visibility, hidden: bool) {
    vis.user_hidden.store(hidden, Ordering::SeqCst);
    if !hidden {
        vis.auto_hidden.store(false, Ordering::SeqCst);
        vis.forced_visible.store(platform::fullscreen_app_active(), Ordering::SeqCst);
    }
    if let Some(w) = main_window(app) {
        if hidden {
            let _ = w.hide();
        } else {
            let d = *app.state::<SharedDock>().lock().unwrap_or_else(|e| e.into_inner());
            let _ = dock(&w, d);
            let _ = show_window(&w);
        }
    }
    let _ = app.emit("visibility-changed", !hidden);
}

fn toggle_visibility(app: &AppHandle) {
    let vis = app.state::<SharedVisibility>();
    let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    set_user_hidden(app, &vis, visible);
}

#[tauri::command]
fn window_visible(window: WebviewWindow) -> bool {
    window.is_visible().unwrap_or(true)
}

#[tauri::command]
fn hide_window(app: AppHandle, vis: State<'_, SharedVisibility>) {
    set_user_hidden(&app, &vis, true);
}

/// Munculkan lagi jendela yang disembunyikan pengguna.
#[tauri::command]
fn show_window_cmd(app: AppHandle, vis: State<'_, SharedVisibility>) {
    if vis.user_hidden.load(Ordering::SeqCst) {
        set_user_hidden(&app, &vis, false);
    }
}

/// Keluar dengan rapi; bila ada layanan sistem yang menahan proses (misalnya tray
/// tanpa DBus di Linux), proses dihentikan paksa setelah jeda singkat.
fn exit_app(app: &AppHandle) {
    app.exit(0);
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(1500));
        std::process::exit(0);
    });
}

/// Minta frontend menyimpan dulu; bila tidak menjawab dalam 2 detik, keluar tetap jalan.
fn request_quit(app: &AppHandle) {
    let _ = app.emit("request-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        exit_app(&handle);
    });
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    exit_app(&app);
}

// ---------------------------------------------------------------------------
// File simpanan: save.json + cadangan save.json.bak di folder data aplikasi.

fn save_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("save.json"))
}

fn read_if_exists(path: &PathBuf) -> Result<Option<String>, String> {
    // Byte yang bukan UTF-8 tidak dianggap gagal baca: halaman akan melihat isinya
    // rusak, mengamankan salinannya, lalu menyimpan ulang.
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn load_save(app: AppHandle) -> Result<Option<String>, String> {
    read_if_exists(&save_path(&app)?)
}

#[tauri::command]
fn load_backup(app: AppHandle) -> Result<Option<String>, String> {
    read_if_exists(&save_path(&app)?.with_extension("json.bak"))
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Simpanan yang tidak bisa dipakai disalin ke save-rusak-<waktu>.json (dan .bak)
/// sebelum permainan baru menyimpan di atasnya.
#[tauri::command]
fn preserve_broken_save(app: AppHandle) -> Result<(), String> {
    let path = save_path(&app)?;
    let stamp = now_ms() as u64;
    for (from, suffix) in [(path.clone(), "json"), (path.with_extension("json.bak"), "bak.json")] {
        if from.exists() {
            let to = path.with_file_name(format!("save-rusak-{stamp}.{suffix}"));
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn write_save(app: AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| format!("data simpanan tidak valid: {e}"))?;
    let path = save_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        // Pastikan isi benar-benar di disk sebelum menggantikan simpanan lama.
        file.sync_all().map_err(|e| e.to_string())?;
    }
    // Simpanan lama yang valid menjadi cadangan. Bila proses berhenti di antara dua
    // rename, load_save kosong dan frontend memakai cadangan.
    if let Ok(Some(old)) = read_if_exists(&path) {
        if serde_json::from_str::<serde_json::Value>(&old).is_ok() {
            std::fs::rename(&path, path.with_extension("json.bak")).map_err(|e| e.to_string())?;
        }
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Jalankan saat komputer menyala

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())?;
    Ok(launcher.is_enabled().unwrap_or(enabled))
}

// ---------------------------------------------------------------------------
// Deteksi aplikasi layar penuh (game, presentasi, video)

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    pub fn fullscreen_app_active() -> bool {
        let mut state: QUERY_USER_NOTIFICATION_STATE = 0;
        let hr = unsafe { SHQueryUserNotificationState(&mut state) };
        hr >= 0 && matches!(state, QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
    }
}

#[cfg(not(windows))]
mod platform {
    /// Belum diimplementasikan di macOS/Linux; jendela tetap tampil.
    pub fn fullscreen_app_active() -> bool {
        false
    }
}

fn spawn_fullscreen_watcher(app: AppHandle, vis: SharedVisibility) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1500));
        let Some(window) = main_window(&app) else { continue };
        let user_hidden = vis.user_hidden.load(Ordering::SeqCst);
        if platform::fullscreen_app_active() {
            let forced = vis.forced_visible.load(Ordering::SeqCst);
            if !user_hidden && !forced && !vis.auto_hidden.swap(true, Ordering::SeqCst) {
                let _ = window.hide();
                let _ = app.emit("visibility-changed", false);
            }
            continue;
        }
        vis.forced_visible.store(false, Ordering::SeqCst);
        if vis.auto_hidden.swap(false, Ordering::SeqCst) && !user_hidden {
            let _ = show_window(&window);
            let _ = app.emit("visibility-changed", true);
        }
    });
}

// ---------------------------------------------------------------------------
// Tray

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Tampilkan / sembunyikan", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Sudoku Pojok")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_visibility(app),
            "quit" => request_quit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let visibility: SharedVisibility = Arc::new(Visibility::default());
    let docked: SharedDock = Arc::new(Mutex::new(Dock {
        left: false,
        width: DEFAULT_W,
        height: DEFAULT_H,
    }));

    tauri::Builder::default()
        // Membuka aplikasi kedua kali cukup menampilkan jendela yang sudah ada.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let vis = app.state::<SharedVisibility>();
            set_user_hidden(app, &vis, false);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(visibility.clone())
        .manage(docked.clone())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_quit(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            dock_window,
            set_click_through,
            cursor_in_window,
            hide_window,
            show_window_cmd,
            window_visible,
            quit_app,
            load_save,
            load_backup,
            write_save,
            preserve_broken_save,
            get_autostart,
            set_autostart,
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app)?;
            if let Some(window) = app.get_webview_window(MAIN) {
                let d = *docked.lock().unwrap_or_else(|e| e.into_inner());
                dock(&window, d)?;
                show_window(&window)?;
            }
            spawn_fullscreen_watcher(app.handle().clone(), visibility.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("gagal menjalankan Sudoku Pojok");
}
