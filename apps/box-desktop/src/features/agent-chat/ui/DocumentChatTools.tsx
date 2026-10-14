import { useId } from "react";
import type { AgentChatModel } from "../model/use-agent-chat";

/** Selection applies only to the next session; existing conversations keep their mode. */
export function DocumentChatTools({
  model,
  open,
  blocked,
}: {
  model: AgentChatModel;
  open: boolean;
  blocked: boolean;
}) {
  const description = useId();
  const tools = model.documentTools;
  if (!tools) return null;
  return (
    <section
      className="document-chat-tools"
      aria-label="문서 도구 설정"
      hidden={!open}
      inert={blocked}
    >
      <label>
        <input
          type="checkbox"
          checked={tools.enabled}
          disabled={model.busy}
          aria-describedby={description}
          onChange={(event) => tools.setEnabled(event.target.checked)}
        />
        새 채팅에서 문서 도구 사용
      </label>
      <p id={description}>
        선택한 작업 디렉터리의 문서를 조회하고 편집할 수 있습니다. 변경은 새
        세션부터 적용됩니다.
      </p>
      {tools.notice && (
        <div role="status">
          <p>{tools.notice}</p>
          <div className="document-chat-tools-actions">
            <button
              type="button"
              disabled={model.busy || !tools.enabled}
              onClick={() => tools.setEnabled(false)}
            >
              새 세션은 일반 채팅으로
            </button>
            <button
              type="button"
              disabled={model.busy}
              onClick={() => void model.reconnect()}
            >
              다시 연결
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
