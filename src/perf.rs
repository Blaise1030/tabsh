//! RAM and CPU for the daemon and each running session. A session's figure
//! includes the processes that shell has started, such as an agent. The
//! daemon's own figure is the daemon process alone, so those shells are
//! not counted twice.

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use axum::{Json, Router, extract::State, routing::get};
use serde::Serialize;

use crate::{AppState, sessions};

/// How long the two samples sit apart. CPU use is a rate, so one instant
/// is not a percentage.
const SAMPLE: Duration = Duration::from_millis(200);

#[derive(Clone, Copy)]
struct Snapshot {
    memory_bytes: u64,
    cpu_ns: u128,
}

struct GroupSample<'a> {
    name: &'a str,
    before: Vec<(u32, Snapshot)>,
    after: Vec<(u32, Snapshot)>,
}

#[derive(Serialize)]
struct Reading {
    memory_bytes: u64,
    cpu_percent: f64,
}

#[derive(Serialize)]
struct ProcessReading {
    name: String,
    memory_bytes: u64,
    cpu_percent: f64,
}

#[derive(Serialize)]
struct PerformanceReport {
    total: Reading,
    processes: Vec<ProcessReading>,
}

/// CPU use as a percent of one core. `cpu_ns` is time spent on CPU between
/// the samples; `wall_ns` is the time between them.
fn cpu_percent(cpu_ns: u128, wall_ns: u128) -> Option<f64> {
    if wall_ns == 0 {
        return None;
    }
    Some(cpu_ns as f64 / wall_ns as f64 * 100.0)
}

/// Resident memory from the later sample, and CPU time only for processes
/// present both times. One that appeared in between would otherwise look
/// as if it had used its whole lifetime during the window.
fn usage(before: &[(u32, Snapshot)], after: &[(u32, Snapshot)]) -> (u64, u128) {
    let prior: HashMap<u32, u128> = before
        .iter()
        .map(|(pid, snap)| (*pid, snap.cpu_ns))
        .collect();
    let mut memory = 0u64;
    let mut cpu = 0u128;
    for (pid, snap) in after {
        memory = memory.saturating_add(snap.memory_bytes);
        if let Some(then) = prior.get(pid) {
            cpu = cpu.saturating_add(snap.cpu_ns.saturating_sub(*then));
        }
    }
    (memory, cpu)
}

fn report(groups: &[GroupSample<'_>], wall_ns: u128) -> PerformanceReport {
    let mut processes = Vec::new();
    let mut memory = 0u64;
    let mut cpu = 0u128;
    for group in groups {
        if group.after.is_empty() {
            continue;
        }
        let (group_memory, group_cpu) = usage(&group.before, &group.after);
        memory = memory.saturating_add(group_memory);
        cpu = cpu.saturating_add(group_cpu);
        processes.push(ProcessReading {
            name: group.name.to_owned(),
            memory_bytes: group_memory,
            cpu_percent: cpu_percent(group_cpu, wall_ns).unwrap_or(0.0),
        });
    }
    PerformanceReport {
        total: Reading {
            memory_bytes: memory,
            cpu_percent: cpu_percent(cpu, wall_ns).unwrap_or(0.0),
        },
        processes,
    }
}

/// `utime`, `stime` and resident pages from `/proc/<pid>/stat`. The name
/// sits in parentheses and may contain spaces, so the fields start after
/// its last `)`.
#[cfg(any(test, target_os = "linux"))]
fn parse_proc_stat(text: &str) -> Option<(u64, u64)> {
    let end = text.rfind(')')?;
    let fields: Vec<&str> = text[end + 1..].split_whitespace().collect();
    if fields.len() < 22 {
        return None;
    }
    let utime: u64 = fields[11].parse().ok()?;
    let stime: u64 = fields[12].parse().ok()?;
    let rss: u64 = fields[21].parse().ok()?;
    Some((utime.saturating_add(stime), rss))
}

#[cfg(any(test, target_os = "linux"))]
fn parse_child_pids(text: &str) -> Vec<u32> {
    text.split_whitespace()
        .filter_map(|s| s.parse().ok())
        .collect()
}

fn process_tree(root: u32) -> Vec<u32> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        out.push(pid);
        if seen.len() >= 512 {
            break;
        }
        stack.extend(children(pid));
    }
    out
}

#[cfg(target_os = "linux")]
fn children(pid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) else {
        return out;
    };
    for task in tasks.flatten() {
        let Ok(text) = std::fs::read_to_string(task.path().join("children")) else {
            continue;
        };
        out.extend(parse_child_pids(&text));
    }
    out
}

#[cfg(target_os = "macos")]
fn children(pid: u32) -> Vec<u32> {
    let count = unsafe { libc::proc_listchildpids(pid as libc::pid_t, std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Vec::new();
    }
    let mut buf = vec![0 as libc::pid_t; count as usize];
    let wrote = unsafe {
        libc::proc_listchildpids(
            pid as libc::pid_t,
            buf.as_mut_ptr().cast(),
            (buf.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    if wrote <= 0 {
        return Vec::new();
    }
    buf.truncate((wrote as usize).min(buf.len()));
    buf.into_iter()
        .filter(|pid| *pid > 0)
        .map(|pid| pid as u32)
        .collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn children(_pid: u32) -> Vec<u32> {
    Vec::new()
}

#[cfg(target_os = "linux")]
fn read_process(pid: u32) -> Option<Snapshot> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (ticks, pages) = parse_proc_stat(&text)?;
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if page <= 0 || hz <= 0 {
        return None;
    }
    Some(Snapshot {
        memory_bytes: pages.saturating_mul(page as u64),
        cpu_ns: ticks as u128 * 1_000_000_000 / hz as u128,
    })
}

#[cfg(target_os = "macos")]
fn read_process(pid: u32) -> Option<Snapshot> {
    let mut info: libc::rusage_info_v0 = unsafe { std::mem::zeroed() };
    let rc = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V0,
            &mut info as *mut libc::rusage_info_v0 as *mut libc::rusage_info_t,
        )
    };
    if rc != 0 {
        return None;
    }
    Some(Snapshot {
        memory_bytes: info.ri_resident_size,
        cpu_ns: u128::from(info.ri_user_time.saturating_add(info.ri_system_time)),
    })
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_process(_pid: u32) -> Option<Snapshot> {
    None
}

fn sample(pid: u32, tree: bool) -> Vec<(u32, Snapshot)> {
    let pids = if tree { process_tree(pid) } else { vec![pid] };
    pids.into_iter()
        .filter_map(|pid| read_process(pid).map(|snap| (pid, snap)))
        .collect()
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route("/api/performance", get(performance))
}

async fn performance(State(st): State<AppState>) -> Json<PerformanceReport> {
    let mut roots = vec![("tabsh".to_owned(), std::process::id(), false)];
    roots.extend(
        sessions::running_shells(&st)
            .into_iter()
            .map(|(name, pid)| (name, pid, true)),
    );
    let before: Vec<Vec<(u32, Snapshot)>> = roots
        .iter()
        .map(|(_, pid, tree)| sample(*pid, *tree))
        .collect();
    let started = std::time::Instant::now();
    tokio::time::sleep(SAMPLE).await;
    let wall_ns = started.elapsed().as_nanos();
    let after: Vec<Vec<(u32, Snapshot)>> = roots
        .iter()
        .map(|(_, pid, tree)| sample(*pid, *tree))
        .collect();
    let groups: Vec<GroupSample<'_>> = roots
        .iter()
        .enumerate()
        .map(|(i, (name, _, _))| GroupSample {
            name,
            before: before[i].clone(),
            after: after[i].clone(),
        })
        .collect();
    Json(report(&groups, wall_ns))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_between_samples_ignores_a_process_that_appeared_midway() {
        let before = [(
            1,
            Snapshot {
                memory_bytes: 10,
                cpu_ns: 1_000,
            },
        )];
        let after = [
            (
                1,
                Snapshot {
                    memory_bytes: 100,
                    cpu_ns: 1_500,
                },
            ),
            (
                2,
                Snapshot {
                    memory_bytes: 50,
                    cpu_ns: 9_000,
                },
            ),
        ];
        let (memory, cpu) = usage(&before, &after);
        assert_eq!(memory, 150);
        assert_eq!(cpu, 500);
        assert_eq!(cpu_percent(cpu, 1_000), Some(50.0));
    }

    #[test]
    fn cpu_percent_is_none_without_a_window() {
        assert_eq!(cpu_percent(10, 0), None);
    }

    #[test]
    fn linux_stat_reads_cpu_and_rss_past_a_name_with_spaces() {
        let text = "42 (my proc) R 1 1 1 0 -1 0 10 0 0 0 100 50 0 0 20 0 1 0 0 0 12 0\n";
        assert_eq!(parse_proc_stat(text), Some((150, 12)));
    }

    #[test]
    fn child_pid_list_splits_on_whitespace() {
        assert_eq!(parse_child_pids("12 34\n"), vec![12, 34]);
    }

    #[test]
    fn report_sums_each_group_once() {
        let groups = [
            GroupSample {
                name: "tabsh",
                before: vec![(
                    1,
                    Snapshot {
                        memory_bytes: 1000,
                        cpu_ns: 0,
                    },
                )],
                after: vec![(
                    1,
                    Snapshot {
                        memory_bytes: 2000,
                        cpu_ns: 100,
                    },
                )],
            },
            GroupSample {
                name: "zsh",
                before: vec![(
                    2,
                    Snapshot {
                        memory_bytes: 0,
                        cpu_ns: 0,
                    },
                )],
                after: vec![(
                    2,
                    Snapshot {
                        memory_bytes: 500,
                        cpu_ns: 400,
                    },
                )],
            },
        ];
        let report = report(&groups, 1_000);
        assert_eq!(report.total.memory_bytes, 2500);
        assert_eq!(report.total.cpu_percent, 50.0);
        assert_eq!(report.processes[0].name, "tabsh");
        assert_eq!(report.processes[0].cpu_percent, 10.0);
        assert_eq!(report.processes[1].name, "zsh");
        assert_eq!(report.processes[1].cpu_percent, 40.0);
    }

    #[test]
    fn a_spawned_child_is_part_of_the_tree() {
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pids = process_tree(std::process::id());
        let id = child.id();
        let _ = child.kill();
        let _ = child.wait();
        assert!(pids.contains(&id), "tree {pids:?} missing {id}");
    }

    #[tokio::test]
    async fn performance_reports_the_daemon() {
        use tower::ServiceExt;

        let app = crate::state::router(crate::test_support::test_state());
        let req = axum::http::Request::builder()
            .uri("/api/performance?token=t0k3n")
            .header("Host", "127.0.0.1:7681")
            .header("Origin", "https://tabsh.cc")
            .body(axum::body::Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 64 * 1024)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            body["total"]["memory_bytes"].as_u64().unwrap() > 0,
            "{body}"
        );
        assert_eq!(body["processes"][0]["name"], "tabsh");
        assert!(body["total"]["cpu_percent"].as_f64().unwrap().is_finite());
    }
}
