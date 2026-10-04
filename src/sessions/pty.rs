//! Starting shells in PTYs and reading their output into the scrollback.

use super::{
    Event, Output, SCROLLBACK_BYTES, Session,
    modes::{ModeTracker, RESTORE_MARKER},
};
use crate::{AppState, error::BoxError};
use axum::body::Bytes;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use rusqlite::{OptionalExtension, params};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::broadcast;

/// Set once the daemon is exiting: shells dying because of that must not
/// count as the user closing them, so their rows are kept for next start.
pub(crate) static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "linux")]
pub(super) fn process_cwd(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()?
        .into_os_string()
        .into_string()
        .ok()
}

#[cfg(target_os = "macos")]
pub(super) fn process_cwd(pid: u32) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let n = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if n != size {
        return None;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr().cast()) };
    path.to_str().ok().map(String::from)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(super) fn process_cwd(_pid: u32) -> Option<String> {
    None
}

/// Return the running shell for `id`, starting it (in its saved cwd, with its
/// saved scrollback) if the session exists but isn't running yet.
pub(super) fn get_or_spawn(st: &AppState, id: &str) -> Result<Option<Arc<Session>>, BoxError> {
    let mut live = st.live.lock().unwrap();
    if let Some(s) = live.get(id) {
        return Ok(Some(s.clone()));
    }
    let row = st
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT cwd, scrollback FROM sessions WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Vec<u8>>(1)?)),
        )
        .optional()?;
    let Some((cwd, scrollback)) = row else {
        return Ok(None);
    };
    let session = spawn_session(st.clone(), id.to_owned(), cwd, scrollback)?;
    live.insert(id.to_owned(), session.clone());
    Ok(Some(session))
}

fn spawn_session(
    st: AppState,
    id: String,
    cwd: Option<String>,
    saved: Vec<u8>,
) -> Result<Arc<Session>, BoxError> {
    let pair = native_pty_system().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    let dir = cwd
        .filter(|d| std::path::Path::new(d).is_dir())
        .map(Into::into)
        .or_else(|| std::env::var_os("HOME"));
    if let Some(dir) = dir {
        cmd.cwd(dir);
    }
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;

    // PTY I/O is blocking, so it lives on dedicated threads.
    let (input, in_rx) = std::sync::mpsc::channel::<Bytes>();
    std::thread::spawn(move || {
        while let Ok(data) = in_rx.recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
        }
    });

    let mut scrollback = VecDeque::from(saved);
    if !scrollback.is_empty() {
        scrollback.extend(RESTORE_MARKER);
    }
    let (tx, _) = broadcast::channel(1024);
    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        input,
        killer: Mutex::new(child.clone_killer()),
        pid: child.process_id(),
        output: Mutex::new(Output {
            scrollback,
            trimmed_modes: ModeTracker::default(),
            tx,
            exited: false,
            dirty: false,
        }),
    });

    let s = session.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            let mut out = s.output.lock().unwrap();
            let out = &mut *out;
            out.scrollback.extend(&buf[..n]);
            let excess = out.scrollback.len().saturating_sub(SCROLLBACK_BYTES);
            out.trimmed_modes.feed(out.scrollback.drain(..excess));
            out.dirty = true;
            let _ = out
                .tx
                .send(Event::Output(Bytes::copy_from_slice(&buf[..n])));
        }
        // Shell exited (or was killed): reap it, tell clients, forget the session.
        let _ = child.wait();
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return;
        }
        let mut out = s.output.lock().unwrap();
        out.exited = true;
        let _ = out.tx.send(Event::Exit);
        drop(out);
        st.live.lock().unwrap().remove(&id);
        if let Err(e) = st
            .db
            .lock()
            .unwrap()
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])
        {
            eprintln!("failed to delete session {id}: {e}");
        }
    });

    Ok(session)
}
