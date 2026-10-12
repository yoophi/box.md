# AW 공용 문서 MCP 호스트 기반 (gh-49)

AW `box-md-document-mcp` 브랜치에 앱별 handler를 주입하는 `local-mcp-server` crate를 구현하고 Box vendor를 `9ee73897ec04476d145536881381b5da313ea8cc`에 고정했다. 기존 공유 HTTP ACP client 및 패널 UI 변경을 포함한 pin이다. 사용자 AW main checkout, 기존 실행 앱/server 및 문서 설정은 변경하지 않았다.

| 소스 | 역할 |
| --- | --- |
| [공용 호스트 API](../vendor/agentic-workspace/crates/local-mcp-server/src/lib.rs) | 공식 rmcp handler factory, 루프백 HTTP, auth/principal, 명시적 Origin/Host/legacy version 정책, body 제한 및 수명 관리 |
| [공용 사용법](../vendor/agentic-workspace/docs/local-mcp-server.md) | SDK 경계, 오류, 앱의 grant/mutation/drain 책임, 실행·검증 |
| [HTTP 회귀](../vendor/agentic-workspace/crates/local-mcp-server/tests/http.rs) | 실제 TCP/HTTP 프로토콜 및 보안·수명 검사 |
| [echo 예제](../vendor/agentic-workspace/crates/local-mcp-server/examples/echo.rs) | 환경변수 credential, endpoint만 출력, Ctrl-C로 자신의 host 정상 종료 |

wire protocol은 공식 `rmcp = "=3.5.1"`과 AW Cargo.lock으로 고정한다. 공용 crate의 최소 Rust 버전 선언은 1.88이며 실제 검증은 1.99에서 수행했다. Axum 0.8을 별도로 추가하고 기존 AW 0.7 및 기존 lockfile package identity를 유지했다. Box에 새 stdio ACP engine이나 HTTP client를 복사하지 않았다.

## 계약과 확인한 경계

- 기본 `127.0.0.1:0`, 실제 포트 Host만 허용한다. Origin 없는 비브라우저 client는 허용하고 browser Origin은 정확한 scheme/host/port allowlist가 필요하다. SDK 기본 Origin OFF를 사용하지 않는다.
- 모든 HTTP method는 단일 bearer credential로 인증한다. callback이 opaque principal을 반환한 뒤 원문 Authorization header를 SDK/handler에서 제거한다. 모르는/폐기된 grant는 매 요청 401이다.
- 초기 legacy protocol은 2025-11-25다. version header의 지원/중복 여부를 host에서 확인하고 초기화 이외의 누락은 규격의 2025-03-26 가정에 따라 허용 목록을 확인한다. JSON-RPC parsing/dispatch는 SDK가 담당한다.
- 도구 schema를 광고해도 runtime input validation이 자동으로 완성되지 않는다. 예제에서도 타입/추가 필드/업무 실패를 직접 검증한다. structured 결과와 JSON text를 함께 반환한다.
- `stop_accepting`은 신규 요청만 거부한다. application이 수락한 mutation을 막고 drain한 뒤 `shutdown`을 호출한다. HTTP disconnect cancellation, revision CAS, retry journal 및 grant 수명은 앱 application 책임이다.

## 현재 검증 근거

공용 crate HTTP·수명 13개, 기존 AW host library 51개 테스트를 통과했다. 모든 target typecheck, clippy `-D warnings`, workspace fmt와 독립 Workbench 서버 check를 통과했다. 실제 echo executable에서 initialize/initialized/list/call과 credential 없는 출력, SIGINT exit 0을 검증했다. 기록은 [AW 사용법](../vendor/agentic-workspace/docs/local-mcp-server.md)의 gh-49 결과 및 `/tmp/box-md-gh49-*.log`에 있다.

Box 공유 pin 반영 후 타입·빌드·Rust fmt·workspace all-targets check를 통과했다. root unit 202개(미변경 패키지 4개의 Turbo 결과 재사용, desktop 50개 실제 실행)와 관련 사이트 브라우저 8개를 통과했다. 기본 검증에서 이전 사이트 브라우저 테스트의 fixture 문자열 `document`가 DOM 전역을 가리는 타입 오류를 발견해 `globalThis.document`로 명시했다. 제품의 브라우저 동작은 바꾸지 않았다. 이 Chromium/IPC adapter 회귀는 native 창 증거를 대신하지 않는다.

Box 로그: `/tmp/box-md-gh49-box-{types,build,fmt,rust,tests,site-browser}.log`. Rust check에는 변경하지 않은 AW core의 기존 경고가 있으며 검사 exit code는 0이다. 결과는 gh-49 handoff에서도 commit 및 로그와 함께 기록한다.

## 다음 구현

이 단위는 공용 호스트 기반이다. Box 문서 도구가 discovery되거나 native 앱에서 자동 실행된다고 주장하지 않는다. [계획](document-mcp-implementation-plan.md)에 따라 gh-50의 scoped document service, gh-51의 handler/schema/독립 관계, gh-52의 native grant와 AW ACP·dirty UI 연동, gh-53의 실제 설치 agent/native 전수 검증을 이어간다. 부모 gh-20은 해당 결과가 모두 증명된 뒤 완료한다.
