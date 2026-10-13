# 문서 MCP 도구 (gh-69)

Box inbound의 `DocumentMcpHandler`는 AW 공용 `local-mcp-server`가 재내보내는 rmcp 3.5.1 `ServerHandler`를 구현한다. 현재 vendor pin은 `760415c`이며 공유 MCP 호스트 source는 이전 pin과 동일하다. 실제 loopback HTTP에서 문서 도구 10개를 discovery하고 capability filesystem에 실행했다. 앱의 native grant/session 시작 연결은 gh-52의 후속 작업이며 이 handler가 현재 앱에서 자동 시작된다는 뜻은 아니다.

## 도구와 계약

| 도구 | 필수 입력 | 성공 data |
| --- | --- | --- |
| `list_documents` | 없음 (`cursor?`, `limit?`) | documents, nextCursor?, warnings, truncated |
| `read_document` | document | document snapshot |
| `search_documents` | query (`cursor?`, `limit?`) | matches/excerpts, nextCursor?, warnings, truncated |
| `create_document` | content, requestId | 서버 결정 ID 파일과 permalink의 snapshot |
| `duplicate_document` | document, expectedRevision, requestId (`content?`) | 새 ID 파일과 title 사본의 snapshot |
| `update_document` | document, content, expectedRevision, requestId | 저장 snapshot |
| `delete_document` | document, expectedRevision, requestId | deleted, 복구용 trashId, historyWarning |
| `restore_document` | trashId, requestId | 복구 snapshot |
| `get_document_metadata` | document | path, revision, metadata, permalink?, summary? |
| `update_document_metadata` | document, patch, remove, expectedRevision, requestId | document와 metadata projection |

document는 `{path: "relative.md"}` 또는 `{permalink: "id"}` 중 하나다. 두 필드 동시 지정, 빈 참조, 알 수 없는 필드, null/잘못된 타입을 거부한다. path는 capability 저장소에서 상대 Markdown 경로를 검증하며 traversal·절대 경로·관리 디렉터리·symlink 탈출을 허용하지 않는다. 생성/복제에 filename/root 인자를 받지 않는다.

목록 개수는 1~100이며 기본값은 50이다. cursor는 작업 generation, 관찰한 index와 검색어에 묶인다. 다른 principal/root의 cursor 또는 변경 뒤 cursor는 staleCursor다. 목록/검색의 경고와 truncation을 그대로 반환한다. metadata patch의 사용자 key는 허용하지만 고정 도구 필드의 추가 key는 허용하지 않는다. advertised schema의 제한된 keyword 집합을 runtime에서 검사하고, serde·application의 domain/byte/node 제한도 실행한다.

성공은 `{ok:true,data:{...}}`, 알려진 도구의 인자·업무 오류는 `{ok:false,error:{code,message,currentRevision?}}`와 isError=true다. 모든 도구에 두 경우를 포함하는 output schema를 제공한다. SDK 생성기로 structuredContent와 같은 JSON text를 반환한다. unknown tool은 JSON-RPC -32601이며 잘못된 protocol 구조는 SDK 오류로 구별한다. adapter exception·입력 인자·절대 경로·credential을 error message로 복사하지 않는다.

## 범위와 변경 수명

인증 callback의 `DocumentPrincipal`에는 고정된 `Arc<DocumentScope>`만 넣는다. credential은 포함하지 않는다. handler는 매 요청의 authenticated extension에서 principal을 얻고, backend가 이미 선택한 범위에만 접근한다. 서로 다른 principal의 scope와 journal은 분리된다. retired scope는 새 도구 변경을 scopeRevoked로 거부한다. host authorize에서 credential을 폐기하면 HTTP 401이다. 실제 세션별 grant registry와 native ACL은 gh-52에서 연결한다.

조회·파일 I/O와 mutation ticket 대기는 Tokio blocking executor에서 실행한다. 변경은 UI와 동일한 scope admission, service mutex, CAS, Git history 및 requestId registry를 사용한다. 수락된 worker와 완료 기록은 HTTP 응답 future가 소유하지 않는다. 재시도는 최초 생성 ID/파일/결과를 반환하고 다른 payload로 같은 ID를 사용하면 requestIdConflict다. stale revision에서 관찰한 currentRevision은 공통 오류 객체와 최초 journal 결과에 보존되므로 디스크가 이후 바뀌어도 같은 요청의 충돌 결과를 재계산하지 않는다. adapter의 오류 원문은 계속 일반 메시지로 정리한다.

신규/복제 정책은 [생성·복제 서비스](document-creation-duplication-service.md)를 따른다. 복제의 raw frontmatter 주석·BOM/CRLF·nested metadata 및 본문과 원본 파일을 유지한다. 삭제/복구는 기존 trash/no-clobber application 경로를 사용한다. 일반 저장의 기존 custom ID/파일명은 유지한다. 본문 링크와 독립 연결 도구는 gh-70에서 추가하며 전체 부모 감사는 gh-71이다.

## 실행 검증

```sh
pnpm test:document-mcp
```

이 명령은 임시 실제 TCP host와 capability filesystem을 사용한 Rust 회귀를 실행하고 HTTP structured output을 임시 JSONL에 기록한다. 별도 Ajv 8.20.0 JSON Schema 2020-12 engine이 실제 응답 44개/문서 도구 10개의 schema 적합성을 검사한다. schema evidence 경로는 출력하며 runtime validator 자체를 유일한 output 검증기로 사용하지 않는다. Ajv는 이미 lock에 존재하던 package를 직접 devDependency로 지정했다.

HTTP 회귀 5개는 discovery/모든 도구, ID 파일·raw 복제·metadata·trash 복구, unknown key/type/tool, CAS/currentRevision·requestId, live permalink 이동/중복/없음, 인증·두 scope·retirement·symlink 및 cursor를 검사한다. TCP 연결 유실 검사는 파일 공개 뒤 history를 barrier에서 대기시킨 상태로 실제 client socket을 닫는다. 이후 같은 requestId의 HTTP 재시도가 같은 파일/내용을 반환하고 파일 한 개·Git 이력 한 개를 유지함을 확인했다.

앱 Rust library 74개 및 helper subprocess 3회, document-store의 파일 16개/metadata 16개와 fmt 검사, types/build가 통과했다. workspace all-targets compile 결과는 작업 log에 기록한다. frontend source는 gh-72 이후 변경하지 않았고 그 단위의 TypeScript 244개 결과를 유지한다. 로그는 `/tmp/box-md-gh69-{schema-tests,http-tests,native-tests,store-tests,fmt,rust,types,build}.log`다. 현재 production에서 아직 사용하지 않는 handler/service의 dead-code 및 기존 chunk 경고는 남아 있다.

실제 설치 ACP agent나 최신 macOS 창이 이 도구를 사용했다는 검증은 아니다. native grant/ACP 주입·UI 외부 변경/dirty 보호는 gh-52, 실제 provider/native 전체 감사는 gh-53에 남아 있다.

관련 source: [handler](../apps/box-desktop/src-tauri/src/inbound/document_mcp.rs), [schemas](../apps/box-desktop/src-tauri/src/inbound/document_mcp/schemas.rs), [HTTP 검사](../apps/box-desktop/src-tauri/src/inbound/document_mcp/tests.rs), [독립 schema 검사](../scripts/test-document-mcp.mjs), [공통 mutation](../apps/box-desktop/src-tauri/src/application/document_mutations.rs), [구현 순서](document-mcp-tool-plan.md).
