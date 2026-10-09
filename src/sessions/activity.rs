//! A session's output as a cheap signal for pages whose tab is parked (no
//! socket): at most one "output" per window however much it prints, and a
//! "bell" at once for a BEL outside an escape string, as the page's
//! `bell-scan.ts` finds them.

use serde::Serialize;
use std::time::{Duration, Instant};

/// At most one output signal per session per this long.
pub(super) const WINDOW: Duration = Duration::from_secs(1);

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

/// One per session, owned by its reader thread (no lock).
#[derive(Debug, Default)]
pub(super) struct Throttle {
    esc: Scan,
    last: Option<Instant>,
}

impl Throttle {
    /// What this chunk signals, if anything: a bell always, output only
    /// once a window has passed since the last signal.
    pub(super) fn feed(&mut self, bytes: &[u8], now: Instant) -> Option<Activity> {
        let bell = self.scan(bytes);
        if bell {
            self.last = Some(now);
            return Some(Activity::Bell);
        }
        if self.last.is_some_and(|t| now.duration_since(t) < WINDOW) {
            return None;
        }
        self.last = Some(now);
        Some(Activity::Output)
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
                Scan::StrEscape => Scan::StrEscape,
            };
        }
        bell
    }
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
}
