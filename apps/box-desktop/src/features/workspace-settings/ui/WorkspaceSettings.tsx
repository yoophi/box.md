import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@box/ui";
import { isDesktop } from "@/shared/lib/runtime";

interface Props {
  savedPath: string | null;
  activePath?: string;
  onClose(): void;
  onSave(path: string): void;
}

export function WorkspaceSettings({
  savedPath,
  activePath,
  onClose,
  onSave,
}: Props) {
  const [selectedPath, setSelectedPath] = useState(savedPath ?? "");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    picker.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  async function chooseFolder() {
    if (picking) return;
    setPicking(true);
    setError(null);
    try {
      const folder = await open({
        title: "작업 디렉터리 설정",
        directory: true,
        multiple: false,
        defaultPath: selectedPath || undefined,
      });
      if (folder && !Array.isArray(folder)) setSelectedPath(folder);
    } catch {
      setError("폴더 선택기를 열지 못했습니다. 다시 시도해주세요.");
    } finally {
      setPicking(false);
    }
  }
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!picking) onClose();
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      const controls = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  const unchanged = selectedPath === savedPath && activePath === savedPath;
  return (
    <div className="modal-overlay">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={keys}
      >
        <header>
          <div>
            <span className="file-label">WORKSPACE · 설정</span>
            <h2 id="settings-title">설정</h2>
          </div>
          <button
            className="plain-button"
            aria-label="설정 닫기"
            disabled={picking}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p className="settings-intro">
          문서를 보관하고 에이전트와 대화할 작업 디렉터리를 정합니다.
        </p>
        <div className="settings-saved">
          <span>현재 저장된 경로</span>
          <p>
            {savedPath ? (
              <code>{savedPath}</code>
            ) : (
              "저장된 작업 디렉터리가 없습니다. 폴더를 선택해주세요."
            )}
          </p>
        </div>
        {savedPath && !activePath && (
          <p className="settings-warning" role="alert">
            저장된 디렉터리를 열지 못했습니다. 다른 폴더를 선택하거나 다시
            저장해주세요.
          </p>
        )}
        <label className="settings-folder">
          작업 디렉터리
          <input
            aria-label="선택한 작업 디렉터리"
            readOnly
            value={selectedPath}
            placeholder="폴더를 선택해주세요"
          />
        </label>
        <button
          ref={picker}
          className="settings-picker"
          disabled={picking || !isDesktop()}
          onClick={() => void chooseFolder()}
        >
          {picking ? "폴더 선택 중…" : "폴더 선택"}
        </button>
        <p className="settings-hint">
          저장하면 이 디렉터리의 문서가 사이드바에 표시됩니다. 저장하지 않은
          문서가 있으면 먼저 확인합니다.
        </p>
        {error && (
          <p className="settings-warning" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button disabled={picking} onClick={onClose}>
            취소
          </button>
          <Button
            disabled={picking || !selectedPath || unchanged || !isDesktop()}
            onClick={() => onSave(selectedPath)}
          >
            설정 저장
          </Button>
        </div>
      </section>
    </div>
  );
}
