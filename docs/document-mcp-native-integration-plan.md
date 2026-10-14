# 문서 MCP native·ACP·UI 연결 계획 (gh-52)

2026-10-14 기준 gh-51의 handler/실제 HTTP 구현 및 감사 근거를 재사용한다. gh-75의 [native host/grant와 main 명령](document-mcp-native-grants.md)은 구현·검증했다. ACP 세션 주입과 main UI 변경 반영은 후속 작업이다. 기존 AW vendor `760415c`의 `local-mcp-server`, `workbench-agent-client` 및 HTTP/WS client를 사용하고 Box에서 ACP process/stdio 구현을 추가하지 않는다.

## 순차 하위 작업

하위 gh-75 → gh-76 → gh-77 → gh-78 순서로 등록한다. 첫 작업은 gh-51에, 다음 작업은 직전 작업에 의존한다. gh-52의 마지막 통합 기준은 gh-78에 의존하며 기존 gh-51/gh-23/gh-32 선행 관계를 유지한다. gh-76은 gh-79(세션 제어 모델) → gh-80(문서 도구 선택·진단 UI) → gh-81(실제 AW/ACP fixture·부모 감사)로 나누고 gh-81에 의존한다. [gh-79 구현과 검증](document-mcp-chat-sessions.md)을 기록했다. UI와 실제 AW wire 검증은 아직 후속 작업이다.

| 순서 | 범위 | 완료 근거 |
| --- | --- | --- |
| 1 · gh-75 | native MCP host와 generation/run grant, main 전용 명령 | 실제 HTTP root 격리·credential 폐기·root/종료 drain, main/child ACL, 시작 실패 복구와 민감정보 비노출 |
| 2 · gh-76 | AW 공유 HTTP ACP 세션 주입·grant 폐기·지원 진단 | 실제 AW HTTP/WS 및 ACP fixture session/new 설정, 지원/미지원, 생성/EOF/종료/root/disposal/패널 collapse 수명과 stale async |
| 3 · gh-77 | main 변경 이벤트·clean 갱신·dirty/undo 보호 | 실제 backend 변경 완료 이벤트와 목록·문서·관계 갱신, dirty content/key/undo/baseline 보존, 삭제·동시 저장·stale 응답·generation 검증 |
| 4 · gh-78 | gh-52 전체 통합 감사 | 부모 모든 기준과 실제 AW fixture/native ACL/files/UI 결과 대조, 기본 검사·문서 및 자기검토 |

## 확인한 재사용 경로

`@yoophi/workbench-agent-client`의 `SessionOptions`는 `AgentRunRequest`에서 `mcpServers`를 유지한다. `createSession`은 이를 기존 `run.createSession` 호출에 전달한다. generated `AgentMcpServerConfigDto`는 HTTP type, name/url과 header 배열을 제공한다. AW ACP runner는 initialize의 HTTP MCP capability가 참일 때만 서버 설정을 session 요청에 전달하고, 미지원이면 diagnostic을 내며 서버 없이 채팅을 진행한다. Box는 이 경로를 사용한다.

현재 Box의 `useAgentChat`은 workspace별 client를 유지하고 패널 collapse에서 dispose하지 않는다. grant 수명도 collapse와 세션 종료를 구분해야 한다. 생성 실패·불확실 결과 및 lost/EOF, 명시 종료와 root generation 변경, 앱 disposal에는 backend 폐기를 연결한다. 비밀값은 런타임 전달에만 사용하며 localStorage·문서·사용자 메시지·진단·애플리케이션 로그에 남기지 않는다. 공유 라이브러리로 충족하지 못하는 요구가 확인되면 AW 확장 계획과 구현 위치를 기록한다.

## backend와 main 경계

backend가 선택한 `DocumentScope` generation에 grant를 고정한다. frontend/root/tool 입력의 경로로 authority를 선택하지 않는다. 프로필 연결 서비스는 native/MCP가 같은 Arc를 계속 사용한다. root 전환은 old scope 신규 수락을 막고 기존 accepted worker를 drain한 뒤 새 root를 공개하는 기존 계약을 유지한다. credential 폐기는 기존 수락 변경의 소유권을 취소하지 않는다. 앱 종료에는 host 신규 수락 중단, 문서 작업 drain과 host 종료를 연결한다.

credential 명령은 `invoke_handler`, `build.rs` 명령 목록 및 main capability에 함께 등록하고 native URL/label을 검사한다. 외부 child WebView에는 권한을 주지 않는다. 이벤트 payload는 현재 generation과 문서 식별 정보를 포함하며 credential·작업 루트의 절대 경로를 포함하지 않는다. 같은 nonce 결과 재시도는 새로운 변경 완료 이벤트를 만들지 않는다.

## UI와 최종 검증

현재 generation/path의 이벤트에서 목록과 clean 문서 내용을 재조회한다. dirty 문서는 content/key/undo/baseline을 유지하고 외부 변경·삭제를 안내한다. 재조회 중 사용자 입력이나 선택/root 변경이 발생하면 오래된 응답을 적용하지 않는다. 동시 저장에서는 공통 CAS와 revision 기준을 유지한다. 관계 이벤트는 본문 문서와 독립된 모델을 갱신한다.

각 하위 작업은 관련 실제 파일/HTTP·IPC 또는 UI 회귀 및 프로젝트 기본 검사를 완료한 뒤 개별 commit/push와 td 검토·완료 알림을 남긴다. 이 단계의 ACP fixture는 설치된 실제 agent가 도구를 사용했다는 증거로 바꾸지 않는다. gh-53의 실제 설치 agent/native 전체 검증과 기존 부모 gh-20 의존성을 유지한다.

근거: [전체 HTTP 감사](document-mcp-http-acceptance-audit.md), [부모 계획](document-mcp-implementation-plan.md), [AW client](../vendor/agentic-workspace/packages/workbench-agent-client/src/client.ts), [HTTP 설정 DTO](../vendor/agentic-workspace/packages/workbench-client/src/generated/workbench.ts), [ACP capability](../vendor/agentic-workspace/crates/acp-agent-core/src/infrastructure/acp/runner.rs), [Box chat](../apps/box-desktop/src/features/agent-chat/model/use-agent-chat.ts), [workspace 수명](document-scope-lifecycle.md).
