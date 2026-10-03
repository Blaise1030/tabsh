//! Embeds the site's typing sound samples (web/public/sounds) so the daemon
//! can serve its own copy of the app with them, like the hosted site does.

use std::{fmt::Write, path::Path};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/public/sounds");
    println!("cargo:rerun-if-changed={}", root.display());

    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();

    let mut out = String::from("static SOUNDS: &[(&str, &[u8])] = &[\n");
    for path in &files {
        let name = path.strip_prefix(&root).unwrap().to_str().unwrap();
        writeln!(
            out,
            "    ({name:?}, include_bytes!({:?})),",
            path.to_str().unwrap()
        )
        .unwrap();
    }
    out.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("sounds.rs");
    std::fs::write(dest, out).unwrap();
}

fn collect(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
        let path = entry.unwrap().path();
        println!("cargo:rerun-if-changed={}", path.display());
        if path.is_dir() {
            collect(&path, files);
        } else {
            files.push(path);
        }
    }
}
