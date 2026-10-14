# AW 문서 MCP 채팅 연결 감사 (gh-81 · 부모 gh-76)

2026-10-14 기준으로 native grant 경계(gh-75), 세션 제어(gh-79), 선택·진단 UI(gh-80)와 실제 AW HTTP/WS·ACP subprocess 검증을 대조했다. Box는 기존 `workbench-agent-client`와 `workbench-desktop-client`를 사용한다. 현재 요구를 충족하는 SessionOptions·lifecycle 구독·diagnostic 경로가 제공되어 AW 공유 라이브러리 확장은 필요하지 않았다.

## 기준별 근거

| 기준 | 소스·실행 근거 |
| --- | --- |
| native grant 계약과 전달 | `entities/document-mcp/index.ts`가 generation/run과 loopback HTTP DTO를 검증한다. gh-75의 실제 native IPC/HTTP 검증과 adapter 단위 검증을 재사용한다. 새 integration test는 실제 AW router·WS·ACP subprocess의 `session/new`에서 Box name/type/url과 Authorization digest를 대조한다. |
| 공유 라이브러리 재사용 | `DocumentChatSessions`는 AW client를 감싸며 grant DTO를 기존 `createSession`에 전달한다. 실제 ACP 요청에는 Box 설정과 AW의 `agentic_workbench` 서버가 함께 전달된다. |
| 지원·미지원과 일반 채팅 | HTTP capability를 광고하는 fixture에서 전달을 확인한다. 미지원 fixture에서는 실제 AW diagnostic을 관찰하고 grant를 폐기하며 ready 상태의 일반 채팅을 유지한다. UI에서 다음 세션의 문서 도구 해제와 재연결을 제공한다. |
| 생성 실패·EOF·종료 | 실제 ACP session/new 오류·process EOF 및 명시 close를 검증한다. native API 폐기 호출은 모킹한다. fault/notApplied/unknown/throw와 failed/closed/lost 각 상태 및 폐기 실패 재시도는 controller 단위 검증으로 보완한다. |
| root·같은 경로 재선택·disposal | 실제 ready ACP 세션에서 generation 변경과 controller disposal의 폐기를 확인한다. backend의 old root HTTP 401·새 root 격리는 gh-75 실제 HTTP 검증이다. 늦은 grant·create 결과·agent catalog 및 늦은 grant 발급 실패가 새 generation 상태를 덮어쓰지 않는 회귀도 검증한다. |
| 패널 collapse | controller lifecycle 구독은 UI 구독과 별개다. 숨긴 패널 종료 테스트와 실제 일반 채팅 Playwright의 collapse·입력 보존을 대조한다. 패널 숨김은 client나 grant disposal을 호출하지 않는다. |
| 비밀값 | controller private field와 sanitized snapshot/error를 사용한다. adapter 잘못된 응답·event/permission key 및 값의 반사 테스트를 확인한다. 통합 fixture는 bearer 원문 대신 SHA-256 digest만 임시 증거 파일에 기록하며 종료 후 파일을 삭제한다. credential의 localStorage·문서 저장 경로는 추가하지 않았다. |

## 실행표와 검증 범위

`document-chat-sessions.integration.test.jsx`의 6개 검증은 실제 공유 AW HTTP/WS 서버와 ACP Python subprocess를 실행한다. native grant API는 계약에 맞는 테스트 DTO와 폐기 spy로 대체한다. 따라서 이 실행만으로 실제 native credential이 폐기되었다고 주장하지 않는다. 그 경계는 gh-75의 실제 MCP HTTP/IPC·scope 전환 검증이 증명한다. 결합된 최신 native 앱과 설치 agent 검증은 gh-53에서 수행한다.

`pnpm --filter @box/desktop test:integration`: 문서 세션 6개와 기존 HomePage HTTP/WS·permission 통합 1개가 통과했다. 설치 agent 전용 3개는 opt-in 조건으로 건너뛰었다. gh-80 Playwright 2개는 실제 AW 일반 채팅과 panel UI를 검증한다. native backend의 기본 검사와 framework ACL·실제 HTTP 검증은 [gh-75 기록](document-mcp-native-grants.md)을 재사용하며 이번 작업은 Rust 소스를 변경하지 않는다.

늦은 native grant 발급 실패가 새 generation의 안내를 덮어쓰는 경로를 발견해 epoch/disposal guard를 추가했다. regression은 새 generation의 문서 도구 세션을 생성한 뒤 이전 발급을 실패시켜 새 세션의 enabled 상태와 notice를 보존하는지 검사한다.

최종 `pnpm test` 292개(desktop 93개), `pnpm check-types`, `pnpm build`가 성공했다. Rust fmt/alltargets는 변경 없는 backend에 대해 이번 작업 묶음에서 통과한 결과를 재사용한다.

후속 범위는 main 변경 반영 gh-77, 부모 gh-52 전체 통합 감사 gh-78 및 실제 설치 agent/native gh-53이다. 이 기록은 이들 후속 작업을 완료로 간주하지 않는다.

근거: [native grant](document-mcp-native-grants.md), [세션 제어](document-mcp-chat-sessions.md), [도구 UI](document-mcp-chat-ui.md), [통합 테스트](../apps/box-desktop/src/features/agent-chat/model/document-chat-sessions.integration.test.jsx), [세션 정책](../apps/box-desktop/src/features/agent-chat/model/document-chat-sessions.ts), [AW capability 처리](../vendor/agentic-workspace/crates/acp-agent-core/src/infrastructure/acp/runner.rs).
