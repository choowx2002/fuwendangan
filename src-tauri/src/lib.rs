// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::net::TcpStream;
use std::time::Duration;
use tauri::Emitter;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![greet, check_tts_connections, send_to_tts, start_tts_listener])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
