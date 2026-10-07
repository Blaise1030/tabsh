//! Subcommands on the daemon's binary: `tabsh status` (what a coding agent's
//! hooks run inside a tabsh terminal) and `tabsh setup` (the guide an agent
//! follows to wire its own hooks to it).

use std::io::IsTerminal;

mod setup;
mod status;

const USAGE: &str = "usage:
  tabsh [port]                         start the daemon (default port 7681)
  tabsh status <status> [--note <text>] [--if-not <status>] [--hook [<json>]]
                                       set this terminal's card status:
                                       backlog, in_progress, needs_input, completed, archived
  tabsh setup                          print the guide a coding agent follows to keep
                                       its card current (\"run `tabsh setup` and follow it\")";

/// Runs a subcommand and returns its exit code, or `None` when `args` (the
/// command line without the program name) means "start the daemon".
pub(crate) fn run(args: &[String]) -> Option<i32> {
    match args.first().map(String::as_str) {
        Some("status") => {
            // A hook's payload is piped in; a person at a prompt has none to
            // wait for, so never block reading a terminal.
            let mut stdin: Box<dyn std::io::Read> = if std::io::stdin().is_terminal() {
                Box::new(std::io::empty())
            } else {
                Box::new(std::io::stdin())
            };
            Some(status::run(
                &args[1..],
                &status::Env::from_process(),
                &mut stdin,
            ))
        }
        Some("setup") => Some(setup::run()),
        Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            Some(0)
        }
        _ => None,
    }
}
