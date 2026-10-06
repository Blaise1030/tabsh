//! The explorer's listing: which directory a tab's tree is rooted at, and the
//! paths under it.

use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// More paths than this and the page is told to show a message, not a tree.
pub(super) const TREE_LIMIT_PATHS: usize = 20_000;

/// A tree's listing. Paths are relative to `root`, with `/` after directories.
#[derive(Debug, Serialize)]
pub(super) struct Tree {
    pub(super) root: String,
    pub(super) paths: Vec<String>,
    pub(super) truncated: bool,
}

/// The nearest ancestor of `cwd` (itself included) holding a `.git` entry (a
/// directory, or a file in a worktree), else `cwd`.
pub(super) fn tree_root(cwd: &Path) -> PathBuf {
    cwd.ancestors()
        .find(|dir| dir.join(".git").exists())
        .unwrap_or(cwd)
        .to_path_buf()
}

/// Lists everything under `root` that git wouldn't ignore (`.gitignore` is
/// honoured even outside a repo), dotfiles included, `.git/` never. Past
/// `limit` paths it stops and returns none, so the page never shows a partial
/// tree.
pub(super) fn list_tree(root: &Path, limit: usize) -> Tree {
    let walk = WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build();
    let mut paths = Vec::new();
    for entry in walk.flatten() {
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        if paths.len() == limit {
            paths.clear();
            return Tree {
                root: root.to_string_lossy().into_owned(),
                paths,
                truncated: true,
            };
        }
        let mut path = rel
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        if entry.file_type().is_some_and(|t| t.is_dir()) {
            path.push('/');
        }
        paths.push(path);
    }
    Tree {
        root: root.to_string_lossy().into_owned(),
        paths,
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::scratch;

    fn touch(dir: &Path, rel: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "").unwrap();
    }

    fn sorted(tree: &Tree) -> Vec<&str> {
        let mut paths: Vec<&str> = tree.paths.iter().map(String::as_str).collect();
        paths.sort_unstable();
        paths
    }

    #[test]
    fn root_is_the_nearest_ancestor_with_a_git_entry_else_the_cwd() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join("repo/.git")).unwrap();
        std::fs::create_dir_all(dir.join("repo/src/deep")).unwrap();
        assert_eq!(tree_root(&dir.join("repo/src/deep")), dir.join("repo"));
        assert_eq!(tree_root(&dir.join("repo")), dir.join("repo"));

        // A worktree's `.git` is a file; the nearest one wins over an outer repo.
        std::fs::create_dir_all(dir.join("repo/wt/sub")).unwrap();
        std::fs::write(dir.join("repo/wt/.git"), "gitdir: elsewhere").unwrap();
        assert_eq!(tree_root(&dir.join("repo/wt/sub")), dir.join("repo/wt"));

        std::fs::create_dir_all(dir.join("plain/a")).unwrap();
        assert_eq!(tree_root(&dir.join("plain/a")), dir.join("plain/a"));
    }

    #[test]
    fn lists_relative_paths_with_directories_marked_and_empty_ones_kept() {
        let dir = scratch();
        touch(&dir, "README.md");
        touch(&dir, "src/main.rs");
        touch(&dir, ".env.example");
        std::fs::create_dir(dir.join("docs")).unwrap();
        let tree = list_tree(&dir, TREE_LIMIT_PATHS);
        assert!(!tree.truncated);
        assert_eq!(tree.root, dir.to_string_lossy());
        assert_eq!(
            sorted(&tree),
            [".env.example", "README.md", "docs/", "src/", "src/main.rs"]
        );
    }

    #[test]
    fn respects_gitignore_with_or_without_git_and_never_lists_dot_git() {
        let dir = scratch();
        touch(&dir, ".gitignore");
        std::fs::write(dir.join(".gitignore"), "target/\n*.log\n").unwrap();
        touch(&dir, "target/junk.txt");
        touch(&dir, "run.log");
        touch(&dir, "keep.txt");
        // Not a repo: the ignore file still counts.
        assert_eq!(sorted(&list_tree(&dir, 100)), [".gitignore", "keep.txt"]);

        touch(&dir, ".git/HEAD");
        assert_eq!(sorted(&list_tree(&dir, 100)), [".gitignore", "keep.txt"]);
    }

    #[test]
    fn stops_at_the_cap_and_returns_no_partial_list() {
        let dir = scratch();
        for name in ["a", "b", "c"] {
            touch(&dir, name);
        }
        let at = list_tree(&dir, 3);
        assert!(!at.truncated);
        assert_eq!(at.paths.len(), 3);
        let over = list_tree(&dir, 2);
        assert!(over.truncated);
        assert!(over.paths.is_empty());
    }
}
