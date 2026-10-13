# 문서 생성·복제 서비스 (gh-66)

새 문서와 복제본의 ID/경로는 application이 결정한다. `DocumentIdentitySource` 뒤의 `LocalDocumentIdentity`는 로컬 `yyMMddHHmmss`와 OS random 4 byte를 소문자 hex 8자로 연결한다. 기존 lock의 chrono 0.4.45(clock)와 getrandom 0.4.3을 앱 직접 의존성으로 등록하며 기존 package identity는 유지했다. [Local API](https://docs.rs/chrono/latest/chrono/struct.Local.html)와 [fill API](https://docs.rs/getrandom/0.4.3/getrandom/fn.fill.html)를 따른다.

| 공통 operation | 입력 | 성공 결과 |
| --- | --- | --- |
| `create_document` | `content`, 별도 `requestId` | `{document: {path, content, revision, historyWarning, permalink}}` |
| `duplicate_document` | `document: {path} 또는 {permalink}`, `expectedRevision`, 선택적 `content`, 별도 `requestId` | 같은 document 결과 |

새 파일명/permalink/root 입력은 없고 unknown field를 거부한다. 서버가 새 ID를 frontmatter에 저장하고 선택한 루트의 `{ID}.md`를 생성한다. 일반 저장과 기존 ID/파일은 유지한다. 기존 저수준 path 생성/legacy `Create`는 이전 application 검증·내부 저장 계약용이다. 이 variant의 외부 역직렬화는 거부하며 UI 신규 생성과 후속 MCP `create_document`에는 사용하지 않는다.

같은 `DocumentService` mutex 안에서 ID 형식·파일 존재·전체 목록의 permalink 고유성과 metadata를 확인한다. 충돌이면 최대 32회 새 난수로 시도한다. 최종 no-clobber 저장에서도 다른 writer가 파일을 만들면 새 ID로 재시도한다. 반복 충돌은 `identityConflict`, 난수/형식 실패는 `identityUnavailable`이다. 불완전한 목록으로 고유성을 증명하지 않는다.

복제는 source expectedRevision을 검사한다. `content`가 없으면 저장된 원본, 있으면 화면의 미저장 원문을 복사한다. title은 `원래 title 사본`이며 없거나 빈 값이면 현재 앱 표시 제목인 source basename을 사용한다. permalink/title 외의 metadata·주석·BOM·CRLF·본문을 유지한다. source 파일/ID/이력과 별도 연결 데이터를 변경하지 않는다. 공개 직전에도 source revision을 확인한다.

worker·requestId fingerprint/최초 결과·응답 drop·root 전환/종료 drain·capacity는 [공통 수명](document-mutation-lifecycle.md)을 사용한다. 쓰기 전에 응답을 예약한다. 재시도 후보의 ID/path 길이와 내용 구조가 같으므로 예약을 유지하고 같은 requestId에는 최초 ID/파일 결과를 반환한다. 이력 오류는 저장 성공과 warning이다.

## Native 및 후속 MCP

main 전용 `create_document`는 `{generation, requestId, content}`, `duplicate_document`는 `{generation, requestId, document, expectedRevision, content?}`다. source path는 루트의 상대 경로다. 현재 generation이 아니면 `scopeRevoked`다. blocking executor에서 ticket을 기다리고 native 응답의 document path만 기존 UI의 절대 경로로 변환한다. MCP 공통 결과는 상대 경로를 유지한다. handler·AppManifest·main permission을 함께 등록하고 child WebView는 거부한다.

gh-51 MCP handler는 이 operation을 같은 `DocumentScope::submit_mutation`에 연결해야 한다. 현재 MCP 도구가 구현된 것은 아니다. gh-67은 native API를 사용하고 다른 이름 저장을 제거하며 요청 시작의 generation/document와 늦은 응답·root 전환에 대한 dirty/undo 보호를 적용해야 한다. 현재 frontend는 아직 교체 전이다.

## 검증

실제 파일 검사는 같은 초 생성·강제 file/ID 충돌·publication 직전 writer·32회 소진·최초 ID 재시도·capacity 실패·title/fallback·dirty 원문·metadata/주석/BOM/CRLF·원본/이력/연결 파일 불변·stale source·잘못된 ID/입력·accepted 생성의 root drain을 확인한다. adapter 3개 검사는 로컬 날짜/offset·hex byte·날짜 경계 정렬과 실제 OS source를 확인한다. mock Tauri IPC는 main에서 실제 파일 생성/복제·ID 파일명 일치·구 generation 거부와 remote/local child의 새 명령 거부를 확인한다.

실제 macOS UI 또는 설치 agent MCP 사용의 증거로 확대하지 않는다. UI는 gh-67, 부모 감사는 gh-68, MCP runtime/ACP/native 사용은 gh-51~53에 남아 있다. 로그는 `/tmp/box-md-gh66-*.log`에 기록한다.

현재 실행 결과는 앱 68개 통과(helper 1개 ignored와 subprocess 3회 각각 통과), 파일 저장소 16개·metadata 16개 통과다. types/build/Rust fmt/workspace all-targets 검사도 모두 exit 0이며 Cargo package identity·문서 상대 링크·diff를 확인했다. API 연결 후 앱의 dead-code 경고는 8개이고 기존 AW 경고는 남아 있다. 외부 AgentChatSheet 두 파일은 수정/커밋 대상에 포함하지 않는다.

소스: [ID port](../apps/box-desktop/src-tauri/src/ports/document_identity.rs), [OS adapter](../apps/box-desktop/src-tauri/src/infrastructure/document_identity.rs), [mutation](../apps/box-desktop/src-tauri/src/application/document_mutations.rs), [실행](../apps/box-desktop/src-tauri/src/application/prepared_mutations.rs), [작업 루트](../apps/box-desktop/src-tauri/src/application/document_workspace.rs), [native command](../apps/box-desktop/src-tauri/src/inbound/document_commands.rs), [실제 파일 검사](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [IPC](../apps/box-desktop/src-tauri/src/lib.rs).
