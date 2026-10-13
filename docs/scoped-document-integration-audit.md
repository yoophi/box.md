# Scoped 문서 application 통합 감사 (gh-56)

2026-10-13 현재 `gh-56`의 구현 범위와 수용 기준을 대조했다. 기반 구현은 gh-58(`f03ad40`), gh-59(`75741f6`), gh-62(`6cc8bc3`), gh-63(`cf4fa56`)이며 mutation 부모 감사는 gh-60(`3e260d5`)에 있다. 이번 작업은 이미 실행한 검증 결과와 현재 소스가 같은 요구사항을 증명하는지 확인한다.

## 수용 기준별 근거

| 요구사항 | 구현과 실제 파일 검증 | 판정 |
| --- | --- | --- |
| scoped list/read/search/create/update/trash | `DocumentScope`가 generation과 pinned service에 연결되고 `DocumentService`가 같은 저장소 mutex에서 실행한다. `scoped_documents/tests.rs`의 9개 검사는 생성·조회·검색·cursor·metadata·삭제·복원을 실제 임시 파일로 확인한다. 목록/검색은 한도와 warning을 반환하며 불완전한 scan으로 permalink 고유성을 증명하지 않는다. | 충족 |
| permalink missing/duplicate 및 파일 이동 후 식별 | `DocumentRef`는 path 또는 permalink 하나만 받는다. `references_missing_ids_create_unicode_and_resolve_after_move`가 빈 ID·없는 ID·ID 없는 기존 파일, Unicode 파일 생성 및 이동 후 같은 ID 조회를 검사한다. `duplicate_permalink_is_rejected_for_scoped_and_native_writes_without_clobber`는 조회·생성·native 저장의 중복 오류와 원본 보존을 확인한다. 조회는 title/path를 ID로 사용하지 않고 매번 frontmatter permalink를 해석한다. | 충족 |
| metadata 저장과 본문·원문 보존 | `metadata_patches_preserve_body_comments_unknown_values_and_history` 및 mutation metadata 검사가 BOM/CRLF, header·inline 주석, unknown nested 값, 본문 suffix, JSON metadata 응답과 Git 이력을 확인한다. invalid patch/custom tag는 파일 변경 전에 실패한다. Rust metadata 검사는 기존 TypeScript adapter와 동일한 31개 fixture도 사용한다. | 충족 |
| mandatory revision과 stale/동시 저장 충돌 | update/metadata/delete mutation은 expectedRevision을 요구한다. service 검사와 최종 filesystem CAS를 모두 사용한다. metadata/native 및 owned mutation/native 동시 검사에서 한 성공·한 conflict, 실제 내용·revision 및 이력 한 번만 확인한다. native 기존 저장의 새 파일 no-clobber 계약도 유지한다. | 충족 |
| 동일 requestId 재시도·다른 payload·응답 유실 | scope별 registry가 검증된 canonical fingerprint와 최초 성공/오류 결과를 보관한다. 16개 동시 재시도, stale 오류 재시도, 다른 content/operation 충돌, response ticket drop 후 결과 재수신을 실제 파일과 이력으로 확인한다. capacity 거부는 쓰기 전에 발생하며 최초 결과를 자동 퇴출하지 않는다. | 충족 |
| root 전환 및 종료 drain | `ScopeAdmission`과 owned worker permit가 새 호출 거부부터 저장·이력·결과 보관까지 연결된다. barrier 검사는 root switch/명시적 shutdown/manager Drop이 accepted 작업을 기다리는 것과 구 scope 거부·새 generation 독립성을 확인한다. Tauri `RunEvent::Exit`는 Workbench 종료 전에 drain하고 취소한 `ExitRequested`는 scope를 폐기하지 않는다. | 충족 |
| 기존 직접 열기·일반 저장·이력 호환 | `document_commands.rs`는 `DocumentWorkspace`를 사용한다. workspace 서비스 검사는 기존 native 저장 뒤 scope 선택, scoped/native 양방향 수정, 동일 revision과 과거 이력 내용·키를 확인한다. 실제 command handler를 실행하는 mock Tauri IPC 검사는 main의 선택/open/save와 scoped read의 동일 파일을 확인한다. 루트 밖 명시적 native 편집은 별도 기존 서비스에서 유지된다. | 충족 |
| 복구 삭제와 원본 보존 | trash는 별도 retained snapshot을 보관한다. stale 삭제, 복원 경로 점유, duplicate permalink, metadata/응답 capacity 실패는 기존 파일·복구 데이터를 유지한다. owned restore는 준비한 path/revision을 filesystem 잠금 안에서 재확인하며 manifest 변조 테스트도 통과했다. 연결 데이터는 문서 mutation 경로에 포함하지 않는다. | 충족 |
| 외부 root·secret 미노출 | application 인자에 root가 없으며 unknown root field·traversal·절대 경로를 거부한다. page/cursor/snapshot은 상대 경로를 사용한다. root symlink 교체 후에도 pinned UI/scoped 저장은 원래 디렉터리를 사용하고 외부 파일을 보존한다. 오류·이력 warning은 안전한 메시지를 사용한다. mock IPC는 외부 child의 문서/목록/이력/루트 접근을 거부한다. 세션 자격 증명 자체는 gh-52에서 구현·검증한다. | 충족 |
| 기본 검사·문서·단위 커밋/push | 아래 기존 실행 결과와 구현 커밋을 대조했다. application/Rust/shared fixture는 gh-63 검증 이후 변경되지 않았다. 이번 감사 문서의 상대 링크와 `git diff --check`를 추가 검사한다. | 충족 |

## 검증 결과와 범위

`/tmp/box-md-gh63-{native-tests,store-tests,types,build,fmt,rust}.log`에서 다음 결과를 확인했다.

- Rust 앱 60개 통과, 일반 실행에서 helper 1개 ignored. 부모 테스트가 실행한 helper subprocess 3회는 각각 통과했다.
- 파일 저장소 16개와 metadata 16개 통과. metadata 검사에는 공통 fixture 31개가 포함된다.
- `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets` 통과.
- frontend 전체 236개와 settings browser 8개는 gh-58/59의 이전 검증 근거다. 현재 부모 감사가 이를 다시 실행한 것으로 계산하지 않는다.

현재 HTTP handler에 연결하지 않은 application API의 dead-code 경고 39개와 기존 AW 경고가 있다. mock Tauri IPC는 등록된 handler와 permission을 검사하지만 실제 macOS 창 증거는 아니다. 응답 ticket drop 역시 실제 HTTP disconnect를 대신하지 않는다. 아직 MCP 도구 discovery·handler·세션 grant·ACP 주입·UI 이벤트를 제공한 것으로 판정하지 않는다.

## 최신 사용자 요구와 후속 작업

기존 계획의 UUID 생성 및 다른 이름 저장 보존은 새 feature **gh-64**로 변경한다. 새 문서/복제는 로컬 생성일 `yyMMddHHmmss` + `-` + CSPRNG hex 8자의 permalink를 생성하고 `{permalink}.md`에 저장해야 한다. 다른 이름 저장은 제거하고 복제 시 새 ID와 `기존 title 사본`을 사용한다. 현재 UUID/경로 지정 생성은 이 요구의 완료 근거가 아니며 gh-64는 아직 미완료다. 기존 파일을 일괄 개명하거나 ID를 교체하지 않는다.

gh-56은 일반 문서 저장과 scoped application 통합 범위를 완료한다. gh-50 전체 실제 파일/기존 command 감사는 **gh-57**, 새 생성·복제 정책은 **gh-64**, MCP handler/HTTP는 **gh-51**, grant·ACP 주입·UI 변경과 dirty/undo 보호는 **gh-52**, 설치 에이전트 및 실제 앱 사용 감사는 **gh-53**에 남아 있다.

관련 소스: [scoped API](../apps/box-desktop/src-tauri/src/application/scoped_documents.rs), [application 파일 검사](../apps/box-desktop/src-tauri/src/application/scoped_documents/tests.rs), [작업 루트와 native 호환](../apps/box-desktop/src-tauri/src/application/document_workspace.rs), [mutation 파일 검사](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [수명 검사](../apps/box-desktop/src-tauri/src/application/document_workspace_lifecycle_tests.rs), [native command](../apps/box-desktop/src-tauri/src/inbound/document_commands.rs), [IPC와 종료 연결](../apps/box-desktop/src-tauri/src/lib.rs), [공통 metadata fixture 검사](../crates/document-store/tests/frontmatter.rs).

상세 계약: [작업 루트 서비스](document-workspace-service.md), [문서 API](scoped-document-application.md), [mutation 감사](scoped-mutation-acceptance-audit.md), [MCP 구현 계획](document-mcp-implementation-plan.md).
