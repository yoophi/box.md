# 문서 MCP 프로토콜 및 Rust SDK 조사

조사일: 2026-10-13. 대상: gh-20 구현 준비. 이 문서는 공식 규격과 SDK 소스를 검토한 구현 기준 제안이며 Box 문서 도구나 네이티브 서버의 구현 완료를 뜻하지 않는다.

gh-49 실제 HTTP 검증 후 공용 호스트를 추가했다. 조사 당시의 제안과 현재 구현을 구별하며 [호스트 연동 결과](document-mcp-host-integration.md)를 따른다. 특히 rmcp 3.5.1 legacy stateless 경로는 알려진 version header를 handler의 allowlist로 제한하지 않고, 도구 스키마 광고는 전체 runtime input validation을 제공하지 않는다. 공용 host에서 version header를 제한하고 앱 handler가 input을 검증한다. 단순 SDK schema 제공만으로 검증 완료를 주장하지 않는다.

## 결론과 버전 기준

MCP wire protocol은 공식 Rust SDK `rmcp`에 맡기고, AW에는 앱 도구 handler를 주입받는 공용 HTTP 호스트를 마련하는 방향을 제안한다. Box에는 문서 application service를 호출하는 handler만 둔다. 현재 AW 서버의 구체적인 `WorkbenchRuntime` 결합은 아래 로컬 소스에서 확인했다. 이는 설계 제안이며 현재 구현 상태가 아니다.

2026-10-13 확인 기준 최신 stable GitHub 릴리스는 **rmcp 3.5.1**, 공개일은 2026-10-05다. crates.io에서도 `3.5.1`의 게시 및 `yanked: false`를 확인했다. SDK workspace가 선언하는 최소 Rust 버전은 **1.88**, edition은 **2024**다. [공식 릴리스](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.1), [공식 crate 등록 정보](https://crates.io/api/v1/crates/rmcp/3.5.1), [릴리스 커밋 Cargo.toml](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/Cargo.toml)

태그 `rmcp-v3.5.1`을 해제한 커밋은 `79437f291b2c44053d00dcd5db969fd0cca7c887`이다. 태그 이동 가능성과 `main` 변경을 피하기 위해 아래 SDK 근거는 이 커밋에 고정했다. 의존성의 제안 기준은 crates.io의 **`version = "=3.5.1"`와 Cargo.lock**, 실제 클라이언트 상호 운용의 초기 목표는 **MCP 2025-11-25**다. SDK README는 2026-07-28 구현과 2025-11-25 및 이전 버전 호환을 명시한다. 최신 규격 기능을 Box의 초기 필수 계약으로 확대할 필요는 없다. [태그 ref](https://api.github.com/repos/modelcontextprotocol/rust-sdk/git/ref/tags/rmcp-v3.5.1), [고정 커밋 README](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/README.md)

## 현재 AW와 Box에서 확인한 경계

| 확인한 사실 | 로컬 근거 |
| --- | --- |
| AW 자체 parser/response 타입과 initialize 결과가 있으며 `MCP_PROTOCOL_VERSION`은 `2025-11-25`다. | [protocol.rs](../vendor/agentic-workspace/crates/workbench-host/src/mcp/protocol.rs) |
| `McpServerState::start`와 도구 dispatch가 `Arc<WorkbenchRuntime>`를 직접 받는다. 공개 API에서 앱별 handler factory를 받는 확장 지점을 확인하지 못했다. 루프백 임의 포트 bind, run 토큰 발급, GET 405, 자체 POST dispatch를 구현한다. | [mcp/mod.rs](../vendor/agentic-workspace/crates/workbench-host/src/mcp/mod.rs) |
| 받아들인 `tools/call`은 `spawn_accepted`로 실행하고 종료 drain을 추적한다. | [mcp/mod.rs](../vendor/agentic-workspace/crates/workbench-host/src/mcp/mod.rs) |
| `SessionOptions`는 `AgentRunRequest`에서 일부 필드를 제외한 타입이고, `createSession`이 나머지 요청을 `run.createSession`에 전달한다. `mcpServers`를 위한 별도 프런트엔드 전달 계약을 다시 만들 필요가 있는지 먼저 기존 경로에서 확인할 수 있다. | [types.ts](../vendor/agentic-workspace/packages/workbench-agent-client/src/types.ts), [client.ts](../vendor/agentic-workspace/packages/workbench-agent-client/src/client.ts), [생성된 HTTP 계약](../vendor/agentic-workspace/packages/workbench-client/src/generated/workbench.ts) |

**추론:** 기존 AW MCP 모듈에 Box 도구 분기를 직접 추가하면 Workbench runtime과 Box 문서 도메인을 결합한다. 공용 wrapper가 `ServerHandler` factory, 인증 principal resolver, listener 수명 및 accepted-call drain을 받고, Box가 자신의 문서 handler를 주입하는 편이 현재 아키텍처 경계에 맞는다. AW의 기존 run 토큰과 문서 작업용 Box principal이 동일하다고 가정해서는 안 된다.

## 공식 SDK의 구체적인 확장 지점

권장 Cargo feature 조합은 `default-features = false`, `features = ["server", "macros", "transport-streamable-http-server"]`다. `server`가 schema 지원을 포함하고, HTTP 서버 feature가 Tower/HTTP 및 session transport 의존성을 활성화한다. 매크로를 쓰지 않는 수동 handler에는 `macros`를 생략할 수 있다. [고정 커밋 crate feature 선언](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/Cargo.toml)

서버 API는 `StreamableHttpService::new(factory, Arc<SessionManager>, config)`이며 factory 형태는 `Fn() -> Result<S, std::io::Error>`다. `S`는 `ServerHandler + Send + 'static`이다. `StreamableHttpServerConfig`는 `non_exhaustive`이므로 외부 crate에서 struct literal 대신 `default()`와 builder를 사용한다. [HTTP service와 config 소스](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/tower.rs#L78-L280), [factory 생성자](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/tower.rs#L1412-L1440)

공식 예제는 `axum::Router::new().nest_service("/mcp", service)`로 연결하고 `TcpListener`와 `axum::serve`를 애플리케이션이 소유한다. 따라서 SDK가 Tauri를 요구하지 않으며 네이티브 shell과 서버 protocol을 분리할 수 있다. [공식 HTTP 서버 예제](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/examples/servers/src/counter_streamhttp.rs)

수동 handler는 `get_info`, `supported_protocol_versions`, `list_tools`, `get_tool`, `call_tool`을 구현한다. 3.x의 `call_tool` 반환은 `Result<CallToolResponse, ErrorData>`이며 완료 도구 결과는 `CallToolResult`에서 변환한다. 초기 버전의 광고·initialize 협상을 좁히려면 `supported_protocol_versions`를 `[ProtocolVersion::V_2025_11_25]`로 제한한다. 기본 구현은 SDK가 아는 모든 버전을 지원한다고 광고한다. `get_info`만 낮은 버전으로 설정하는 것으로 지원 버전 allowlist를 대체하지 않는다. 다만 gh-49에서 확인한 legacy stateless 후속 version header에는 host의 추가 제한이 필요하다. [ServerHandler 계약](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/handler/server.rs#L315-L552)

매크로 경로는 `#[tool_router]`, `#[tool_handler]`, `Parameters<T>`와 `Json<T>`를 사용하며 Rust 타입에서 input/output schema를 생성하는 공식 예제가 있다. 수동 `get_tool` 기본 구현은 `None`이며 schema 정보를 제공하지 않는다. `Some(Tool)`을 제공해도 gh-49 HTTP 검사에서 extra key가 자동 거부되지 않았으므로 handler가 runtime 입력 검증을 수행해야 한다. [공식 structured output 예제](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/examples/servers/src/structured_output.rs), [handler 소스](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/handler/server.rs#L538-L551)

## 2025-11-25 호환과 HTTP 동작

2025-11-25 연결은 `initialize` 요청, 버전·capability 결과, `notifications/initialized` 순서다. 서버가 요청 버전을 지원하면 같은 버전으로 응답해야 하며 클라이언트는 이후 요청에 협상한 `MCP-Protocol-Version`을 보낸다. 도구 서버는 `tools` capability를 선언하고 사용하지 않는 기능은 광고하지 않는다. [공식 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [공식 tools capability](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#capabilities)

| HTTP 계약 | 2025-11-25 기준 |
| --- | --- |
| POST | JSON-RPC 메시지 한 건. Accept는 `application/json`, `text/event-stream` 모두 포함. |
| 요청 응답 | JSON 한 건 또는 SSE. 클라이언트는 둘 다 지원. |
| notification/response 수락 | 본문 없는 `202 Accepted`. |
| GET | SSE 또는 `405 Method Not Allowed`. |
| 이후 버전 header | 협상 버전. 잘못되거나 지원하지 않는 버전은 400. 식별 근거가 없고 header도 없으면 2025-03-26 가정. |
| 선택적 session | initialize 응답에서 ID를 발급했다면 이후 요청에 그 ID 필수. 필요한 ID 누락은 400 권고, 종료된 ID는 404. |
| 404 session 복구 | ID 없이 다시 initialize. DELETE 종료 요청을 지원하지 않으면 405 가능. |

표의 근거: [공식 Streamable HTTP 규격](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

SDK의 `legacy_session_mode` 기본값은 `true`다. 이를 `false`로 설정하는 stateless 경로에서도 2025-11-25 initialize 협상을 지원한다. `with_json_response(true)`는 단순 결과에 JSON을 선호하되 중간 메시지가 발생하면 SSE로 전환한다. stateless 선택 시 `NeverSessionManager::default()`를 사용할 수 있으며 기본 manager를 전달하고 session mode만 끄는 공식 테스트도 있다. [stateless initialize 버전 테스트](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/tests/test_stateless_protocol_version.rs), [NeverSessionManager](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/session/never.rs), [JSON 응답 테스트](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/tests/test_streamable_http_json_response.rs)

**초기 제안:** 문서 도구가 요청/응답만 필요하면 `with_legacy_session_mode(false).with_json_response(true)`를 채택한다. 서버 전송 sampling/elicitation, 연결별 capability 상태 또는 SSE 재개가 필요해지면 session mode를 별도 검토한다. 2026-07-28 전용 `with_stateless_protocol_metadata_required(true)`는 2025-11-25 클라이언트가 보내지 않는 `_meta`까지 요구하므로 초기 설정에서 켜지 않는다. **확인 필요:** 실제 사용할 ACP 에이전트가 legacy stateless 서버의 초기화와 JSON/SSE 응답을 처리하는지 상호 운용 smoke test를 한다. SDK의 자체 호환 테스트는 그 에이전트에 대한 증거가 아니다. [metadata 옵션의 버전 제약](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/tower.rs#L158-L187)

## 인증, Origin, 로컬 listener

규격은 모든 연결에서 Origin 검증을 요구하고, 존재하지만 허용하지 않는 Origin은 403으로 거부하도록 정한다. 로컬에서는 localhost bind 및 모든 연결의 인증을 권고한다. CORS 설정만으로 인증과 DNS rebinding 방어를 대체하지 않는다. [공식 transport 보안 요구](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning)

SDK는 Host에 루프백 allowlist를 기본 적용하지만 **Origin 기본 빈 allowlist는 검증을 끈다**. `enforce_origin_validation()`을 호출하면 빈 목록이어도 존재하는 모든 Origin을 거부한다. 비브라우저 로컬 에이전트는 Origin 없이 허용할 수 있고, browser client가 필요하면 정확한 scheme/host/port allowlist를 정한다. 포트 없는 allowlist 항목은 현재 모든 포트를 허용하고 deprecated이므로 명시 포트를 사용한다. [고정 커밋 Origin/Host config](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/tower.rs#L101-L131)

Bearer 인증은 SDK의 자동 애플리케이션 권한 검증이 아니다. 공식 simple-auth 예제도 Axum middleware에서 토큰을 검사한 뒤 보호된 MCP route로 전달하며 실패를 401로 반환한다. wrapper는 initialize와 GET/DELETE를 포함한 모든 MCP 요청을 인증하고, 검증한 principal을 `http::request::Parts.extensions`로 handler에 전달할 수 있다. [공식 Bearer middleware 예제](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/examples/servers/src/simple_auth_streamhttp.rs), [HTTP parts 확장 주입 API](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/transport/streamable_http_server/tower.rs#L1273-L1331)

**Box 제안:** `127.0.0.1:0` listener, 문서/chat 세션 범위 토큰, 만료·폐기, doc ID의 권한 검증을 서버가 소유한다. 에이전트 인자의 doc ID를 인증 principal로 신뢰하지 않는다. 원격 배포나 범용 OAuth 클라이언트 지원은 별도 인증 범위다. 세션 ID를 인증 수단으로 사용하지 말고 매 요청을 인증해야 한다는 공식 보안 지침도 적용한다. [공식 session hijacking 완화](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices#mitigation-3)

## 도구 schema와 오류 계약

2025-11-25에서 input schema는 유효한 JSON Schema 객체이며 기본 dialect는 2020-12다. `structuredContent`는 **JSON 객체**이고, 호환을 위해 같은 JSON의 TextContent도 권고된다. output schema를 제공하면 구조화 결과가 그 schema에 맞아야 한다. 업무 실패·도구 인자 검증 실패는 정상 JSON-RPC `result` 안의 `isError: true`, 알 수 없는 도구·잘못된 `tools/call` 메시지 구조는 protocol error다. [공식 도구 규격](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

SDK의 `CallToolResult::structured(value)` 및 `structured_error(value)`는 구조화 값과 JSON text를 함께 만들고 각각 `is_error`를 false/true로 설정한다. 최신 SDK 모델은 임의 JSON 값을 허용하므로, 초기 2025-11-25 호환 계약은 Box 결과를 객체로 제한해야 한다. [고정 커밋 CallToolResult 생성자](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/model.rs#L3972-L3998), [structured 생성자](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/model.rs#L4155-L4191)

**Box 제안:** `read_document`, `replace_document`, `append_document`, `replace_range` 같은 문서 작업을 별도 도구로 표현하고, 동일 application service가 UI 저장과 MCP 저장 모두의 검증·충돌·persistence를 처리한다. output schema는 성공과 업무 실패를 모두 담는 객체 union으로 정의한다. 오류 객체에는 기계 판독 `code`, 읽을 수 있는 `message`, 재조회 가능한 `currentRevision` 등을 넣되 인증 토큰이나 실제 파일 절대 경로를 노출하지 않는다. 인증 401/Origin 403은 HTTP transport 단계에서 처리하고, CAS 충돌은 `isError: true` 도구 결과로 반환한다.

## 재시도, CAS, disconnect

MCP의 `idempotentHint`는 같은 인자로 반복 호출해도 추가 효과가 없다는 **힌트**다. SDK가 업무 중복 억제나 문서 CAS를 제공한다는 뜻이 아니다. `readOnlyHint`, `destructiveHint` 등도 신뢰할 수 없는 서버의 보장으로 취급해서는 안 된다. [공식 SDK ToolAnnotations 정의](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/src/model/tool.rs#L43-L94)

규격은 SSE 연결 끊김을 요청 취소로 해석하지 않도록 권고한다. 한편 rmcp 3.5.1 stateless transport의 공식 회귀 테스트는 응답 연결이 끊기면 request cancellation token이 발화하는 것을 확인한다. 따라서 변경 handler가 취소 가능한 future에만 persistence를 맡겨서는 안 된다. [공식 transport의 disconnect 규정](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server), [SDK stateless disconnect 회귀 테스트](https://github.com/modelcontextprotocol/rust-sdk/blob/79437f291b2c44053d00dcd5db969fd0cca7c887/crates/rmcp/tests/test_streamable_http_disconnect_cancel.rs)

**애플리케이션 정책 제안:**

1. 변경 도구는 agent가 재전송해도 유지하는 `requestId`와 `expectedRevision`을 요구한다. JSON-RPC `id`와 MCP session ID는 업무 재시도 키로 사용하지 않는다.
2. 권한 확인 후 `(principal scope, document ID, operation, requestId)`에 대해 처리 결과와 인자 fingerprint를 기록한다. 동일 키·동일 인자는 원 결과를 반환하고, 동일 키·다른 인자는 명시적 충돌로 거부한다.
3. 성공 결과 재전송을 CAS 검사보다 먼저 처리한다. 최초 호출만 최신 revision을 비교하고 mutation 및 revision 증가를 하나의 직렬화된 critical section/transaction으로 commit한다.
4. 문서가 바뀌었으면 덮어쓰지 않고 현재 revision을 반환한다. 클라이언트가 문서를 재조회하고 새 변경을 판단한다. 오래된 range offset을 최신 텍스트에 자동 적용하지 않는다.
5. 수락한 mutation은 서버 소유 task가 원자 저장과 재시도 기록을 끝내고, HTTP handler는 그 task의 결과를 기다린다. 응답 유실 시 재시도 결과로 성공 여부를 확인한다. 종료는 신규 수락을 막고 accepted task를 drain한다.
6. append/range 변경을 `idempotentHint: true`로 광고하려면 이 중복 억제 계약과 보존 범위를 구현·검증해야 한다. 앱 재시작까지 보장하려면 journal이 영속적이어야 하며 메모리 cache만으로 이를 주장하지 않는다.

위 정책은 MCP의 의무 사항이나 SDK 내장 기능이 아닌 Box의 문서 무결성 설계 제안이다. 현재 AW에는 requestId 우선 업무 재시도 식별과 accepted-call drain 구현이 있으므로 유용한 선례지만 문서 CAS가 구현되었다는 증거는 아니다. [AW retry_identity.rs](../vendor/agentic-workspace/crates/workbench-host/src/mcp/retry_identity.rs), [AW accepted-call 경로](../vendor/agentic-workspace/crates/workbench-host/src/mcp/mod.rs)

## 구현을 시작하기 전 확인할 항목

- AW 공용 wrapper는 문서 타입·Box persistence를 모르고 handler factory, 인증과 수명 관리만 받도록 확장한다.
- 실제 lockfile 해석과 Rust 1.88+ toolchain에서 rmcp feature 조합을 compile한다. 이 조사에서는 Box에 dependency를 추가하거나 네이티브 compile을 수행하지 않았다.
- 2025-11-25 실제 클라이언트로 initialize → initialized 202 → tools/list → tools/call을 확인한다. 협상 버전, missing/unsupported header, JSON/SSE, GET 405, auth 401, Origin 403을 검증한다.
- 변경 도구는 응답 유실 후 동일 requestId, 다른 JSON-RPC id, 동시 중복 호출, 같은 requestId의 다른 payload, 오래된 revision, disconnect 도중 저장, 종료 drain을 검증한다.
- UI와 MCP의 동시 저장이 같은 application service에서 충돌을 감지하는지 확인한다. 네이티브 서버 수명과 agent 세션 종료 시 토큰 폐기는 실제 통합에서 검증한다.
