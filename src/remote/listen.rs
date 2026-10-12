//! The second listener: this machine's Tailscale address, the daemon's port.

use crate::AppState;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};

/// How often `keep_trying` looks again for an address.
const RETRY: Duration = if cfg!(test) {
    Duration::from_millis(50)
} else {
    Duration::from_secs(30)
};

/// The address of a Tailscale interface: `utunN` on macOS, `tailscale0` on
/// Linux, holding one of Tailscale's addresses (100.64.0.0/10).
pub(super) fn pick_tailscale(addrs: &[(String, Ipv4Addr)]) -> Option<Ipv4Addr> {
    addrs
        .iter()
        .find(|(name, ip)| {
            (name.starts_with("utun") || name == "tailscale0")
                && ip.octets()[0] == 100
                && (64..128).contains(&ip.octets()[1])
        })
        .map(|(_, ip)| *ip)
}

/// Every IPv4 address on this machine, with its interface's name.
fn interface_v4s() -> Vec<(String, Ipv4Addr)> {
    let mut found = Vec::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: `head` is a valid place for the list's start.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return found;
    }
    let mut node = head;
    while !node.is_null() {
        // SAFETY: `node` is in the list `getifaddrs` made, freed only below.
        let ifa = unsafe { &*node };
        node = ifa.ifa_next;
        if ifa.ifa_addr.is_null() {
            continue;
        }
        // SAFETY: `ifa_addr` is non-null, so it points to a `sockaddr`; one
        // of family `AF_INET` is a `sockaddr_in`; `ifa_name` is a C string.
        let (name, ip) = unsafe {
            if i32::from((*ifa.ifa_addr).sa_family) != libc::AF_INET {
                continue;
            }
            let sin = &*ifa.ifa_addr.cast::<libc::sockaddr_in>();
            let name = std::ffi::CStr::from_ptr(ifa.ifa_name).to_string_lossy();
            (
                name.into_owned(),
                Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr)),
            )
        };
        found.push((name, ip));
    }
    // SAFETY: `head` came from `getifaddrs` and nothing points into it now.
    unsafe { libc::freeifaddrs(head) };
    found
}

/// Where to listen for other devices: `TABSH_REMOTE_ADDRESS`, else this
/// machine's Tailscale address. An unspecified address (`0.0.0.0`, `::`) in
/// the variable is ignored: the listener never takes every interface. Tests never scan the interfaces: the
/// developer's machine may have a real Tailscale address.
pub(crate) fn address() -> Option<IpAddr> {
    let set = std::env::var("TABSH_REMOTE_ADDRESS")
        .ok()
        .and_then(|value| value.parse::<IpAddr>().ok())
        .filter(|ip| !ip.is_unspecified());
    if cfg!(test) {
        return set;
    }
    set.or_else(|| pick_tailscale(&interface_v4s()).map(IpAddr::V4))
}

/// Listens on `address()` at the daemon's port with the same router, once.
/// Always an address, never every interface.
pub(crate) async fn start(st: AppState) -> Result<SocketAddr, String> {
    if let Some(addr) = running(&st) {
        return Ok(addr);
    }
    let Some(ip) = address() else {
        return Err(failed(&st, "No Tailscale address".into()));
    };
    let listener = match tokio::net::TcpListener::bind((ip, st.port)).await {
        Ok(listener) => listener,
        // Another start won the bind.
        Err(e) => return running(&st).ok_or_else(|| failed(&st, e.to_string())),
    };
    let addr = listener
        .local_addr()
        .map_err(|e| failed(&st, e.to_string()))?;
    let app = crate::state::router(st.clone());
    // One look and one store under the lock: `stop` and another `start` can't
    // slip between them. Giving up drops `listener`, which closes it.
    let mut slot = st.remote.listener.lock().unwrap();
    if let Some(addr) = slot
        .as_ref()
        .filter(|(task, _)| !task.is_finished())
        .map(|(_, addr)| *addr)
    {
        return Ok(addr);
    }
    if !super::is_enabled(&st) {
        return Err("Sharing is off".into());
    }
    let task = tokio::spawn(async move {
        let app = app.into_make_service_with_connect_info::<SocketAddr>();
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("tabsh: sharing stopped: {e}");
        }
    });
    *slot = Some((task.abort_handle(), addr));
    drop(slot);
    *st.remote.error.lock().unwrap() = None;
    println!("tabsh sharing on http://{addr}");
    Ok(addr)
}

fn running(st: &AppState) -> Option<SocketAddr> {
    let slot = st.remote.listener.lock().unwrap();
    let (task, addr) = slot.as_ref()?;
    (!task.is_finished()).then_some(*addr)
}

/// Keeps why sharing could not start, for the settings to show.
fn failed(st: &AppState, why: String) -> String {
    *st.remote.error.lock().unwrap() = Some(why.clone());
    why
}

pub(crate) fn stop(st: &AppState) {
    if let Some((task, _)) = st.remote.listener.lock().unwrap().take() {
        task.abort();
    }
}

/// Starts now, and again every `RETRY` (Tailscale may come up later) until
/// it has, or sharing is off.
pub(crate) fn keep_trying(st: AppState) {
    tokio::spawn(async move {
        while super::is_enabled(&st) {
            if start(st.clone()).await.is_ok() {
                break;
            }
            tokio::time::sleep(RETRY).await;
        }
    });
}

#[cfg(test)]
// The ENV lock is held across awaits on purpose: it serialises the tests.
#[allow(clippy::await_holding_lock)]
mod tests {
    use super::*;
    use crate::remote::{is_enabled, set_enabled};
    use crate::test_support::{ENV, test_state};
    use std::{
        io::{Read, Write},
        net::TcpStream,
        sync::MutexGuard,
        time::{Duration, Instant},
    };

    const VAR: &str = "TABSH_REMOTE_ADDRESS";

    /// Owns `ENV` and `TABSH_REMOTE_ADDRESS` for one test: unset on entry
    /// and on exit, even when the test fails.
    struct Address(MutexGuard<'static, ()>);

    impl Address {
        fn unset() -> Self {
            let guard = Address(ENV.lock().unwrap_or_else(|e| e.into_inner()));
            // SAFETY: the ENV lock serialises every access to this variable.
            unsafe { std::env::remove_var(VAR) };
            guard
        }

        fn set(&self, value: &str) {
            // SAFETY: the ENV lock, held by `self`, serialises it.
            unsafe { std::env::set_var(VAR, value) };
        }
    }

    impl Drop for Address {
        fn drop(&mut self) {
            // SAFETY: the ENV lock, still held, serialises it.
            unsafe { std::env::remove_var(VAR) };
        }
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn listening(addr: SocketAddr) -> bool {
        TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
    }

    #[test]
    fn picks_only_tailscale_interfaces() {
        let a = |n: &str, ip: [u8; 4]| (n.to_string(), Ipv4Addr::from(ip));
        assert_eq!(
            pick_tailscale(&[a("en0", [100, 64, 1, 2]), a("utun4", [100, 86, 117, 9])]),
            Some(Ipv4Addr::new(100, 86, 117, 9))
        );
        assert_eq!(
            pick_tailscale(&[a("tailscale0", [100, 127, 255, 1])]),
            Some(Ipv4Addr::new(100, 127, 255, 1))
        );
        assert_eq!(pick_tailscale(&[a("en0", [100, 64, 1, 2])]), None);
        assert_eq!(
            pick_tailscale(&[a("utun3", [10, 0, 0, 1]), a("utun4", [100, 128, 0, 1])]),
            None
        );
        assert_eq!(pick_tailscale(&[a("utun3", [100, 63, 255, 255])]), None);
        assert_eq!(pick_tailscale(&[a("tailscale1", [100, 100, 1, 1])]), None);
        assert_eq!(pick_tailscale(&[a("tailscale-x", [100, 100, 1, 1])]), None);
    }

    #[test]
    fn the_interfaces_include_loopback() {
        assert!(
            interface_v4s()
                .iter()
                .any(|(_, ip)| *ip == Ipv4Addr::LOCALHOST)
        );
    }

    #[test]
    fn the_address_comes_from_the_environment_in_tests() {
        let env = Address::unset();
        assert_eq!(address(), None);
        env.set("127.0.0.1");
        assert_eq!(address(), Some(IpAddr::from([127, 0, 0, 1])));
        env.set("not an address");
        assert_eq!(address(), None);
        env.set("0.0.0.0");
        assert_eq!(address(), None);
        env.set("::");
        assert_eq!(address(), None);
    }

    #[tokio::test]
    async fn start_serves_and_stop_stops() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let mut st = test_state();
        st.port = free_port();
        set_enabled(&st, true).unwrap();

        let addr = start(st.clone()).await.unwrap();
        assert_eq!(addr, SocketAddr::from(([127, 0, 0, 1], st.port)));
        assert_eq!(start(st.clone()).await, Ok(addr), "already running");
        assert!(st.remote.error.lock().unwrap().is_none());

        // The router answers, with the peer address the guard needs. A
        // blocking client on its own thread, so the server task can run.
        let reply = tokio::task::spawn_blocking(move || {
            let mut conn = TcpStream::connect(addr).unwrap();
            conn.write_all(
                format!("GET /app/ HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .unwrap();
            let mut reply = String::new();
            conn.read_to_string(&mut reply).unwrap();
            reply
        })
        .await
        .unwrap();
        // 200: the guard answers 403 to a request without a peer address.
        assert!(reply.starts_with("HTTP/1.1 200 "), "{reply}");

        stop(&st);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!listening(addr));
        assert!(st.remote.listener.lock().unwrap().is_none());

        // And it can start again.
        assert_eq!(start(st.clone()).await, Ok(addr));
        stop(&st);
    }

    #[tokio::test]
    async fn start_waits_for_an_address() {
        let env = Address::unset();
        let mut st = test_state();
        st.port = free_port();
        set_enabled(&st, true).unwrap();

        assert_eq!(
            start(st.clone()).await,
            Err("No Tailscale address".to_string())
        );
        assert_eq!(
            st.remote.error.lock().unwrap().as_deref(),
            Some("No Tailscale address")
        );

        keep_trying(st.clone());
        tokio::time::sleep(RETRY * 2).await;
        assert!(st.remote.listener.lock().unwrap().is_none());

        env.set("127.0.0.1");
        let deadline = Instant::now() + Duration::from_secs(5);
        while st.remote.listener.lock().unwrap().is_none() {
            assert!(Instant::now() < deadline, "never started");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(listening(SocketAddr::from(([127, 0, 0, 1], st.port))));
        assert!(st.remote.error.lock().unwrap().is_none());
        stop(&st);
    }

    #[tokio::test]
    async fn a_bind_error_is_kept() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut st = test_state();
        st.port = taken.local_addr().unwrap().port();
        set_enabled(&st, true).unwrap();

        let err = start(st.clone()).await.unwrap_err();
        assert_eq!(st.remote.error.lock().unwrap().as_deref(), Some(&*err));
        assert!(st.remote.listener.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn keep_trying_gives_up_when_sharing_is_off() {
        let env = Address::unset();
        let mut st = test_state();
        st.port = free_port();
        assert!(!is_enabled(&st));

        keep_trying(st.clone());
        tokio::time::sleep(RETRY).await;
        env.set("127.0.0.1");
        tokio::time::sleep(RETRY * 3).await;
        assert!(st.remote.listener.lock().unwrap().is_none());
        assert!(!listening(SocketAddr::from(([127, 0, 0, 1], st.port))));
    }

    #[tokio::test]
    async fn start_does_not_listen_while_sharing_is_off() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let mut st = test_state();
        st.port = free_port();
        assert!(!is_enabled(&st));

        // Sharing was turned off before `start` reached the store.
        assert_eq!(start(st.clone()).await, Err("Sharing is off".to_string()));
        assert!(st.remote.listener.lock().unwrap().is_none());
        assert!(!listening(SocketAddr::from(([127, 0, 0, 1], st.port))));
    }

    #[tokio::test]
    async fn a_finished_listener_is_not_running() {
        let env = Address::unset();
        env.set("127.0.0.1");
        let mut st = test_state();
        st.port = free_port();
        set_enabled(&st, true).unwrap();

        let task = tokio::spawn(std::future::pending::<()>());
        let handle = task.abort_handle();
        task.abort();
        let _ = task.await;
        assert!(handle.is_finished());
        let stale = SocketAddr::from(([127, 0, 0, 1], 1));
        *st.remote.listener.lock().unwrap() = Some((handle, stale));
        assert_eq!(running(&st), None);

        // A start replaces it rather than trusting it.
        let addr = start(st.clone()).await.unwrap();
        assert_eq!(addr.port(), st.port);
        assert!(listening(addr));
        stop(&st);
    }
}
