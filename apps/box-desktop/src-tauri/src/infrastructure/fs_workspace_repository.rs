use crate::{
    domain::{
        document::DocumentError,
        workspace::{WorkspaceDocument, WorkspaceSnapshot},
    },
    ports::workspace_repository::WorkspaceRepository,
};
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

pub struct FsWorkspaceRepository;
const MAX_ENTRIES: usize = 20_000;
fn visible(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || !entry.file_type().is_dir()
        || (!entry.file_name().to_string_lossy().starts_with('.')
            && !matches!(entry.file_name().to_str(), Some("node_modules" | "target")))
}
impl WorkspaceRepository for FsWorkspaceRepository {
    fn list(&self, path: &str) -> Result<WorkspaceSnapshot, DocumentError> {
        if !Path::new(path).is_absolute() {
            return Err(DocumentError::new(
                "invalidPath",
                "절대 경로의 작업 디렉터리를 선택해주세요.",
            ));
        }
        let root = Path::new(path)
            .canonicalize()
            .map_err(|e| DocumentError::new("io", e.to_string()))?;
        if !root.is_dir() {
            return Err(DocumentError::new("invalidPath", "폴더를 선택해주세요."));
        }
        let mut documents = Vec::new();
        let mut truncated = false;
        for (index, item) in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(visible)
            .enumerate()
        {
            if index >= MAX_ENTRIES {
                truncated = true;
                break;
            }
            let entry = item.map_err(|e| DocumentError::new("io", e.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown")
            }) {
                continue;
            }
            documents.push(WorkspaceDocument {
                path: path.to_string_lossy().into(),
                relative_path: path
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                name: entry.file_name().to_string_lossy().into(),
            });
        }
        documents.sort_by(|a, b| {
            a.relative_path
                .to_lowercase()
                .cmp(&b.relative_path.to_lowercase())
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok(WorkspaceSnapshot {
            path: root.to_string_lossy().into(),
            documents,
            truncated,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn lists_markdown_recursively_in_sorted_order() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("z.MD"), "z").unwrap();
        fs::write(dir.path().join("a.markdown"), "a").unwrap();
        fs::write(dir.path().join("notes/idea.mdown"), "idea").unwrap();
        fs::write(dir.path().join("image.png"), "image").unwrap();
        let result = FsWorkspaceRepository
            .list(dir.path().to_str().unwrap())
            .unwrap();
        assert_eq!(
            result
                .documents
                .iter()
                .map(|d| d.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.markdown", "notes/idea.mdown", "z.MD"]
        );
        assert!(!result.truncated);
    }
    #[test]
    fn ignores_dependency_build_and_hidden_directories() {
        let dir = tempfile::tempdir().unwrap();
        for name in [".git", "node_modules", "target"] {
            fs::create_dir(dir.path().join(name)).unwrap();
            fs::write(dir.path().join(name).join("hidden.md"), "x").unwrap();
        }
        fs::write(dir.path().join("visible.md"), "x").unwrap();
        assert_eq!(
            FsWorkspaceRepository
                .list(dir.path().to_str().unwrap())
                .unwrap()
                .documents
                .len(),
            1
        );
    }
    #[test]
    fn accepts_empty_workspace_and_rejects_file_as_root() {
        let dir = tempfile::tempdir().unwrap();
        assert!(FsWorkspaceRepository
            .list(dir.path().to_str().unwrap())
            .unwrap()
            .documents
            .is_empty());
        let path = dir.path().join("note.md");
        fs::write(&path, "x").unwrap();
        assert_eq!(
            FsWorkspaceRepository
                .list(path.to_str().unwrap())
                .unwrap_err()
                .code,
            "invalidPath"
        );
    }
    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks_outside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("outside")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            dir.path().join("secret.md"),
        )
        .unwrap();
        assert!(FsWorkspaceRepository
            .list(dir.path().to_str().unwrap())
            .unwrap()
            .documents
            .is_empty());
    }
}
