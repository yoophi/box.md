# 문서 MCP 전체 HTTP 수용 기준 감사 (gh-71 / gh-51)

현재 Box handler는 AW vendor `760415c`의 `local-mcp-server`와 rmcp 3.5.1을 사용한다. 실제 ephemeral loopback 서버, 두 capability filesystem 작업 루트, 프로필 연결 저장소와 Git 문서 이력으로 부모 gh-51의 기준을 검증한다. fixture의 credential registry는 테스트용이다. 앱의 native grant 발급과 ACP 세션 주입은 gh-52, 실제 설치 agent 및 최신 native 창 검증은 gh-53에 남는다.

## 기준별 증거

| gh-51 요구 | 구현 및 실행 증거 |
| --- | --- |
| 실제 discovery와 모든 도구 호출 | `discovery_and_all_document_tools_use_real_http_files_and_common_results`가 initialize/tools/list와 문서 도구를 실제 HTTP로 호출한다. 본문·관계 회귀를 합쳐 광고된 15개 모두의 실제 응답을 별도 Ajv JSON Schema 2020-12로 검증한다. |
| 입력 runtime 및 출력 schema, structured/text, 업무·protocol 오류 구분 | 모든 광고 도구에 schema-valid 기본 입력과 unknown field를 제출하는 전체 도구 감사, 기존 잘못된 type·union·required field·unknown tool 회귀. `Fixture.call_as`는 structuredContent와 JSON text 및 isError 일치를 검사한다. 출력은 별도 Ajv로 재검증한다. |
| permalink 이동·중복·없음 | 두 principal의 live read, 파일 rename/copy와 missing ID 회귀. 본문 목표 상태 및 membership duplicate/partial/move/missing 필터 회귀는 임의 경로 선택을 거부한다. |
| frontmatter 및 원문 보존 | BOM/CRLF/주석/nested unknown metadata의 생성·patch·복제·삭제·복구 HTTP 결과와 실제 file byte를 대조한다. 원본과 복제 ID/title 정책은 기존 생성·복제 계약을 따른다. |
| CAS와 requestId 재시도 | stale revision과 관찰 currentRevision, payload 재사용 거부, 최초 생성 ID/결과와 파일·Git 이력 개수 검사. metadata/delete/restore와 capacity는 공유 application 회귀로 보강한다. |
| 실제 HTTP 연결 유실 이후 수락 변경 완료 | 문서 history 및 연결 profile persist의 barrier에서 실제 TCP socket을 닫고 같은 requestId 재시도를 검사한다. owned worker가 단일 파일/엔티티·이력 결과를 유지한다. 실제 Workspace.select는 accepted 작업 drain 뒤 새 root를 공개한다. |
| 본문 링크와 명시적 관계 독립성 | 공통 TS/Rust 문법 fixture와 실제 body/backlinks 결과, 본문·metadata ID/title 변경 및 삭제 후 profile byte 불변, 다대다 공유/부분 해제/동시 요청과 다른 관계·두 원본 보존. |
| 인증 및 범위 오류의 민감정보 미노출 | 15개 도구 전부의 폐기된 scope 오류와 credential 폐기 HTTP 401, unknown field marker 비노출, 다른 principal의 정상 동작을 검사한다. 문서 참조 8개 도구 모두에 traversal·외부 절대 경로·외부 symlink를 제출하고 두 root 원본과 profile/trash 무변경 및 오류의 root/input marker 비노출을 확인한다. |
| Host/Origin·protocol·요청 크기·종료 | 같은 공용 호스트의 실제 HTTP 13개 검사가 모든 method 인증, credential 즉시 폐기, Host/Origin, 명시 allowlist, protocol version, body limit/invalid JSON, 두 host/principal 격리와 shutdown/stop admission을 검사한다. Box fixture는 기본 HostConfig와 같은 host SPI를 사용한다. |
| 기본 검사·문서·작업 커밋 | 아래 실행 결과와 관련 도구 계약 문서 및 gh-71 단위 커밋. 사용자 AgentChatSheet 두 파일은 유지하며 커밋에 포함하지 않는다. |

## 실행 결과

실행 로그는 `/tmp/box-md-gh71-{host,http-schema,types,build,native,fmt,rust}.log`다.

| 명령 | 결과 |
| --- | --- |
| AW `cargo test --manifest-path vendor/agentic-workspace/crates/local-mcp-server/Cargo.toml --locked` | 실제 HTTP 13개 통과 |
| `CARGO_INCREMENTAL=0 pnpm test:document-mcp` | 실제 HTTP 15개 통과, 독립 Ajv 실제 응답 143개/15도구 검증 |
| `cargo test -p box-desktop --lib --locked` | 앱 87개 통과, helper 1개 ignored 및 subprocess 3회 각각 통과 |
| `pnpm check-types`, `pnpm build` | 성공 |
| `cargo fmt --all -- --check` | 성공 |
| `cargo check --workspace --all-targets --locked` | 성공 |

추가 변경은 감사 회귀와 문서다. production API, dependency 및 vendor pin은 변경하지 않았다. 현재 앱에서 아직 시작하지 않는 MCP adapter의 dead-code와 기존 frontend chunk 경고는 남아 있다. 문서 링크와 diff 검사도 확인했다.

## 범위와 후속

이 감사는 HTTP adapter와 application/공용 호스트의 실행 근거다. 실제 provider가 세션별 MCP grant를 받아 도구를 사용하거나 native 화면이 외부 편집을 반영했다는 근거로 사용하지 않는다. gh-52는 host/grant·ACP 주입·main 변경 이벤트와 dirty/undo 보호를 구현하고, gh-53은 설치된 agent 및 native 전체 기준을 검사한다. 부모 gh-20의 기존 의존성과 범위를 유지한다.

관련 문서: [도구](document-mcp-tools.md), [본문 링크](document-mcp-links.md), [독립 연결 및 gh-70 감사](document-mcp-connections.md), [도구 계획](document-mcp-tool-plan.md), [부모 계획](document-mcp-implementation-plan.md), [mutation 수명](document-mutation-lifecycle.md), [AW 호스트](../vendor/agentic-workspace/docs/local-mcp-server.md).

검증 source: [Box 실제 HTTP](../apps/box-desktop/src-tauri/src/inbound/document_mcp/tests.rs), [출력 독립 validator](../scripts/test-document-mcp.mjs), [schema](../apps/box-desktop/src-tauri/src/inbound/document_mcp/schemas.rs), [공유 application](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [AW 실제 HTTP](../vendor/agentic-workspace/crates/local-mcp-server/tests/http.rs).
