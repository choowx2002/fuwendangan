// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::net::TcpStream;
use std::time::Duration;
use tauri::Emitter;

use tauri::Manager;

/// 通过 ContentResolver 读写 content:// URI 的 SAF 插件句柄。
/// 仅在 Android 上存在；桌面端为 None。
struct SafState {
    #[cfg(target_os = "android")]
    handle: Option<tauri::plugin::PluginHandle<tauri::Wry>>,
    #[cfg(not(target_os = "android"))]
    _never: (),
}

fn is_content_uri(path: &str) -> bool {
    path.starts_with("content://")
}

#[tauri::command]
fn send_to_tts(message: String) -> Result<String, String> {
    use std::io::Write;
    use std::net::TcpStream;

    match TcpStream::connect("127.0.0.1:39999") {
        Ok(mut stream) => {
            stream.write_all(message.as_bytes()).unwrap();
            Ok("发送成功".into())
        }
        Err(e) => Err(format!("连接 TTS 失败: {}", e)),
    }
}

/// 检查单个端口连接（带超时和详细日志）
fn check_port(port: u16) -> Result<String, String> {
    println!("开始检查端口 {}...", port);
    let start = std::time::Instant::now();

    let address = format!("127.0.0.1:{}", port);
    println!("尝试连接: {}", address);

    let result = TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|e| format!("地址解析失败: {}", e))?,
        Duration::from_secs(3), // 3秒超时
    );

    let duration = start.elapsed();
    println!("端口 {} 检查完成，耗时: {:?}", port, duration);

    match result {
        Ok(_) => {
            println!("端口 {} 连接成功", port);
            Ok(format!("端口 {} 连接正常", port))
        }
        Err(e) => {
            println!("端口 {} 连接失败: {}", port, e);
            Err(format!("端口 {} 连接失败: {}", port, e))
        }
    }
}

/// 检查所有 TTS 端口
#[tauri::command(async)]
async fn check_tts_connections() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut results = serde_json::Map::new();

        results.insert(
            "send_port".into(),
            serde_json::Value::String(check_port(39999).unwrap_or_else(|e| e)),
        );
        results.insert(
            "receive_port".into(),
            serde_json::Value::String(check_port(39998).unwrap_or_else(|e| e)),
        );

        Ok(serde_json::Value::Object(results))
    })
    .await
    .map_err(|e| format!("线程错误: {}", e))? // <- 解包嵌套 Result
}

#[tauri::command]
fn start_tts_listener(window: tauri::Window) {
    std::thread::spawn(move || {
        use std::io::Read;
        use std::net::TcpListener;

        if let Ok(listener) = TcpListener::bind("127.0.0.1:39998") {
            for stream in listener.incoming() {
                if let Ok(mut stream) = stream {
                    let mut buf = String::new();
                    if stream.read_to_string(&mut buf).is_ok() {
                        // 向前端发送事件
                        let _ = window.emit("tts-message", buf);
                    }
                }
            }
        }
    });
}
/// 复制文件（用于数据库备份/恢复）
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
#[tauri::command(async)]
async fn copy_file(app: tauri::AppHandle, source: String, dest: String) -> Result<(), String> {
    // Android SAF：源或目标为 content:// URI 时走 ContentResolver
    #[cfg(target_os = "android")]
    {
        match (is_content_uri(&source), is_content_uri(&dest)) {
            (false, true) => {
                let bytes = tauri::async_runtime::spawn_blocking({
                    let source = source.clone();
                    move || {
                        std::fs::read(&source)
                            .map_err(|e| format!("读取文件失败 ({}): {}", source, e))
                    }
                })
                .await
                .map_err(|e| format!("线程错误: {}", e))??;
                saf_write_bytes(&app, &dest, &bytes).await?;
                return Ok(());
            }
            (true, false) => {
                let base64 = saf_read_bytes(&app, &source).await?;
                let bytes = base64_decode_standard(&base64)?;
                tauri::async_runtime::spawn_blocking(move || {
                    std::fs::write(&dest, &bytes)
                        .map_err(|e| format!("写入文件失败 ({}): {}", dest, e))
                })
                .await
                .map_err(|e| format!("线程错误: {}", e))??;
                return Ok(());
            }
            (true, true) => return Err("Android 上不支持源与目标均为 content URI 的复制".into()),
            (false, false) => {}
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::copy(&source, &dest)
            .map(|_| ())
            .map_err(|e| format!("复制文件失败 ({} -> {}): {}", source, dest, e))
    })
    .await
    .map_err(|e| format!("线程错误: {}", e))?
}

/// 写入文本文件（用于导出数据）
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
#[tauri::command(async)]
async fn write_text_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    if is_content_uri(&path) {
        #[cfg(target_os = "android")]
        {
            saf_write_bytes(&app, &path, content.as_bytes()).await
        }
        #[cfg(not(target_os = "android"))]
        {
            // content:// URI 仅在 Android 出现；在桌面端按普通路径处理
            tauri::async_runtime::spawn_blocking(move || {
                std::fs::write(&path, content)
                    .map_err(|e| format!("写入文件失败 ({}): {}", path, e))
            })
            .await
            .map_err(|e| format!("线程错误: {}", e))?
        }
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::write(&path, content).map_err(|e| format!("写入文件失败 ({}): {}", path, e))
        })
        .await
        .map_err(|e| format!("线程错误: {}", e))?
    }
}

/// 读取文本文件（用于导入数据）
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
#[tauri::command(async)]
async fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if is_content_uri(&path) {
        #[cfg(target_os = "android")]
        {
            let base64 = saf_read_bytes(&app, &path).await?;
            let bytes = base64_decode_standard(&base64)?;
            String::from_utf8(bytes).map_err(|e| format!("文本解码失败: {}", e))
        }
        #[cfg(not(target_os = "android"))]
        {
            tauri::async_runtime::spawn_blocking(move || {
                std::fs::read_to_string(&path)
                    .map_err(|e| format!("读取文件失败 ({}): {}", path, e))
            })
            .await
            .map_err(|e| format!("线程错误: {}", e))?
        }
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败 ({}): {}", path, e))
        })
        .await
        .map_err(|e| format!("线程错误: {}", e))?
    }
}

/// 读取图片文件，返回 base64（用于卡组图案的本地背景图）
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
#[tauri::command(async)]
async fn read_image_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if is_content_uri(&path) {
        #[cfg(target_os = "android")]
        {
            saf_read_bytes(&app, &path).await
        }
        #[cfg(not(target_os = "android"))]
        {
            tauri::async_runtime::spawn_blocking(move || {
                std::fs::read(&path)
                    .map(|bytes| {
                        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
                    })
                    .map_err(|e| format!("读取图片失败 ({}): {}", path, e))
            })
            .await
            .map_err(|e| format!("线程错误: {}", e))?
        }
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::read(&path)
                .map(|bytes| {
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
                })
                .map_err(|e| format!("读取图片失败 ({}): {}", path, e))
        })
        .await
        .map_err(|e| format!("线程错误: {}", e))?
    }
}

/// 通过 SAF 插件向 content:// URI 写入字节（仅 Android）
#[cfg(target_os = "android")]
async fn saf_write_bytes(app: &tauri::AppHandle, uri: &str, bytes: &[u8]) -> Result<(), String> {
    use serde_json::json;
    let state = app.state::<SafState>();
    let handle = state
        .handle
        .as_ref()
        .ok_or_else(|| "SAF 插件未初始化".to_string())?;
    let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    handle
        .run_mobile_plugin_async::<()>("writeBytes", json!({ "uri": uri, "content": base64 }))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 通过 SAF 插件从 content:// URI 读取字节并返回 base64（仅 Android）
#[cfg(target_os = "android")]
async fn saf_read_bytes(app: &tauri::AppHandle, uri: &str) -> Result<String, String> {
    use serde_json::json;
    let state = app.state::<SafState>();
    let handle = state
        .handle
        .as_ref()
        .ok_or_else(|| "SAF 插件未初始化".to_string())?;
    handle
        .run_mobile_plugin_async::<String>("readBytes", json!({ "uri": uri }))
        .await
        .map_err(|e| e.to_string())
}

/// 解码 STANDARD base64（兼容 Kotlin 侧 NO_WRAP 编码）
#[cfg(target_os = "android")]
fn base64_decode_standard(input: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, input)
        .map_err(|e| format!("base64 解码失败: {}", e))
}

/// SAF（Storage Access Framework）插件：Android 上注册 SAFPlugin（Kotlin）用于 content:// URI 读写。
/// 桌面端为空插件，仅用于保持 Builder 结构一致。
fn saf_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("saf")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.tian_yue.fuwendangan", "SAFPlugin")?;
                app.manage(SafState {
                    handle: Some(handle),
                });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(SafState { _never: () });
            }
            Ok(())
        })
        .build()
}

#[cfg(debug_assertions)]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::DEV_TOOLS | Flags::RELOAD | Flags::CONTEXT_MENU))
        .build()
}

#[cfg(not(debug_assertions))]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_prevent_default::init()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(prevent_default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(saf_plugin())
        .setup(|_app| {
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_tts_connections,
            send_to_tts,
            start_tts_listener,
            copy_file,
            write_text_file,
            read_text_file,
            read_image_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
