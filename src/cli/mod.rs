//! Subcommands on the daemon's binary: `tabsh status` (what a coding agent's
//! hooks run inside a tabsh terminal), `tabsh new` and `tabsh list` (an agent
//! adding work to the board as cards) and `tabsh setup` (the guide an agent
//! follows to wire its own hooks to it).

use std::io::IsTerminal;

mod cards;
mod daemon;
mod setup;
mod status;

const USAGE: &str = "usage:
  tabsh [port]                         start the daemon (default port 7681)
  tabsh status <status> [--note <text>] [--if-not <status>] [--hook [<json>]]
                                       set this terminal's card status:
                                       backlog, in_progress, needs_input, completed, archived
  tabsh new [--prompt <text> | --prompt-file <path|->] [--name <title>] [--cwd <dir>]
            [--status backlog|in_progress] [--fork] [--json]
                                       add a card to the board (`tabsh new --help`)
  tabsh list [--status <status>] [--json]
                                       list the board's cards
  tabsh setup                          print the guide a coding agent follows to keep
                                       its card current (\"run `tabsh setup` and follow it\")
  tabsh --version                      print the version";

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
                &daemon::Env::from_process(),
                &mut stdin,
            ))
        }
        Some("new" | "list") if args[1..].iter().any(|a| a == "--help" || a == "-h") => {
            let help = if args[0] == "new" {
                cards::NEW_HELP
            } else {
                cards::LIST_HELP
            };
            println!("{help}");
            Some(0)
        }
        Some("new") => {
            let here = std::env::current_dir().unwrap_or_default();
            let env = daemon::Env::from_process();
            let out = cards::new(&args[1..], &env, &mut std::io::stdin(), &here);
            Some(report("new", out))
        }
        Some("list") => Some(report(
            "list",
            cards::list(&args[1..], &daemon::Env::from_process()),
        )),
        Some("setup") => Some(setup::run()),
        Some("--version" | "-V") => {
            println!("tabsh {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            Some(0)
        }
        _ => None,
    }
}

/// Prints a subcommand's output, or its error, and gives its exit code.
fn report(command: &str, out: Result<String, String>) -> i32 {
    match out {
        Ok(text) => {
            println!("{text}");
            0
        }
        Err(e) => {
            eprintln!("tabsh {command}: {e}");
            1
        }
    }
}
