//! `tabsh setup`: prints the guide a coding agent follows to keep its card on
//! the board current. tabsh never edits an agent's config itself: the agent
//! knows its own hooks better, and keeps knowing them when they change.

const GUIDE: &str = include_str!("setup.md");

/// The guide, with `{tabsh}` replaced by this binary, quoted for a shell.
pub(super) fn guide(exe: &str) -> String {
    let quoted = format!("'{}'", exe.replace('\'', r"'\''"));
    GUIDE.replace("{tabsh}", &quoted)
}

pub(super) fn run() -> i32 {
    // The installed binary's own path, so hooks work even where `tabsh`
    // isn't on the PATH the agent's hooks run with.
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "tabsh".into());
    print!("{}", guide(&exe));
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_guide_names_this_binary_and_the_whole_contract() {
        let g = guide("/opt/my tabsh/tabsh");
        assert!(!g.contains("{tabsh}"));
        assert!(g.contains("'/opt/my tabsh/tabsh' status in_progress --hook"));
        assert!(g.contains("'/opt/my tabsh/tabsh' status needs_input --hook --if-not completed"));
        assert!(g.contains(
            "status needs_input --hook --if-not completed --note 'Agent finished its turn'"
        ));
        assert!(g.contains("status completed --note '<one line: what you did>'"));

        // Test that paths with single quotes are escaped correctly for shell
        let g_quoted = guide("/opt/it's/tabsh");
        assert!(g_quoted.contains("'/opt/it'\\''s/tabsh' status in_progress --hook"));

        // Keywords must be present (case-insensitive except for TABSH_SESSION_ID)
        let g_lower = g.to_lowercase();
        for must_lower in ["back up", "merge", "undo"] {
            assert!(
                g_lower.contains(must_lower),
                "guide must mention {must_lower}"
            );
        }
        // TABSH_SESSION_ID must be exact case
        assert!(
            g.contains("TABSH_SESSION_ID"),
            "guide must mention TABSH_SESSION_ID"
        );
    }
}
