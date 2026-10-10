//! A session's output as a cheap signal for pages whose tab is parked (no
//! socket): at most one "output" per window however much it prints (plus a
//! trailing one when the window held some back), and a "bell" for a BEL
//! outside an escape string, as the page's `bell-scan.ts` finds them, at
//! most one per bell window.

use crate::board::{ActivityEvent, BoardEvent};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

/// At most one output signal per session per this long.
pub(super) const WINDOW: Duration = Duration::from_secs(1);
/// At most one bell signal per session per this long: `yes $'\a'` must not
/// flood the events stream (pages that lag it lose status changes).
pub(super) const BELL_WINDOW: Duration = Duration::from_millis(250);

/// What a chunk of output tells a parked tab.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Activity {
    Output,
    Bell,
}

/// Escape state carried across chunks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Scan {
    #[default]
    Text,
    Escape,
    Str,
    StrEscape,
}

/// A session's signals: fed by its reader thread, swept by a timer.
#[derive(Debug)]
pub(super) struct Throttle {
    window: Duration,
    esc: Scan,
    output: Option<Instant>,
    bell: Option<Instant>,
    /// When the newest output that arrived inside the window, unsignalled, came.
    held: Option<Instant>,
    /// Its `Signals` is gone: the sweeper stops.
    closed: bool,
}

impl Default for Throttle {
    fn default() -> Self {
        Throttle::new(WINDOW)
    }
}

fn within(last: Option<Instant>, now: Instant, window: Duration) -> bool {
    last.is_some_and(|t| now.saturating_duration_since(t) < window)
}

impl Throttle {
    fn new(window: Duration) -> Self {
        Throttle {
            window,
            esc: Scan::default(),
            output: None,
            bell: None,
            held: None,
            closed: false,
        }
    }

    /// When the held-back output's trailing signal is due, if any is held.
    fn due(&self) -> Option<Instant> {
        self.held?;
        Some(self.output.map_or_else(Instant::now, |t| t + self.window))
    }

    /// Any held-back output, now, window or not: how long ago it came.
    fn flush(&mut self, now: Instant) -> Option<Duration> {
        let held = self.held.take()?;
        Some(now.saturating_duration_since(held))
    }

    /// What this chunk signals, if anything: a bell (outside the bell
    /// window), or output once a window has passed since the last signal.
    pub(super) fn feed(&mut self, bytes: &[u8], now: Instant) -> Option<Activity> {
        if self.scan(bytes) && !within(self.bell, now, BELL_WINDOW) {
            self.bell = Some(now);
            self.output = Some(now);
            self.held = None;
            return Some(Activity::Bell);
        }
        if within(self.output, now, self.window) {
            self.held = Some(now);
            return None;
        }
        self.output = Some(now);
        self.held = None;
        Some(Activity::Output)
    }

    /// The trailing output signal, once the window that held some back is
    /// over: how long ago the newest held-back output came.
    pub(super) fn tick(&mut self, now: Instant) -> Option<Duration> {
        let held = self.held?;
        if within(self.output, now, self.window) {
            return None;
        }
        self.output = Some(now);
        self.held = None;
        Some(now.saturating_duration_since(held))
    }

    /// Whether `bytes` hold a BEL outside an escape string (OSC, DCS, APC,
    /// PM, SOS), which BEL may terminate: shells set the title on every
    /// prompt. Same states as the page's `scanBell`.
    fn scan(&mut self, bytes: &[u8]) -> bool {
        let mut bell = false;
        for &b in bytes {
            if self.esc == Scan::StrEscape {
                // ESC \ ends the string; any other ESC aborts it.
                self.esc = if b == b'\\' { Scan::Text } else { Scan::Escape };
            }
            self.esc = match self.esc {
                Scan::Str => match b {
                    0x07 | 0x18 | 0x1a => Scan::Text,
                    0x1b => Scan::StrEscape,
                    _ => Scan::Str,
                },
                Scan::Escape => match b {
                    b']' | b'P' | b'_' | b'^' | b'X' => Scan::Str,
                    0x1b => Scan::Escape,
                    _ => Scan::Text,
                },
                Scan::Text => match b {
                    0x07 => {
                        bell = true;
                        Scan::Text
                    }
                    0x1b => Scan::Escape,
                    _ => Scan::Text,
                },
                // Resolved to Text or Escape just above.
                Scan::StrEscape => Scan::StrEscape,
            };
        }
        bell
    }
}

/// Publishes one session's signals on the board events stream. The reader
/// thread feeds it (under its own small lock, never the `output` one). A
/// sweeper thread sends trailing signals: parked while nothing is held, it
/// sleeps until the window ends once something is. Dropping this sends any
/// output still held (the shell exited) and stops the sweeper.
pub(super) struct Signals {
    throttle: Arc<Mutex<Throttle>>,
    sweeper: std::thread::Thread,
    events: broadcast::Sender<BoardEvent>,
    session: String,
}

impl Signals {
    pub(super) fn start(events: broadcast::Sender<BoardEvent>, session: String) -> Self {
        Signals::start_with(events, session, WINDOW)
    }

    fn start_with(
        events: broadcast::Sender<BoardEvent>,
        session: String,
        window: Duration,
    ) -> Self {
        let throttle = Arc::new(Mutex::new(Throttle::new(window)));
        let shared = throttle.clone();
        let (tx, id) = (events.clone(), session.clone());
        let sweeper = std::thread::spawn(move || {
            loop {
                let mut t = shared.lock().unwrap();
                if t.closed {
                    break;
                }
                if let Some(age) = t.tick(Instant::now()) {
                    drop(t);
                    send(&tx, &id, Activity::Output, age);
                    continue;
                }
                let due = t.due();
                drop(t);
                // Park/unpark is token-based: a feed (or drop) between the
                // check and here makes this return at once.
                match due {
                    None => std::thread::park(),
                    Some(at) => {
                        std::thread::park_timeout(at.saturating_duration_since(Instant::now()))
                    }
                }
            }
        })
        .thread()
        .clone();
        Signals {
            throttle,
            sweeper,
            events,
            session,
        }
    }

    pub(super) fn feed(&self, bytes: &[u8]) {
        let mut t = self.throttle.lock().unwrap();
        let was_held = t.held.is_some();
        let signal = t.feed(bytes, Instant::now());
        let wake = !was_held && t.held.is_some();
        drop(t);
        if wake {
            self.sweeper.unpark();
        }
        if let Some(activity) = signal {
            send(&self.events, &self.session, activity, Duration::ZERO);
        }
    }
}

impl Drop for Signals {
    fn drop(&mut self) {
        let mut t = self.throttle.lock().unwrap();
        t.closed = true;
        let held = t.flush(Instant::now());
        drop(t);
        self.sweeper.unpark();
        if let Some(age) = held {
            send(&self.events, &self.session, Activity::Output, age);
        }
    }
}

fn send(events: &broadcast::Sender<BoardEvent>, session: &str, activity: Activity, age: Duration) {
    let _ = events.send(BoardEvent::Activity(ActivityEvent {
        session: session.to_owned(),
        activity,
        age_ms: age.as_millis().try_into().unwrap_or(u64::MAX),
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn many_chunks_within_the_window_publish_one_output() {
        let mut t = Throttle::default();
        let now = Instant::now();
        let seen: Vec<_> = (0..1000)
            .filter_map(|i| t.feed(b"line of output\r\n", now + Duration::from_micros(i)))
            .collect();
        assert_eq!(seen, [Activity::Output]);
    }

    #[test]
    fn output_after_the_window_publishes_again() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"a", now), Some(Activity::Output));
        assert_eq!(t.feed(b"b", now + WINDOW / 2), None);
        assert_eq!(t.feed(b"c", now + WINDOW), Some(Activity::Output));
    }

    #[test]
    fn a_bare_bel_publishes_a_bell_at_once() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"a", now), Some(Activity::Output));
        assert_eq!(
            t.feed(b"done\x07\r\n", now + Duration::from_millis(1)),
            Some(Activity::Bell)
        );
    }

    #[test]
    fn a_bel_ending_an_osc_title_does_not_ring() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"\x1b]0;title\x07", now), Some(Activity::Output));
        let later = now + WINDOW;
        assert_eq!(t.feed(b"\x1b]0;ti", later), Some(Activity::Output));
        assert_eq!(t.feed(b"tle\x07$ ", later), None, "split across chunks");
    }

    #[test]
    fn a_bel_after_a_string_ended_by_st_rings() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"\x1b]0;title\x1b\\\x07", now), Some(Activity::Bell));
    }

    #[test]
    fn a_bel_after_a_plain_escape_rings() {
        let mut t = Throttle::default();
        assert_eq!(
            t.feed(b"\x1b[31mred\x1b[0m\x07", Instant::now()),
            Some(Activity::Bell)
        );
    }

    #[test]
    fn many_bell_chunks_within_the_bell_window_publish_one_bell() {
        let mut t = Throttle::default();
        let now = Instant::now();
        let seen: Vec<_> = (0..1000)
            .filter_map(|i| t.feed(b"\x07", now + Duration::from_micros(i)))
            .collect();
        assert_eq!(seen, [Activity::Bell]);
    }

    #[test]
    fn a_bell_after_the_bell_window_rings_again() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"\x07", now), Some(Activity::Bell));
        assert_eq!(t.feed(b"\x07", now + BELL_WINDOW / 2), None);
        assert_eq!(t.feed(b"\x07", now + BELL_WINDOW), Some(Activity::Bell));
    }

    #[test]
    fn a_throttled_bell_still_ends_as_trailing_output() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"\x07", now), Some(Activity::Bell));
        assert_eq!(t.feed(b"\x07", now + BELL_WINDOW / 2), None);
        assert!(t.tick(now + WINDOW).is_some(), "never vanishes");
    }

    #[test]
    fn output_held_back_by_the_window_gets_a_trailing_signal() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.feed(b"a", now), Some(Activity::Output));
        assert_eq!(t.feed(b"b", now + WINDOW / 4), None);
        assert_eq!(t.tick(now + WINDOW / 2), None, "the window isn't over");
        assert_eq!(
            t.tick(now + WINDOW),
            Some(WINDOW * 3 / 4),
            "how long ago the newest held-back output came"
        );
        assert_eq!(t.tick(now + WINDOW * 3), None, "once");
    }

    #[test]
    fn a_window_with_nothing_held_back_ends_quietly() {
        let mut t = Throttle::default();
        let now = Instant::now();
        assert_eq!(t.tick(now), None, "no output yet");
        assert_eq!(t.feed(b"a", now), Some(Activity::Output));
        assert_eq!(t.tick(now + WINDOW * 2), None);
    }

    fn next(rx: &mut broadcast::Receiver<BoardEvent>, within: Duration) -> Option<ActivityEvent> {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            match rx.try_recv() {
                Ok(BoardEvent::Activity(ev)) => return Some(ev),
                Ok(_) => {}
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
        None
    }

    /// A short window, so these tests don't wait a real second.
    const TEST_WINDOW: Duration = Duration::from_millis(100);

    #[test]
    fn signals_reach_the_events_stream_with_a_trailing_one() {
        let (tx, mut rx) = broadcast::channel(16);
        let signals = Signals::start_with(tx, "s1".into(), TEST_WINDOW);
        signals.feed(b"hello");
        signals.feed(b"more");
        let ev = next(&mut rx, Duration::from_secs(1)).expect("output at once");
        assert_eq!(
            (ev.session.as_str(), ev.activity, ev.age_ms),
            ("s1", Activity::Output, 0)
        );
        let ev = next(&mut rx, Duration::from_secs(2)).expect("a trailing output");
        assert_eq!(ev.activity, Activity::Output);
        assert!(ev.age_ms >= 50, "it came a while ago: {}", ev.age_ms);
        signals.feed(b"ding\x07");
        let ev = next(&mut rx, Duration::from_secs(1)).expect("a bell at once");
        assert_eq!(ev.activity, Activity::Bell);
    }

    #[test]
    fn idle_signals_send_nothing_until_output_is_held_again() {
        let (tx, mut rx) = broadcast::channel(16);
        let signals = Signals::start_with(tx, "s1".into(), TEST_WINDOW);
        signals.feed(b"a");
        assert_eq!(
            next(&mut rx, TEST_WINDOW).unwrap().activity,
            Activity::Output
        );
        assert!(next(&mut rx, TEST_WINDOW * 4).is_none(), "idle: nothing");
        signals.feed(b"b");
        signals.feed(b"c");
        assert_eq!(next(&mut rx, TEST_WINDOW).unwrap().age_ms, 0, "leading");
        let ev = next(&mut rx, Duration::from_secs(2)).expect("the sweeper woke");
        assert_eq!(ev.activity, Activity::Output);
    }

    #[test]
    fn output_held_when_the_shell_exits_is_sent_on_drop() {
        let (tx, mut rx) = broadcast::channel(16);
        let signals = Signals::start_with(tx, "s1".into(), Duration::from_secs(60));
        signals.feed(b"a");
        signals.feed(b"b");
        assert_eq!(rx.try_recv().ok().map(|_| ()), Some(()), "leading");
        assert!(rx.try_recv().is_err(), "held");
        drop(signals);
        match rx.try_recv() {
            Ok(BoardEvent::Activity(ev)) => assert_eq!(ev.activity, Activity::Output),
            other => panic!("expected the held output, got {other:?}"),
        }
    }
}
