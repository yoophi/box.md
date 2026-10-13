# 문서 MCP 구현 계획 (gh-20)

2026-10-13 기준 구현 계약과 작업 순서다. 문서 도구는 아직 구현되지 않았다. gh-49에서 [공용 HTTP 호스트 기반](document-mcp-host-integration.md)을 구현했으며 문서 handler·native grant·ACP 연동은 후속 작업으로 남아 있다. 부모 gh-20의 수용 기준 1~9와 기존 gh-3 의존성을 유지한다. 공식 규격·버전 근거는 [프로토콜 조사](document-mcp-protocol-research.md)를 따른다.

## 현재 코드와 재사용 경계

| 현재 구현 | 재사용 또는 필요한 확장 |
| --- | --- |
| AW `SessionOptions`의 `mcpServers`, HTTP `run.createSession` 요청 | 기존 [공유 client](../vendor/agentic-workspace/packages/workbench-agent-client/src/client.ts)를 사용한다. Box에서 ACP process/stdio client를 다시 만들지 않는다. |
| AW [MCP 서버](../vendor/agentic-workspace/crates/workbench-host/src/mcp/mod.rs) | `WorkbenchRuntime`과 전용 도구 dispatch에 결합돼 있다. Box handler를 받는 별도 공용 HTTP 호스트를 AW에 추가한다. |
| Box [DocumentService](../apps/box-desktop/src-tauri/src/application/document_service.rs) | 원자 파일 저장, revision 비교, 저장 이력을 UI와 MCP가 같은 application 경로에서 사용한다. 목록·삭제·metadata·scope 기능을 확장한다. |
| [FsDocumentRepository](../apps/box-desktop/src-tauri/src/infrastructure/fs_document_repository.rs) | 절대 경로 Markdown 저장소다. MCP 인자를 직접 전달하지 않는다. 현재 루트에 고정된 filesystem port/adapter를 마련한다. |
| [frontmatter 편집](../packages/editor/src/metadata.ts) | gh-55에서 [Rust adapter](frontmatter-rust-adapter.md)를 구현했다. 31개 공통 fixture로 문자열 계약과 본문 보존을 확인하며, gh-56에서 application에 통합한다. |
| [문서 workspace 상태](../apps/box-desktop/src/features/manage-document/model/use-document-workspace.ts) | focus 시 목록 갱신만으로 외부 내용 변경 반영을 증명할 수 없다. 변경 이벤트, revision 재조회와 dirty 충돌 처리가 필요하다. |

## AW 공용 라이브러리 계획

AW의 별도 작업 브랜치에서 `crates/local-mcp-server`를 Cargo workspace에 등록한다. 기존 사용자의 AW main checkout과 Box vendor 파일을 직접 편집하지 않는다. 공용 crate에는 Box 문서, Tauri, `WorkbenchRuntime` 의존성을 넣지 않는다.

- 공식 `rmcp = "=3.5.1"`와 lockfile을 사용한다. Rust 1.88 이상 및 실제 workspace dependency 호환성을 compile로 확인한다.
- `ServerHandler` factory를 받아 `/mcp` Streamable HTTP를 제공한다. 초기 지원 버전은 2025-11-25이며 stateless/JSON 응답을 사용한다. initialize, initialized, tools/list, tools/call 처리는 SDK에 맡긴다.
- 호스트는 `127.0.0.1:0` listener, 종료 handle, 정확한 Host/Origin 정책, 모든 HTTP method에 적용되는 인증 callback을 받는다. SDK 기본 Origin 검증 OFF를 그대로 사용하지 않는다.
- 인증 callback의 결과는 요청 extension으로 전달한다. 문서 권한 판단, 토큰 발급/폐기 및 받아들인 파일 변경의 drain은 Box application이 소유한다.
- generic 예제 handler와 실제 HTTP protocol 테스트를 제공한다. Workbench의 기존 orchestration 도구를 Box 전용 도구로 바꾸지 않는다. 기존 MCP 서버 전체 마이그레이션은 이 기능의 선행 조건이 아니다.
- AW 작업 커밋과 브랜치를 push한 뒤 Box submodule을 그 커밋에 고정한다. HTTP ACP 공유 client와 UI 공유 변경이 포함된 기존 pin의 기능을 유지한다.

AW에도 [공유 호스트 계획](https://github.com/yoophi/agentic-workspace/blob/2cd01eff03f266cd50ca0e5176b7eee9ad72a508/docs/shared-document-mcp-host-plan.md)을 기록하고 `box-md-document-mcp` 브랜치를 push했다. 계획 커밋은 `2cd01eff03f266cd50ca0e5176b7eee9ad72a508`이다. gh-49 구현 커밋과 Box vendor pin은 `9ee73897ec04476d145536881381b5da313ea8cc`이며 이전 공유 HTTP ACP/UI 변경을 포함한다. 현재 API와 검증 범위는 [AW 호스트 사용법](../vendor/agentic-workspace/docs/local-mcp-server.md)을 따른다.

## 문서 도구 계약

도구명은 아래 계약으로 고정하고 구현 시 JSON Schema와 runtime validation을 함께 제공한다. 고정 필드의 계약 객체는 지정하지 않은 필드를 거부한다. 사용자 metadata와 patch 객체는 유효한 사용자 key를 허용한다. 경로는 루트 상대 경로이며 절대 경로를 입출력으로 사용하지 않는다.

`DocumentRef`는 `{permalink: string}` 또는 `{path: string}` 중 하나다. permalink 조회는 매 요청 현재 저장소에서 정확히 한 문서를 찾는다. 중복이면 임의 파일을 선택하지 않는다. path 참조는 아직 permalink가 없는 기존 문서를 다룰 수 있게 하며 permalink 참조 지원을 대체하지 않는다.

| 도구 | 입력 | 성공 data |
| --- | --- | --- |
| `list_documents` | `cursor?`, `limit?` (1~100, 기본 50) | `documents: [{path, permalink?, summary?, revision}]`, `nextCursor?`, `warnings`, `truncated` |
| `read_document` | `document: DocumentRef` | `document: {path, permalink?, content, revision}` |
| `search_documents` | `query`, `cursor?`, `limit?` | `matches: [{path, permalink?, revision, excerpts}]`, `nextCursor?`, `warnings`, `truncated` |
| `create_document` | `path`, `content`, `requestId` | 새 문서 snapshot. 기존 파일을 덮어쓰지 않는다. |
| `update_document` | `document`, `content`, `expectedRevision`, `requestId` | 저장된 snapshot 및 `historyWarning?` |
| `delete_document` | `document`, `expectedRevision`, `requestId` | `deleted: {path, permalink?, revision}`, 복구용 `trashId` |
| `get_document_metadata` | `document` | `path`, `revision`, `metadata` (JSON 객체), `permalink?`, `summary?` |
| `update_document_metadata` | `document`, `patch: object`, `remove: string[]`, `expectedRevision`, `requestId` | 저장된 snapshot 및 metadata |
| `get_document_links` | `document` | 본문 wikilink token·대상 permalink·해결 상태 및 backlinks |
| `list_connections` | `document?` | 명시적 중간 연결 엔티티 ID·이름·문서 memberships |
| `create_connection` | `name`, `requestId` | 별도 연결 엔티티 |
| `attach_connection` / `detach_connection` | `connectionId`, `permalink`, `requestId` | 갱신된 명시적 관계. 다른 문서·관계·본문은 보존한다. |

검색은 문서 본문·요약·permalink를 대상으로 하는 대소문자 무시 literal 검색이다. 결과 excerpt는 제한한다. 목록과 검색의 scan 한계·읽기 실패는 `warnings`와 `truncated`로 표시하며 완전한 검색으로 오인하게 하지 않는다. cursor는 루트 generation과 index revision에 묶으며 저장소가 바뀌면 `staleCursor`로 재시작을 요구한다.

`create_document`는 유효한 frontmatter를 검사하며 permalink가 없으면 UUID를 추가한다. 모든 저장은 현재 workspace 내 permalink 중복을 거부한다. metadata patch는 최상위 key 변경이며 `patch`와 `remove`가 같은 key를 지정하면 실패한다. `summary`와 `permalink`는 한 줄 문자열 계약을 유지한다. 저장되지 않은 permalink 변경 때문에 기존 관계가 다른 문서로 옮겨가지 않는다. 알 수 없는 nested 값과 주석을 유지하고 본문을 byte 단위로 보존해야 하며, 이 조건을 만족하는 서버 YAML adapter를 확정하기 전 손실 있는 전체 재직렬화를 채택하지 않는다.

삭제는 `.box.md/trash` 아래 복구 가능한 저장으로 구현한다. 성공은 원본과 복구 데이터를 안전하게 이동한 뒤 반환하며 기존 history와 별도 connection 데이터는 유지한다. 삭제된 문서의 관계는 unresolved로 표시한다. hidden 관리 디렉터리는 일반 문서 목록/검색에서 제외한다. title/path 변경은 permalink를 바꾸지 않으며 기존 index를 영구 ID 저장소로 오인하지 않는다.

본문 wikilink는 gh-18의 문법과 code block 제외 규칙을 따른다. 명시적 연결은 gh-19의 별도 저장소·service를 사용한다. 본문 저장으로 연결 엔티티나 membership을 생성/삭제하지 않는다.

모든 도구 결과는 `{ok: true, data: object}` 또는 `{ok: false, error: {code, message, currentRevision?}}` 객체다. `structuredContent`와 동일 JSON text를 제공한다. output schema는 두 결과를 모두 포함한다. 알려진 도구의 업무·인자 오류는 `isError: true`; 알 수 없는 도구 및 잘못된 JSON-RPC 구조는 protocol error다.

| 오류 code | 처리 |
| --- | --- |
| `invalidArguments`, `invalidPath`, `invalidMetadata` | 입력/Markdown/metadata 오류를 알리고 쓰지 않는다. |
| `notFound`, `missingPermalink`, `duplicatePermalink` | 문서가 없거나 식별이 모호하다. 임의 선택/자동 복구하지 않는다. |
| `conflict` | revision이 바뀌었다. 현재 revision을 반환하고 재조회 후 새 변경을 요구한다. |
| `requestIdConflict`, `requestCapacityExceeded` | 다른 payload로 재사용한 mutation ID 또는 scope 내 처리 한도 초과. 쓰지 않는다. |
| `scopeRevoked`, `workspaceUnavailable`, `staleCursor` | 작업 디렉터리 변경·권한 폐기·접근 불가·낡은 목록 상태를 구별한다. |
| `encoding`, `io`, `internal` | 민감 경로나 토큰을 제외한 읽을 수 있는 오류. 채팅은 유지한다. |

인증 실패는 HTTP 401, 허용하지 않은 Origin은 403이다. 도구 오류에 bearer token, app 설정, 절대 파일 경로를 넣지 않는다.

## 저장, 범위와 UI 충돌

서버는 사용자 설정으로 선택한 루트의 directory handle과 generation을 소유한다. 에이전트가 루트나 절대 경로를 지정할 수 없다. 상대 경로의 traversal, symlink escape, symlink 교체 중 read/write/delete가 범위를 벗어나지 않도록 filesystem capability/handle 기반 adapter를 구현한다. 단순히 canonicalize한 뒤 기존 absolute-path 저장소를 다시 호출하는 검사만으로 이를 완료했다고 판단하지 않는다.

UI와 MCP의 저장은 같은 DocumentService 및 mutation lock을 사용한다. 변경 요청은 mandatory `expectedRevision`으로 현재 파일을 비교하고 새로운 revision과 이력을 기록한다. 저장소 adapter를 확장해 UI의 기존 직접 열기/다른 이름 저장 흐름도 보존한다. 외부 일반 editor와의 원자적 CAS는 현재 파일 API만으로 보장된다고 주장하지 않으며 감지 가능한 충돌은 덮어쓰기 전에 반환한다.

`requestId`는 scope 내 재시도 식별자다. 같은 ID·같은 인자는 최초 결과를 반환하고 다른 인자는 실패한다. 인증된 요청을 수락한 뒤 작업을 서버 소유 task로 완료해 HTTP disconnect만으로 저장 중단/중복을 만들지 않는다. 종료는 신규 수락을 막고 수락 작업을 drain한다. 초기 dedupe는 scope 수명 동안 보장한다. 완료 기록을 조용히 eviction하지 않고 용량 초과를 거부한다. 앱 재시작 후 기존 자격 증명은 폐기되므로 재시작을 넘어선 mutation 재시도 성공은 광고하지 않는다.

파일 변경 이벤트는 `{workspaceGeneration, path, revision?, kind}`를 main 앱에 전달한다. 목록은 갱신하고, 열린 clean 문서는 최신 snapshot으로 반영한다. dirty 문서는 편집기 content·undo·baseline을 유지한 채 외부 변경/삭제를 표시하고 기존 다시 불러오기/다른 이름 저장/명시적 덮어쓰기 흐름을 사용한다. stale async 응답과 다른 root의 이벤트가 현재 문서를 바꾸지 않도록 generation을 확인한다.

## ACP 주입과 수명

1. main 앱이 session 생성 시 작업 디렉터리와 예정된 AW `runId`로 문서 MCP grant를 요청한다. 허용된 main WebView에서만 Tauri command를 호출할 수 있다.
2. backend가 현재 generation에 연결된 세션 전용 자격 증명과 `{name: "box_documents", type: "http", url, headers: [{name: "Authorization", value: "Bearer …"}]}`를 반환한다.
3. 기존 `useAgentChat`에서 다른 MCP 설정을 보존하며 이 설정을 `SessionOptions.mcpServers`에 추가한다. 실제 AW HTTP `run.createSession`과 ACP `session/new`에 도달한 것을 통합 테스트로 확인한다.
4. 생성 실패·결과 불명은 AW run 상태를 확인하고 소유한 grant를 정리한다. 정상 session close/EOF/앱 종료에서도 폐기한다. 단순 패널 collapse는 grant/session을 닫지 않는다.
5. 작업 디렉터리를 바꾸면 이전 root grant를 폐기한다. 이전 채팅·대화는 보존하되 도구 범위가 종료됐음을 알린다. 새 session은 새 root grant를 사용한다. 진행 중 이미 수락된 변경과 root 전환은 직렬화해 완료/폐기 결과를 구별한다.
6. MCP 준비·호출 실패는 재시도 가능한 메시지로 보인다. grant 없이도 일반 채팅을 선택해 사용할 수 있고 앱/채팅 전체가 종료되지 않는다. 인증 header는 로그·snapshot UI·문서에 출력하지 않는다.

AW [ACP runner](../vendor/agentic-workspace/crates/acp-agent-core/src/infrastructure/acp/runner.rs)는 initialize 응답의 `mcpCapabilities.http`가 false이면 전달할 HTTP MCP 목록을 비운다. 따라서 client 요청에 설정이 있다는 것만으로 agent 주입 성공을 주장하지 않는다. 해당 상태를 공유 HTTP 이벤트/오류 계약에서 확인해 UI에 도구 사용 불가를 알리고, 실제 HTTP MCP capability를 광고하는 설치 agent로 마지막 검증을 수행한다. 필요한 상태가 공유 client에 없으면 AW에서 공개 계약을 확장한다.

추가 Tauri command는 `invoke_handler`, `build.rs` AppManifest, main capability를 함께 등록한다. 외부 사이트 child WebView에는 문서 MCP credential command 권한을 주지 않는다.

## 순차 하위 작업과 부모 기준

| 순서 | 작업 | 선행 | gh-20 기준 |
| --- | --- | --- | --- |
| 1 (gh-48) | 계약·공식 조사·AW 재사용 경계·작업 등록 | 완료된 gh-7, gh-23 | 1~9 설계/추적, 8 |
| 2 (gh-49) | AW generic HTTP MCP host, protocol/auth 테스트, branch push, Box pin | gh-48 | 5, 6, 8 기반 |
| 3 (gh-50) | scoped 문서 service·permalink·lossless metadata·CAS·복구 삭제 | gh-49 | 1, 2, 4, 6 |
| 4 (gh-51) | MCP 도구 handler/schema·본문 링크/명시적 연결 구분·실제 HTTP 읽기/쓰기 | gh-50, 완료된 gh-18/gh-36/gh-39 | 1, 2, 5, 6, 7, 8 |
| 5 (gh-52) | native host/grant·AW ACP 주입·UI 갱신/dirty 보호·오류 복구 | gh-51, 완료된 gh-23/gh-32 | 3, 4, 5, 6 |
| 6 (gh-53) | 실제 설치 에이전트의 ACP 도구 사용·native 전수 감사 | gh-52, gh-3, gh-19 | 1~9 완료 판정 |

부모의 gh-3/gh-7 선행 관계는 유지한다. 독립 기반 작업은 기존 완료된 공유 HTTP client를 선행으로 삼아 진행하지만 실제 ACP 완료 게이트를 제거하지 않는다.

각 단위는 작업 커밋과 필요한 검증 결과를 남긴다. Rust/API 변경에는 프로젝트 기본 검증과 관련 실패/회귀 테스트를 실행한다. 공유 호스트의 실제 HTTP 테스트는 native 화면/실제 provider 검증을 대체하지 않는다. 마지막에는 부모 기준마다 구현 소스, 실행 결과, UI/native 화면 및 문서 근거를 연결해 감사한다. MCP fixture의 ACP 사용만으로 실제 설치 에이전트의 도구 사용을 통과 처리하지 않는다.

## gh-50 순차 하위 작업

부모 gh-50의 전체 수용 기준을 아래 작업으로 나눴다. gh-50은 gh-49와 마지막 통합 검증 gh-57에 의존하며, gh-20의 기존 gh-3 의존성과 gh-51~gh-53 순서를 유지한다.

| 작업 | 범위 | 선행 |
| --- | --- | --- |
| gh-54 | directory handle 기반 scoped filesystem, 실제 경로/race/CAS/복구 검증. [저장소 계약](scoped-document-store.md) | gh-49 |
| gh-55 | Rust lossless frontmatter adapter와 TS 공통 fixture. [조사와 채택 조건](frontmatter-rust-adapter-research.md) | gh-54 |
| gh-56 | 같은 DocumentService/UI 저장·이력 경로에 scoped 저장소/metadata 통합, permalink 조회, 목록/검색/변경, requestId dedupe와 accepted-task drain | gh-55 |
| gh-57 | gh-50 기준별 실제 파일·기존 command/service 통합 검증과 완료 감사 | gh-56, 완료된 gh-7/gh-12/gh-13 |

gh-54의 저장소 테스트는 metadata/application 구현이나 MCP/native/ACP 검증을 대신하지 않는다. UI 이벤트·dirty 보호와 grant/session 수명은 gh-52, 실제 macOS 화면과 설치 agent의 HTTP MCP 검증은 gh-53에 남아 있다.

## gh-56 서비스 통합 하위 작업

gh-58에서 [backend 작업 루트와 같은 DocumentService 공유](document-workspace-service.md)를 구현했다. native 절대 경로를 scope 상대 경로에 연결하며 기존 저장·이력 키를 유지한다. 기존 `WorkspaceService`는 native preview, 선택된 루트의 refresh는 capability 저장소를 사용한다. gh-56은 backend가 선택한 작업 루트의 handle/generation과 이 공유 application 경로를 연결하도록 다음 순서로 진행한다.

| 순서 | 작업 | 선행 | 검증 범위 |
| --- | --- | --- | --- |
| 1 (gh-58) | UI/scoped 경로의 같은 DocumentService·잠금·이력 공유, backend 작업 루트 및 native 경로 연결 | gh-55 | 실제 파일의 native/scoped save/revision/history, 기존 직접 열기/저장, main IPC 권한과 child 거부 |
| 2 (gh-59) | scoped 조회·검색·permalink index·metadata·CRUD/trash/restore application | gh-58 | missing/duplicate/rename, source/body 보존, CAS·동시쓰기·복구, scan/cursor 한계와 scope 오류 |
| 3 (gh-60) | requestId fingerprint/result dedupe, accepted mutation 소유 및 종료/루트 전환 drain | gh-59 | 재시도·다른 payload·응답 유실·용량·신규 거부·수락 작업 완료, UI와 같은 직렬화/이력 경로 |

gh-56은 기존 gh-55와 마지막 하위 작업 gh-60에 의존한다. gh-50의 전체 application 완료 감사는 gh-57에 남아 있으며, MCP handler/HTTP는 gh-51, grant/ACP·UI 이벤트와 dirty 보호는 gh-52, 실제 설치 agent와 macOS 화면은 gh-53에서 검증한다. 각 하위 작업의 구현·필요 검증 후 개별 커밋과 push를 진행한다.

gh-59의 [scoped 문서 application](scoped-document-application.md)은 같은 service 잠금에서 path/permalink 조회, 목록·검색/cursor, UUID 생성, metadata patch, CAS와 복구 삭제를 제공한다. 파일 목록의 불완전성을 경고하고 ID 고유성을 확인할 수 없는 쓰기는 거부한다. mutation 재시도·task 소유·drain은 gh-60에 유지한다.

## gh-48 설계 단위 검증

부모 gh-20의 기준1~9와 위 작업 배분을 대조했다. 기존 ACP 공유 client/core의 전달 경로와 capability 분기, 문서 service/repository, TS metadata 및 연결 저장소 소스를 읽어 재사용/확장 경계를 확인했다. 문서 두 개의 상대 링크를 검사해 누락이 없고 AW 계획 커밋의 remote branch SHA가 일치함을 확인했다. 하위 gh-49~gh-53은 모두 gh-20에 등록하며 위 선행 관계를 유지한다.

이번 단위는 조사·계약·작업 등록 문서만 변경한다. 코드 실행에 관한 기본 검증은 마지막 구현 gh-46 결과를 참고할 수 있지만 이 계획의 도구 구현 완료 근거로 사용하지 않는다. 공용 crate compile/HTTP 동작, Box 문서 도구, 실제 ACP 및 native 화면 검증은 각 후속 작업에 남아 있다.
