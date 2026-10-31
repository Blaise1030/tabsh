//! `tabsh new` and `tabsh list`: a coding agent adds work to the board as
//! cards, and sees the cards there.

use super::daemon::{Env, request};
use crate::board::STATUSES;
use std::{io::Read, path::Path};

pub(super) const NEW_HELP: &str = "usage: tabsh new [options]

Adds a card to the tabsh board. With a prompt, the card runs an agent on it:
it waits in Backlog until the card is dragged to In progress, or starts at once
with --status in_progress. Prints the new card's id.

  --prompt <text>          the agent's first prompt
  --prompt-file <path|->   read the prompt from a file, or from stdin with -
  --name <title>           the card's title (default: the prompt's first line)
  --cwd <dir>              the card's folder (default: this one)
  --status <status>        backlog (default) or in_progress
  --fork                   start the card as a fork of this Claude Code conversation
                           (CLAUDE_CODE_SESSION_ID): it begins with this context
                           but runs as its own conversation
  --command <template>     the agent's launch command, {prompt} for the prompt
                           (default: claude {prompt}); {session} has tabsh name
                           the conversation
  --resume <template>      its resume command, {session} for the conversation
                           (default: claude --resume {session})
  --json                   print the card as JSON instead of its id

Hand a task to its own card, with this conversation's context:
  tabsh new --fork --name \"Write the release notes\" --prompt-file - <<'EOF'
  Write the release notes for the changes above. Only this task.
  EOF";

pub(super) const LIST_HELP: &str = "usage: tabsh list [--status <status>] [--json]

Lists the cards on the tabsh board: id, status and title, one a line.

  --status <status>   only cards in backlog, in_progress, needs_input,
                      completed or archived
  --json              print the cards as JSON";

/// The columns a new card can start in, as from the board's `+`.
const STARTS: [&str; 2] = ["backlog", "in_progress"];
/// Claude Code's resume command, as the New card dialog's default agent.
const RESUME: &str = "claude --resume {session}";

fn value(it: &mut std::slice::Iter<'_, String>, flag: &str) -> Result<String, String> {
    it.next()
        .cloned()
        .ok_or_else(|| format!("{flag} needs a value"))
}

/// Creates a card and returns its id (or, with `--json`, the card). `here`
/// is the caller's folder: the card's, unless `--cwd` says otherwise.
pub(super) fn new(
    args: &[String],
    env: &Env,
    stdin: &mut dyn Read,
    here: &Path,
) -> Result<String, String> {
    let (mut name, mut cwd, mut status) = (None, None, "backlog".to_owned());
    let (mut prompt, mut prompt_file, mut command, mut resume) = (None, None, None, None);
    let (mut fork, mut json) = (false, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--name" => name = Some(value(&mut it, a)?),
            "--cwd" => cwd = Some(value(&mut it, a)?),
            "--status" => status = value(&mut it, a)?,
            "--prompt" => prompt = Some(value(&mut it, a)?),
            "--prompt-file" => prompt_file = Some(value(&mut it, a)?),
            "--command" => command = Some(value(&mut it, a)?),
            "--resume" => resume = Some(value(&mut it, a)?),
            "--fork" => fork = true,
            "--json" => json = true,
            other => return Err(format!("unexpected argument '{other}'")),
        }
    }
    if !STARTS.contains(&status.as_str()) {
        return Err(format!(
            "--status takes backlog or in_progress (got '{status}')"
        ));
    }
    let prompt = match (prompt, prompt_file) {
        (Some(_), Some(_)) => return Err("give --prompt or --prompt-file, not both".into()),
        (p, None) => p,
        (None, Some(f)) => Some(read_prompt(&f, stdin)?),
    };
    if fork {
        if prompt.is_none() {
            return Err("--fork needs a prompt: the task the fork takes on".into());
        }
        if command.is_some() || resume.is_some() {
            return Err("--fork sets the card's --command and --resume itself".into());
        }
        let conversation = env.conversation.as_deref().ok_or(
            "--fork needs the calling agent's conversation (CLAUDE_CODE_SESSION_ID is not set)",
        )?;
        // It is typed into a shell: plain ids only.
        if !conversation
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!("odd CLAUDE_CODE_SESSION_ID '{conversation}'"));
        }
        command = Some(format!(
            "claude --resume {conversation} --fork-session --session-id {{session}} {{prompt}}"
        ));
    }
    let folder = cwd.map_or_else(|| here.to_path_buf(), |c| here.join(c));
    if !folder.is_dir() {
        return Err(format!("{} is not a folder", folder.display()));
    }
    let resume = resume.or_else(|| prompt.as_ref().map(|_| RESUME.to_owned()));
    let body = serde_json::json!({
        "cwd": folder.to_string_lossy(),
        "name": name,
        "prompt": prompt,
        "command": command,
        "resume": resume,
    })
    .to_string();
    let mut card = answer(request(env, "POST", "/api/sessions", Some(&body))?)?;
    if status == "in_progress" {
        // As a card made from In progress's `+`: the board's move, which
        // starts its agent.
        let id = card["id"].as_str().unwrap_or_default().to_owned();
        let body = serde_json::json!({"status": status, "source": "user"}).to_string();
        let path = format!("/api/sessions/{id}/status");
        card = answer(request(env, "PATCH", &path, Some(&body))?)?;
    }
    Ok(if json {
        card.to_string()
    } else {
        card["id"].as_str().unwrap_or_default().to_owned()
    })
}

fn read_prompt(file: &str, stdin: &mut dyn Read) -> Result<String, String> {
    let mut text = String::new();
    let read = if file == "-" {
        stdin.read_to_string(&mut text)
    } else {
        std::fs::File::open(file).and_then(|mut f| f.read_to_string(&mut text))
    };
    read.map_err(|e| format!("can't read the prompt from {file}: {e}"))?;
    Ok(text)
}

/// The cards on the board (side terminals left out), one a line or as JSON.
pub(super) fn list(args: &[String], env: &Env) -> Result<String, String> {
    let (mut status, mut json) = (None, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--status" => status = Some(value(&mut it, a)?),
            "--json" => json = true,
            other => return Err(format!("unexpected argument '{other}'")),
        }
    }
    if let Some(s) = status.as_deref()
        && !STATUSES.contains(&s)
    {
        return Err(format!(
            "unknown status '{s}' (use {})",
            STATUSES.join(", ")
        ));
    }
    let all = answer(request(env, "GET", "/api/sessions", None)?)?;
    let cards: Vec<&serde_json::Value> = all
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["parent"].is_null())
        .filter(|c| status.as_deref().is_none_or(|s| c["status"] == s))
        .collect();
    if json {
        return Ok(serde_json::to_string(&cards).unwrap_or_default());
    }
    Ok(cards
        .iter()
        .map(|c| {
            let text = |k: &str| c[k].as_str().unwrap_or_default().to_owned();
            format!("{}  {:<11}  {}", text("id"), text("status"), text("name"))
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

/// The JSON body of a 200, or what went wrong.
fn answer(a: super::daemon::Answer) -> Result<serde_json::Value, String> {
    match a.code {
        200 => serde_json::from_str(&a.body).map_err(|_| "the daemon sent an odd answer".into()),
        401 | 403 => Err("the daemon refused this tabsh's token".into()),
        code => Err(format!("the daemon answered {code}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppState, state::router, test_support::test_state};

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }
    fn env(url: &str, conversation: Option<&str>) -> Env {
        Env {
            session: None,
            url: url.into(),
            token: Some("t0k3n".into()),
            agent: None,
            conversation: conversation.map(String::from),
        }
    }
    fn here() -> std::path::PathBuf {
        // A real folder written without a trailing slash, as `$PWD` is.
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    async fn serve(st: &AppState) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = router(st.clone());
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
        });
        url
    }

    fn column(st: &AppState, id: &str, col: &str) -> Option<String> {
        st.db
            .lock()
            .unwrap()
            .query_row(
                &format!("SELECT {col} FROM sessions WHERE id = ?1"),
                [id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn new_refuses_conflicting_or_incomplete_flags() {
        let e = env("http://127.0.0.1:9", Some("c-1"));
        let new = |a: &[&str]| new(&args(a), &e, &mut &b""[..], &here());
        assert!(
            new(&["--prompt", "a", "--prompt-file", "-"])
                .unwrap_err()
                .contains("--prompt")
        );
        assert!(
            new(&["--status", "completed"])
                .unwrap_err()
                .contains("--status")
        );
        assert!(new(&["--fork"]).unwrap_err().contains("prompt"));
        assert!(
            new(&["--fork", "--prompt", "x", "--command", "codex {prompt}"])
                .unwrap_err()
                .contains("--command")
        );
        assert!(new(&["--name"]).unwrap_err().contains("--name"));
        assert!(new(&["--bogus"]).unwrap_err().contains("--bogus"));
        assert!(
            new(&["--cwd", "/no/such/folder"])
                .unwrap_err()
                .contains("/no/such/folder")
        );
    }

    #[test]
    fn fork_needs_the_callers_conversation() {
        let a = args(&["--fork", "--prompt", "x"]);
        let none = env("http://127.0.0.1:9", None);
        assert!(
            new(&a, &none, &mut &b""[..], &here())
                .unwrap_err()
                .contains("CLAUDE_CODE_SESSION_ID")
        );
        let odd = env("http://127.0.0.1:9", Some("x; rm -rf ~"));
        assert!(new(&a, &odd, &mut &b""[..], &here()).is_err());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn new_makes_a_backlog_card_with_the_prompt_from_stdin() {
        let st = test_state();
        let url = serve(&st).await;
        let prompt = "Fix \"login\" for $USER\nthen run the tests";
        let out = tokio::task::spawn_blocking(move || {
            new(
                &args(&["--name", "Fix login", "--prompt-file", "-"]),
                &env(&url, None),
                &mut prompt.as_bytes(),
                &here(),
            )
        })
        .await
        .unwrap()
        .unwrap();
        let id = out.trim();
        assert_eq!(column(&st, id, "status").as_deref(), Some("backlog"));
        assert_eq!(column(&st, id, "name").as_deref(), Some("Fix login"));
        assert_eq!(column(&st, id, "pending_prompt").as_deref(), Some(prompt));
        assert_eq!(
            column(&st, id, "cwd").as_deref(),
            here().to_str(),
            "the folder defaults to the caller's"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn new_can_start_the_card_at_once() {
        let st = test_state();
        let url = serve(&st).await;
        let out = tokio::task::spawn_blocking(move || {
            new(
                &args(&["--prompt", "go", "--status", "in_progress", "--json"]),
                &env(&url, None),
                &mut &b""[..],
                &here(),
            )
        })
        .await
        .unwrap()
        .unwrap();
        let card: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(card["status"], "in_progress");
        let id = card["id"].as_str().unwrap();
        assert_eq!(column(&st, id, "status").as_deref(), Some("in_progress"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_forked_card_resumes_the_callers_conversation_as_its_own() {
        let st = test_state();
        let url = serve(&st).await;
        let out = tokio::task::spawn_blocking(move || {
            new(
                &args(&["--fork", "--prompt", "task 2 only"]),
                &env(&url, Some("1d42c538-300f-4c81-a27b-e2c0e9c0dff9")),
                &mut &b""[..],
                &here(),
            )
        })
        .await
        .unwrap()
        .unwrap();
        let id = out.trim();
        assert_eq!(
            column(&st, id, "pending_command").as_deref(),
            Some(
                "claude --resume 1d42c538-300f-4c81-a27b-e2c0e9c0dff9 --fork-session \
                 --session-id {session} {prompt}"
            )
        );
        let session = column(&st, id, "agent_session").expect("tabsh names the fork");
        assert_eq!(
            column(&st, id, "resume_input"),
            Some(format!("claude --resume {session}\r")),
            "a restart resumes the fork, not the conversation it came from"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn list_shows_cards_by_status_without_side_terminals() {
        let st = test_state();
        let url = serve(&st).await;
        let (a, b) = {
            let db = st.db.lock().unwrap();
            let card = |name| {
                crate::sessions::store::insert_card(
                    &db,
                    &crate::sessions::store::NewCard {
                        name: Some(name),
                        ..Default::default()
                    },
                )
                .unwrap()
                .id
            };
            (card("Alpha"), card("Beta"))
        };
        st.db
            .lock()
            .unwrap()
            .execute(
                "UPDATE sessions SET status = 'completed' WHERE id = ?1",
                [&b],
            )
            .unwrap();
        crate::sessions::store::insert_card(
            &st.db.lock().unwrap(),
            &crate::sessions::store::NewCard {
                name: Some("Terminal 1"),
                parent: Some(&a),
                ..Default::default()
            },
        )
        .unwrap();
        let (all, done, json) = tokio::task::spawn_blocking(move || {
            let e = env(&url, None);
            (
                list(&[], &e).unwrap(),
                list(&args(&["--status", "completed"]), &e).unwrap(),
                list(&args(&["--json"]), &e).unwrap(),
            )
        })
        .await
        .unwrap();
        assert!(all.contains("Alpha") && all.contains("Beta"));
        assert!(!all.contains("Terminal 1"), "side terminals aren't cards");
        assert!(done.contains("Beta") && !done.contains("Alpha"));
        let cards: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(cards.len(), 2);
    }
}
