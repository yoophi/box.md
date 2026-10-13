# 작업 루트 문서 서비스 수용 기준 감사 (gh-57 / gh-50)

2026-10-13 현재 gh-50의 저장소·metadata·application 구현을 원래 수용 기준과 대조했다. 기반 gh-54/55와 통합 gh-56(감사 커밋 `0b65ada`)을 포함한다. 이번 감사에서 제목 변경 후 파일 이동을 함께 수행하고 permalink 조회·metadata·native 내용/revision이 일치하는지 실제 파일 회귀 검증을 보강했다.

## 요구사항과 판정

| gh-50 요구사항 | 소스 및 실제 실행 근거 | 판정 |
| --- | --- | --- |
| 기존 UI 저장과 Git 이력 보존 | 기존 open/revision/save/history command가 `DocumentWorkspace`를 사용한다. `document_workspace.rs`의 서비스 검사는 native 저장→scope 선택→scoped 수정→native 수정에서 같은 revision 및 기존 이력 키·내용을 확인한다. `document_service.rs`는 외부 변경 충돌 후 이력이 추가되지 않는지 확인한다. mock Tauri handler는 main open/save가 scoped read와 같은 파일을 사용하는지 확인한다. frontend HomePage의 19개 검사는 일반 저장·metadata 재열기·이력 preview/명시적 저장 등 기존 화면 경로를 확인한다. | 충족 |
| scoped list/read/search/create/update와 permalink 식별 | `scoped_documents.rs`의 API는 path/permalink 참조, 목록/검색·cursor·경고와 한도를 제공한다. `references_missing_ids_create_unicode_and_resolve_after_move`는 누락 ID, title patch 뒤 실제 파일 rename, 같은 permalink의 내용/revision/metadata 및 native read 일치를 확인한다. duplicate 검사는 임의 대상 선택이나 덮어쓰기 없이 오류를 반환하며 명시적 path로 기존 중복을 수정할 수 있다. | 충족 |
| lossless metadata와 공통 TS/Rust fixture | `crates/document-store/src/frontmatter*`의 adapter와 `scoped_documents/tests.rs`가 BOM/CRLF, 주석, unknown nested YAML, 본문 suffix·JSON projection·이력 보존을 확인한다. 같은 `packages/editor/fixtures/frontmatter.json` 31개를 TS runner와 Rust runner가 읽는다. 표현할 수 없는 metadata/잘못된 patch는 저장 전에 실패하고 원본 byte를 유지한다. | 충족 |
| 실제 파일 CAS와 동시 변경 | filesystem의 no-clobber 생성과 최종 revision 검사, service의 같은 mutex를 사용한다. 독립 저장소 인스턴스의 동시 생성/CAS 및 native/scoped metadata/owned mutation 경합에서 한 성공·한 conflict, 원본/성공 내용과 이력 횟수를 검사한다. non-cooperating 외부 editor와의 전역 원자 CAS까지 보장하지 않는다. | 충족 |
| requestId 중복·다른 payload·응답 유실·accepted drain | [gh-60 감사](scoped-mutation-acceptance-audit.md)의 13개 mutation 검사와 4개 수명 검사를 현재 앱 suite에서 실행했다. 최초 결과 공유, 실패 결과 보관, ticket drop 뒤 완료, capacity 거부 전 원본 보존, root switch/shutdown/Drop 대기와 구 generation 신규 거부를 검사한다. request journal은 generation 내부이며 앱 재시작까지 보장하지 않는다. | 충족 |
| 복구 가능한 삭제와 restore no-clobber | 파일 시스템 tests의 trash 재open/restore, 변조된 manifest/data, cleanup 실패 후 성공 보존, prepared path/revision 변조 거부를 확인한다. application과 owned mutation 검사는 stale 삭제·duplicate ID 복원·기존 파일 충돌·capacity 실패에서 기존 문서와 복구 데이터를 보존한다. 삭제는 Git 이력 및 별도 명시적 연결 저장소를 제거하지 않는다. | 충족 |
| root traversal·symlink·TOCTOU 차단 | directory handle 기반 저장소와 scope factory를 사용한다. 실제 파일 tests는 절대/상대 탈출 경로, leaf/parent/관리/잠금 symlink, 최소 100회 부모 교체 경합, 루트 이름 교체, FIFO 거부와 외부 byte·파일 개수 불변을 검사한다. native/scoped 통합도 루트 이름이 외부 symlink로 교체되어도 기존 handle에서 저장하는지 확인한다. 에이전트 API에는 root 인자가 없다. | 충족 |
| encoding/metadata 실패 원본 보존 및 불완전 목록 처리 | invalid UTF-8/oversized 파일·custom tag·bad metadata를 실제 파일로 검사한다. 경고는 상대 경로/code이며 오류 원문을 외부로 전달하지 않는다. 불완전한 scan은 `truncated`/warning을 표시하고 permalink 고유성에 의존하는 mutation을 거부한다. 원래 encoding byte와 다른 루트 문서는 유지된다. | 충족 |
| 기본 검사·문서·작업 커밋 | 아래 체크 명령은 모두 exit 0이며 보강한 Rust 검사를 포함한다. 문서 상대 링크와 `git diff --check`도 확인한다. gh-57은 검증 보강/감사 커밋으로, gh-50은 부모 판정으로 순차 검토한다. | 충족 |

## 이번 실행 결과

로그는 `/tmp/box-md-gh57-{native-tests,store-tests,ts-tests,shared-fixtures,types,build,fmt,rust}.log`, 명령별 exit 기록은 `/tmp/box-md-gh57-check-results.json`에 있다.

| 명령 | 결과 |
| --- | --- |
| `CARGO_INCREMENTAL=0 cargo test -p box-desktop --lib` | 앱 60개 통과, helper 1개 ignored. 부모 테스트가 실행한 subprocess 3회는 각각 통과. 제목 변경·파일 이동·native read 검사 보강 후 다시 실행 |
| `CARGO_INCREMENTAL=0 cargo test -p box-document-store` | 실제 filesystem 16개, metadata 16개 통과; Rust 공통 fixture 31개 포함 |
| `pnpm test` | 5개 workspace task 성공. desktop 53개는 현재 실행, 나머지 4개는 Turbo cache 재사용. 총 236개 검증 결과이며 외부 AgentChatSheet 변경도 현재 desktop 실행에 포함 |
| `pnpm --filter @box/editor exec vitest run src/metadata-fixtures.test.ts` | cache 없이 공통 fixture 31개 통과 |
| `pnpm check-types`, `pnpm build` | 성공 |
| `cargo fmt --all -- --check`, `CARGO_INCREMENTAL=0 cargo check --workspace --all-targets` | 성공; 테스트 보강 후 재확인 |

HTTP에 아직 연결하지 않은 application API의 dead-code 경고 39개와 기존 AW 경고, frontend chunk 크기 경고가 남아 있다. 전체 `cargo test --workspace` 실행을 통과했다고 주장하지 않는다. 이번 검사 범위는 변경한 문서 저장소와 Box application의 실제 파일·command 및 frontend 회귀, 전체 target 컴파일이다. 실행 중인 사용자 앱과 NativeQA·fixture, 사용자 설정/문서는 변경하지 않았다. 외부 AgentChatSheet 두 파일은 커밋에서 제외한다.

## 완료 범위와 후속 요구

gh-50은 작업 루트 문서 service 기반을 완료한다. 실제 macOS 창을 통한 최신 서비스 확인, MCP discovery/HTTP disconnect/auth, native grant·ACP 주입·UI 외부 변경 이벤트·dirty/undo 충돌 보호, 설치 agent의 도구 사용은 **gh-51~53**에서 계속 구현·검증한다. mock IPC와 frontend native adapter 결과를 이 실제 사용 기준의 증거로 바꾸지 않는다.

최신 사용자 요청의 생성일/난수 permalink, `{permalink}.md` 생성과 다른 이름 저장 제거·복제는 **gh-64**의 추가 기능이다. 현재 UUID/임의 경로 생성은 새 정책을 충족하지 않는다. gh-64는 gh-51에 앞서 UI/service/MCP 생성·복제 계약을 맞추고 실제 파일·화면 회귀를 추가해야 한다. 기존 ID/파일의 일반 조회·저장은 계속 유지한다.

근거 문서: [저장소](scoped-document-store.md), [metadata](frontmatter-rust-adapter.md), [작업 루트 서비스](document-workspace-service.md), [문서 API](scoped-document-application.md), [통합 감사](scoped-document-integration-audit.md), [mutation 수명](document-mutation-lifecycle.md), [scope 수명](document-scope-lifecycle.md), [MCP 작업 계획](document-mcp-implementation-plan.md).

검증 소스: [filesystem](../crates/document-store/tests/filesystem.rs), [Rust metadata](../crates/document-store/tests/frontmatter.rs), [TS fixture](../packages/editor/src/metadata-fixtures.test.ts), [application](../apps/box-desktop/src-tauri/src/application/scoped_documents/tests.rs), [workspace 호환](../apps/box-desktop/src-tauri/src/application/document_workspace.rs), [mutation](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [drain](../apps/box-desktop/src-tauri/src/application/document_workspace_lifecycle_tests.rs), [기존 service 이력](../apps/box-desktop/src-tauri/src/application/document_service.rs), [IPC](../apps/box-desktop/src-tauri/src/lib.rs), [frontend 회귀](../apps/box-desktop/src/pages/home/ui/HomePage.test.tsx).
