import { useEffect, useRef, useState } from "react";
import { Button } from "@box/ui";
import type { AgentChatModel } from "../model/use-agent-chat";

const statusLabels = {
  creating: "준비 중",
  ready: "대화 가능",
  busy: "응답 중",
  closing: "종료 중",
  uncertain: "결과 확인 필요",
  failed: "에이전트 오류",
  closed: "종료됨",
  lost: "연결 변경됨",
};
export function AgentChatSheet({
  model,
  open,
  workspace,
  blocked,
  onHide,
}: {
  model: AgentChatModel;
  open: boolean;
  workspace?: string;
  blocked: boolean;
  onHide(): void;
}) {
  const [agentId, setAgentId] = useState("");
  const [permissionMode, setPermissionMode] = useState<"default" | "readOnly">(
    "default",
  );
  const [modelId, setModelId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const sessions = model.snapshot?.sessions ?? [];
  const session =
    sessions.find((item) => item.id === selected) ??
    sessions[sessions.length - 1];
  const agent = model.agents.find((item) => item.id === agentId);
  const draft = session ? (drafts[session.id] ?? "") : "";
  const canSend = Boolean(
    session &&
      session.status === "ready" &&
      !model.busy &&
      !session.streamError &&
      model.snapshot?.connection === "connected" &&
      draft.trim(),
  );
  useEffect(() => {
    if (!model.agents.some((item) => item.id === agentId))
      setAgentId(
        model.agents.find((item) => item.id === "codex")?.id ??
          model.agents[0]?.id ??
          "",
      );
  }, [model.agents, agentId]);
  useEffect(() => {
    setModelId("");
  }, [agentId]);
  useEffect(() => {
    setSelected(null);
  }, [workspace]);
  useEffect(() => {
    if (open && follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [open, session]);
  async function send() {
    if (!session || !canSend) return;
    const id = session.id,
      text = draft;
    if (await model.send(id, text))
      setDrafts((current) => ({
        ...current,
        [id]: current[id] === text ? "" : current[id],
      }));
  }
  return (
    <aside
      className="agent-chat-sheet"
      aria-label="에이전트 채팅"
      hidden={!open}
      inert={blocked}
    >
      <header className="agent-chat-heading">
        <div>
          <span className="file-label">AGENT · 대화</span>
          <h2>문서와 이야기하기</h2>
        </div>
        <button
          className="plain-button"
          aria-label="채팅 숨기기"
          onClick={onHide}
        >
          ×
        </button>
      </header>
      <p className="agent-chat-workspace" title={workspace}>
        {workspace ?? "작업 디렉터리를 선택해주세요."}
      </p>
      <section className="agent-chat-start">
        <label>
          에이전트
          <select
            aria-label="채팅 에이전트"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            disabled={!model.agents.length || model.busy}
          >
            {model.agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="agent-chat-options">
          <label>
            승인 방식
            <select
              aria-label="채팅 승인 방식"
              value={permissionMode}
              onChange={(event) =>
                setPermissionMode(event.target.value as "default" | "readOnly")
              }
            >
              <option value="default">기본 승인</option>
              <option value="readOnly">읽기 전용</option>
            </select>
          </label>
          <label>
            모델
            <select
              aria-label="채팅 모델"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">에이전트 기본값</option>
              {agent?.models?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button
          disabled={
            !agentId ||
            !workspace ||
            model.busy ||
            model.snapshot?.connection !== "connected"
          }
          onClick={() => {
            void model
              .createSession({
                agentId,
                permissionMode,
                modelId: modelId || undefined,
              })
              .then((id) => {
                if (id) setSelected(id);
              });
          }}
        >
          새 세션
        </Button>
      </section>
      {model.error && (
        <p className="agent-chat-error" role="alert">
          {model.error}
        </p>
      )}
      {model.snapshot?.connection !== "connected" && (
        <div className="agent-chat-connection">
          <span>
            {model.snapshot?.connection === "reconnecting"
              ? "다시 연결 중…"
              : "연결 준비 중…"}
          </span>
          <button disabled={model.busy} onClick={() => void model.reconnect()}>
            다시 연결
          </button>
        </div>
      )}
      {sessions.length > 0 && (
        <select
          className="agent-chat-session-picker"
          aria-label="채팅 세션"
          value={session?.id ?? ""}
          onChange={(event) => {
            setSelected(event.target.value);
            follow.current = true;
          }}
        >
          {sessions.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index + 1}. {item.label} · {statusLabels[item.status]}
            </option>
          ))}
        </select>
      )}
      <div
        className="agent-chat-log"
        ref={log}
        role="log"
        aria-label="채팅 대화"
        onScroll={() => {
          const node = log.current;
          if (node)
            follow.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {!session ? (
          <p className="agent-chat-empty">
            새 세션을 시작하고
            <br />
            문서에 대해 이야기해보세요.
          </p>
        ) : (
          <>
            {session.historyIncomplete && (
              <p className="agent-chat-note">
                이전 대화 일부를 복원하지 못했습니다.
              </p>
            )}
            {session.messages.map((message) => (
              <article
                className={`agent-chat-message ${message.role}`}
                key={message.id}
              >
                <small>
                  {message.role === "user"
                    ? "나"
                    : message.role === "thought"
                      ? "생각"
                      : "에이전트"}
                </small>
                <p>{message.text}</p>
                {message.delivery && message.delivery.kind !== "ok" && (
                  <span className="agent-chat-note">
                    {message.delivery.kind === "pending"
                      ? "전송 중…"
                      : message.delivery.kind === "unknown"
                        ? "전송 결과 확인 필요"
                        : "전송하지 못했습니다"}
                  </span>
                )}
              </article>
            ))}
            {session.status === "busy" && (
              <p className="agent-chat-note" role="status">
                응답 중…
              </p>
            )}
            {session.error && (
              <p className="agent-chat-error" role="alert">
                {session.error}
              </p>
            )}
            {session.streamError && (
              <p className="agent-chat-error" role="alert">
                대화를 복원하는 중입니다. {session.streamError}
              </p>
            )}
            {session.permissions.map((request) => (
              <section
                className="agent-chat-permission"
                aria-label="채팅 권한 요청"
                key={request.id}
              >
                <strong>{request.title}</strong>
                {request.input != null && (
                  <details>
                    <summary>요청 내용</summary>
                    <pre>{JSON.stringify(request.input, null, 2)}</pre>
                  </details>
                )}
                <div>
                  {request.options.map((option) => (
                    <button
                      key={option.optionId}
                      disabled={
                        model.busy ||
                        request.responding ||
                        session.status === "closing"
                      }
                      onClick={() =>
                        void model.respond(
                          session.id,
                          request.id,
                          option.optionId,
                        )
                      }
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
                {request.outcome && request.outcome.kind !== "ok" && (
                  <p className="agent-chat-note">승인 결과를 확인해주세요.</p>
                )}
              </section>
            ))}
          </>
        )}
      </div>
      <form
        className="agent-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="채팅 메시지"
          placeholder={
            session?.status === "ready"
              ? "메시지를 입력하세요"
              : "세션이 준비되면 메시지를 보낼 수 있습니다"
          }
          value={draft}
          onChange={(event) => {
            if (session)
              setDrafts((current) => ({
                ...current,
                [session.id]: event.target.value,
              }));
          }}
          disabled={
            !session ||
            model.busy ||
            session.status !== "ready" ||
            Boolean(session.streamError)
          }
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey) {
              if (event.key === "Enter") {
                event.preventDefault();
                void send();
              }
              if (["s", "n", "o", "Enter"].includes(event.key))
                event.stopPropagation();
            }
          }}
        />
        <div>
          <span>
            {session ? statusLabels[session.status] : "세션을 시작해주세요"}
          </span>
          {session && (
            <button
              type="button"
              disabled={
                model.busy ||
                session.status === "closed" ||
                session.status === "closing"
              }
              onClick={() => void model.closeSession(session.id)}
            >
              세션 종료
            </button>
          )}
          <Button type="submit" disabled={!canSend}>
            보내기
          </Button>
        </div>
      </form>
    </aside>
  );
}
