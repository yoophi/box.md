use crate::{
    domain::{document::DocumentError, history::HistoryEntry},
    ports::document_history::DocumentHistory,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub struct GitDocumentHistory {
    root: PathBuf,
}

impl GitDocumentHistory {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn repository(&self, path: &str) -> PathBuf {
        self.root
            .join(format!("{:x}", Sha256::digest(path.as_bytes())))
    }
    fn git(&self, repo: &Path, args: &[&str]) -> Result<String, DocumentError> {
        let mut command = Command::new("git");
        command
            .current_dir(repo)
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "user.name=box.md",
                "-c",
                "user.email=history@box.md.local",
            ])
            .args(args);
        for variable in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            command.env_remove(variable);
        }
        let output = command.output().map_err(|e| {
            DocumentError::new("history", format!("Git 히스토리를 실행할 수 없습니다: {e}"))
        })?;
        if !output.status.success() {
            return Err(DocumentError::new(
                "history",
                String::from_utf8_lossy(&output.stderr).trim(),
            ));
        }
        String::from_utf8(output.stdout).map_err(|e| DocumentError::new("history", e.to_string()))
    }
}

impl DocumentHistory for GitDocumentHistory {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError> {
        let repo = self.repository(path);
        fs::create_dir_all(&repo).map_err(|e| DocumentError::new("history", e.to_string()))?;
        if !repo.join(".git").exists() {
            self.git(&repo, &["-c", "init.defaultBranch=main", "init", "--quiet"])?;
        }
        if self.git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok()
            && self.git(&repo, &["show", "HEAD:document.md"])? == content
        {
            return Ok(());
        }
        fs::write(repo.join("document.md"), content)
            .map_err(|e| DocumentError::new("history", e.to_string()))?;
        self.git(&repo, &["add", "--", "document.md"])?;
        self.git(
            &repo,
            &[
                "commit",
                "--quiet",
                "--only",
                "-m",
                "Save document",
                "--",
                "document.md",
            ],
        )?;
        Ok(())
    }
    fn list(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        let repo = self.repository(path);
        if !repo.join(".git").exists() {
            return Ok(Vec::new());
        }
        if self.git(&repo, &["rev-parse", "--verify", "HEAD"]).is_err() {
            return Ok(Vec::new());
        }
        Ok(self
            .git(&repo, &["log", "--format=%H%x09%cI", "--", "document.md"])?
            .lines()
            .filter_map(|line| line.split_once('\t'))
            .map(|(id, saved_at)| HistoryEntry {
                id: id.into(),
                saved_at: saved_at.into(),
            })
            .collect())
    }
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        if id.len() != 40 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(DocumentError::new("history", "유효하지 않은 버전입니다."));
        }
        self.git(
            &self.repository(path),
            &["show", &format!("{id}:document.md")],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_distinct_versions_and_keeps_document_histories_separate() {
        let dir = tempfile::tempdir().unwrap();
        let history = GitDocumentHistory::new(dir.path().into());
        history
            .record("/a.md", "---\nsummary: 생각\n---\n첫 문서 🌱")
            .unwrap();
        history.record("/a.md", "두 번째").unwrap();
        history.record("/a.md", "두 번째").unwrap();
        history.record("/b.md", "별도 문서").unwrap();
        let versions = history.list("/a.md").unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(history.read("/a.md", &versions[0].id).unwrap(), "두 번째");
        assert_eq!(
            history.read("/a.md", &versions[1].id).unwrap(),
            "---\nsummary: 생각\n---\n첫 문서 🌱"
        );
        assert_eq!(history.list("/b.md").unwrap().len(), 1);
        assert!(history.list("/none.md").unwrap().is_empty());
        assert!(history.read("/a.md", "HEAD").is_err());
        let reopened = GitDocumentHistory::new(dir.path().into());
        assert_eq!(reopened.list("/a.md").unwrap().len(), 2);
    }
}
