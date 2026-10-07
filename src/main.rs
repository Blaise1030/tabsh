mod auth;
mod board;
mod cli;
mod error;
mod files;
mod sessions;
mod settings;
mod state;
#[cfg(test)]
mod test_support;
mod upload;
mod web;

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex, atomic::Ordering},
};

use sessions::{FLUSH_INTERVAL, SHUTTING_DOWN, flush, open_db};
use state::{AppState, router};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = cli::run(&args) {
        std::process::exit(code);
    }
    daemon();
}

#[tokio::main]
async fn daemon() {
    let port = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("PORT").ok())
        .unwrap_or_else(|| "7681".into());
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let addr = format!("{host}:{port}");

    let db_path = std::env::var("TABSH_DB").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        // The project was called webterm; carry its state (sessions, token,
        // uploads) over so existing tabs and paired browsers keep working.
        let (old, new) = (format!("{home}/.webterm"), format!("{home}/.tabsh"));
        if !std::path::Path::new(&new).exists() && std::path::Path::new(&old).is_dir() {
            match std::fs::rename(&old, &new) {
                Ok(()) => println!("tabsh: moved {old} to {new}"),
                Err(e) => eprintln!("tabsh: could not move {old} to {new}: {e}"),
            }
        }
        format!("{new}/state.db")
    });
    let db = open_db(&db_path).unwrap_or_else(|e| panic!("failed to open {db_path}: {e}"));
    let token_path = std::path::Path::new(&db_path).with_file_name("token");
    let token = auth::load_or_create_token(&token_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", token_path.display()));
    let origins: Vec<String> = match std::env::var("TABSH_ORIGINS") {
        Ok(list) => list
            .split(',')
            .map(|o| o.trim().trim_end_matches('/').to_owned())
            .filter(|o| !o.is_empty())
            .collect(),
        Err(_) => web::guard::HOSTED_ORIGINS
            .iter()
            .map(|o| o.to_string())
            .collect(),
    };
    let app_url = origins.first().map(|origin| {
        let daemon = if host == "127.0.0.1" && port == "7681" {
            String::new()
        } else {
            format!("?daemon=http://{addr}")
        };
        format!("{origin}/app/{daemon}").into()
    });
    let self_url = self_url(&host, &port);
    let state = AppState {
        db: Arc::new(Mutex::new(db)),
        live: Default::default(),
        db_path: db_path.as_str().into(),
        started: std::time::Instant::now(),
        token: token.into(),
        origins: origins.into(),
        app_url,
        self_url: self_url.into(),
        events: tokio::sync::broadcast::channel(256).0,
    };

    let flusher = state.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(FLUSH_INTERVAL);
            flush(&flusher);
        }
    });

    let app = router(state.clone());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    println!("tabsh listening on http://{addr} (state: {db_path})");
    let local_host = match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() || ip.is_unspecified() => web::guard::LOCAL_NAME.into(),
        _ => host.clone(),
    };
    let local_url = format!("http://{local_host}:{port}/app/#token={}", state.token);
    let open_url = match &state.app_url {
        Some(app_url) => {
            let url = format!("{app_url}#token={}", state.token);
            println!("open the app: {url}");
            println!("  or, in Safari: {local_url}");
            url
        }
        None => {
            println!("open the app: {local_url}");
            local_url
        }
    };
    web::pages::open_browser(&open_url);

    tokio::select! {
        res = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()) => res.unwrap(),
        _ = shutdown_signal() => {
            SHUTTING_DOWN.store(true, Ordering::SeqCst);
            flush(&state);
            println!("tabsh: state saved, exiting");
            std::process::exit(0);
        }
    }
}

async fn shutdown_signal() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

/// Where shells (and `tabsh status`) reach the daemon: loopback when it
/// listens on every interface, and IPv6 literals in brackets.
fn self_url(host: &str, port: &str) -> String {
    let host = match host {
        "0.0.0.0" | "::" => "127.0.0.1",
        h => h,
    };
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

#[cfg(test)]
mod self_url_tests {
    use super::self_url;

    #[test]
    fn shells_reach_the_daemon_on_loopback() {
        assert_eq!(self_url("127.0.0.1", "7681"), "http://127.0.0.1:7681");
        assert_eq!(self_url("0.0.0.0", "7681"), "http://127.0.0.1:7681");
        assert_eq!(self_url("::", "7681"), "http://127.0.0.1:7681");
        assert_eq!(self_url("::1", "7681"), "http://[::1]:7681");
        assert_eq!(self_url("example.test", "1"), "http://example.test:1");
    }
}
