mod auth;
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

#[tokio::main]
async fn main() {
    // `tabsh hook …` is the CLI an agent's hooks run (src/cli); anything
    // else — a port, or nothing at all — starts the daemon as before.
    let mut args = std::env::args().skip(1);
    let first = args.next();
    if first.as_deref() == Some("hook") {
        cli::hook::run(args.next().as_deref());
        return;
    }
    let port = first
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
    let token_path = auth::token_path(&db_path);
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
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    // What shells get as TABSH_URL: the address as actually bound (a port-0
    // daemon reports its real port), connectable even when every interface
    // was bound.
    let bound = listener.local_addr().unwrap();
    let url_ip = if bound.ip().is_unspecified() {
        std::net::IpAddr::from([127, 0, 0, 1])
    } else {
        bound.ip()
    };
    let state = AppState {
        db: Arc::new(Mutex::new(db)),
        live: Default::default(),
        db_path: db_path.as_str().into(),
        started: std::time::Instant::now(),
        token: token.into(),
        origins: origins.into(),
        app_url,
        url: format!("http://{url_ip}:{}/", bound.port()).into(),
    };

    let flusher = state.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(FLUSH_INTERVAL);
            flush(&flusher);
        }
    });

    let app = router(state.clone());

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
