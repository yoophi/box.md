import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  editorExtensions,
  markdownToDocument,
  splitDocument,
  richTextIssue,
} from "@box/editor";
import type { Editor } from "@tiptap/react";

interface Props {
  content: string;
  disabled: boolean;
  onChange: (content: string) => void;
}

function Tool({
  label,
  active,
  action,
  disabled,
}: {
  label: string;
  active?: boolean;
  action: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={`format-tool ${active ? "active" : ""}`}
      aria-pressed={Boolean(active)}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {label}
    </button>
  );
}

function RichEditor({ content, disabled, onChange }: Props) {
  const { prefix, body } = splitDocument(content);
  const [link, setLink] = useState<string | null>(null);
  const editor = useEditor({
    extensions: editorExtensions(),
    content: markdownToDocument(body),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "document-prose",
        "aria-label": "문서 본문",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor }) => onChange(prefix + editor.getMarkdown()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);
  const format = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold"),
      italic: editor?.isActive("italic"),
      heading: editor?.isActive("heading"),
      bullet: editor?.isActive("bulletList"),
      task: editor?.isActive("taskList"),
    }),
  });
  if (!editor) return null;
  function command(action: (editor: Editor) => void) {
    action(editor!);
  }
  return (
    <>
      <div className="format-toolbar" aria-label="서식 도구">
        <Tool
          label="제목"
          active={format?.heading}
          disabled={disabled}
          action={() =>
            command((e) => e.chain().focus().toggleHeading({ level: 2 }).run())
          }
        />
        <Tool
          label="굵게"
          active={format?.bold}
          disabled={disabled}
          action={() => command((e) => e.chain().focus().toggleBold().run())}
        />
        <Tool
          label="기울임"
          active={format?.italic}
          disabled={disabled}
          action={() => command((e) => e.chain().focus().toggleItalic().run())}
        />
        <Tool
          label="목록"
          active={format?.bullet}
          disabled={disabled}
          action={() =>
            command((e) => e.chain().focus().toggleBulletList().run())
          }
        />
        <Tool
          label="체크"
          active={format?.task}
          disabled={disabled}
          action={() =>
            command((e) => e.chain().focus().toggleTaskList().run())
          }
        />
        <Tool
          label="인용"
          disabled={disabled}
          action={() =>
            command((e) => e.chain().focus().toggleBlockquote().run())
          }
        />
        <Tool
          label="코드"
          disabled={disabled}
          action={() =>
            command((e) => e.chain().focus().toggleCodeBlock().run())
          }
        />
        <Tool
          label="표"
          disabled={disabled}
          action={() =>
            command((e) =>
              e
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
                .run(),
            )
          }
        />
        <Tool
          label="링크"
          disabled={disabled}
          action={() =>
            setLink(editor.getAttributes("link").href || "https://")
          }
        />
        <Tool
          label="되돌리기"
          disabled={disabled || !editor.can().undo()}
          action={() => command((e) => e.chain().focus().undo().run())}
        />
        <Tool
          label="다시 실행"
          disabled={disabled || !editor.can().redo()}
          action={() => command((e) => e.chain().focus().redo().run())}
        />
      </div>
      {link !== null && (
        <form
          className="link-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (/^https?:\/\//i.test(link)) {
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: link })
                .run();
              setLink(null);
            }
          }}
        >
          <label>
            링크 주소{" "}
            <input
              autoFocus
              aria-label="링크 주소"
              type="url"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              required
              pattern="https?://.*"
            />
          </label>
          <button type="submit">적용</button>
          <button type="button" onClick={() => setLink(null)}>
            취소
          </button>
        </form>
      )}
      {prefix && (
        <div className="frontmatter-note">
          YAML 속성은 그대로 보존됩니다. 속성 수정은 Markdown 원문에서 할 수
          있습니다.
        </div>
      )}
      <EditorContent editor={editor} className="rich-editor" />
    </>
  );
}

export function MarkdownEditor(props: Props) {
  const issue = richTextIssue(props.content);
  const [mode, setMode] = useState<"rich" | "source">(
    issue ? "source" : "rich",
  );
  const source = mode === "source" || Boolean(issue);
  return (
    <section className="editor-surface" aria-label="문서 편집기">
      <div className="mode-bar">
        <span>MARKDOWN DOCUMENT</span>
        <div className="mode-switch" aria-label="편집 모드">
          <button
            type="button"
            aria-pressed={!source}
            disabled={props.disabled || Boolean(issue)}
            onClick={() => setMode("rich")}
          >
            서식 편집
          </button>
          <button
            type="button"
            aria-pressed={source}
            disabled={props.disabled}
            onClick={() => setMode("source")}
          >
            Markdown 원문
          </button>
        </div>
      </div>
      {issue && (
        <p className="frontmatter-note" role="status">
          {issue}
        </p>
      )}
      {source ? (
        <textarea
          className="source-editor"
          aria-label="Markdown 원문"
          value={props.content}
          disabled={props.disabled}
          spellCheck={false}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder="# 새로운 생각"
        />
      ) : (
        <RichEditor {...props} />
      )}
    </section>
  );
}
