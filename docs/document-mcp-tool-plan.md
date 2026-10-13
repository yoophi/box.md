# 문서 MCP 도구 순차 구현 (gh-51)

2026-10-13 기준 AW vendor pin `9ee73897ec04476d145536881381b5da313ea8cc`의 `local-mcp-server`를 소비한다. 공용 host의 factory/authorize/principal SPI와 rmcp 3.5.1 예제·실제 HTTP 테스트를 읽어 아래 구현 경계를 정했다. AW vendor와 사용자의 AgentChatSheet 변경은 수정하지 않는다.

같은 날 gh-72에서 최신 AW main `760415c497f41081cba73a011981f2159c118de0`로 vendor를 업데이트했다. 위 공유 MCP/client/UI source는 두 pin에서 동일하며 구현 경계는 유지한다. [업데이트 검증](aw-vendor-upgrade.md)을 따른다.

## 순서와 완료 조건

| 순서 | 단위 | 완료 증거 |
| --- | --- | --- |
| 1 · gh-69 | 문서 읽기·쓰기 도구 | 실제 loopback discovery와 목록/조회/검색/생성/복제/수정/삭제/복구/metadata 읽기·patch, schema/runtime 검증과 실제 파일·CAS/재시도 |
| 2 · gh-70 | 본문 링크·독립 연결 도구 | gh-18 문법과 code block 제외, 해결 상태/backlinks 및 별도 연결 entity/membership 도구, 본문 저장과 독립·재시도/수명 |
| 3 · gh-71 | 전체 HTTP 통합 감사 | 부모 gh-51의 모든 도구 및 metadata/관계/CAS/disconnect/auth/scope/민감정보 비노출을 실제 HTTP/파일 결과로 대조 |

gh-69는 완료된 gh-64, gh-70은 gh-69, gh-71은 gh-70에 의존한다. gh-51의 최종 검토는 gh-71 뒤에 수행한다. 세 단위 모두 gh-51 하위 task로 등록했으며 기존 부모 선행 관계를 유지한다.

## adapter와 application 경계

Box의 inbound MCP handler가 도구 이름과 입력/출력 JSON schema를 제공한다. 고정 필드 객체는 serde의 `deny_unknown_fields` 및 값 검사를 함께 사용한다. path/permalink union은 기존 `DocumentRef`를 사용하고 path는 루트 상대 Markdown 경로만 허용한다. schema를 광고하는 것만으로 runtime 검증을 대신하지 않는다.

인증 callback은 자격 증명을 불투명한 principal로 바꾸고 host가 원문 Authorization을 제거한다. handler는 매 호출의 principal에서 고정된 `DocumentScope`를 얻는다. 에이전트에게 root/generation 인자를 받거나 factory에 ambient 현재 루트를 고정해 모든 principal이 공유하게 하지 않는다. 별도 root principal은 해당 scope만 접근하며 retired scope는 application admission에서 거부된다. native 세션 전용 grant 발급/폐기 자체는 gh-52에 남긴다.

파일 I/O·잠금 및 ticket 대기는 blocking executor에서 실행한다. 변경은 `DocumentScope::submit_mutation`을 거쳐 기존 동일 service mutex/CAS/history/owned worker/journal을 사용한다. HTTP 응답 future가 사라져도 수락한 worker는 완료되어 재시도할 수 있다. 조회는 기존 admitted application API를 호출한다. 신규/복제는 서버에서 날짜·난수 ID를 결정하며 임의 filename을 입력받지 않는다. 삭제는 복구 trash와 `restore_document` 도구를 함께 제공한다.

성공은 `{ok:true,data:{...}}`, 업무·인자 오류는 `{ok:false,error:{code,message,currentRevision?}}`와 `isError:true`로 반환한다. structuredContent와 동일 JSON text를 SDK 결과 생성기로 제공하며 output schema에는 성공과 오류를 모두 포함한다. 알 수 없는 tool과 잘못된 JSON-RPC는 protocol 오류로 구별한다. adapter 오류 원문과 절대 경로를 message에 복사하지 않는다. 문서의 사용자 작성 본문은 data로 반환하는 정상 자료다.

목록/검색은 기존 경고·truncated·generation/index cursor 계약을 그대로 사용한다. 경로 이동 뒤 permalink 재해석, 중복/없음, stale cursor/CAS와 unknown key·잘못된 타입은 실제 HTTP 결과로 확인한다. raw frontmatter 및 comments/BOM/CRLF와 기존 custom ID 일반 저장은 이미 검증한 공통 application을 재사용하고 handler 입력·결과도 대조한다.

## 검증 범위와 후속

새 adapter는 실제 ephemeral TCP host와 임시 capability filesystem을 사용해 검증한다. 호출을 직접 함수에만 전달하거나 mock 파일 상태로 실제 HTTP/파일 완료를 주장하지 않는다. output schema와 structured/text 일치, 재시도 결과와 파일/이력 개수, scope/auth 오류에서 민감 경로 미노출을 확인한다. 관련 Rust 검사와 프로젝트 기본 types/build/fmt/all-targets를 수행하고 단위별 문서·commit/push를 남긴다.

최신 native host/grant·AW ACP session 주입·main UI 외부 변경/dirty 보호는 gh-52, 설치 HTTP-capable agent와 macOS 전체 수용 기준은 gh-53이다. 이 단계의 HTTP fixture는 해당 실행을 대신하지 않는다.

근거: [부모 MCP 계획](document-mcp-implementation-plan.md), [AW 공용 host](../vendor/agentic-workspace/docs/local-mcp-server.md), [scope 서비스](document-workspace-service.md), [mutation 수명](document-mutation-lifecycle.md), [생성·복제 감사](document-creation-duplication-acceptance-audit.md), [MCP tools 규격](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
