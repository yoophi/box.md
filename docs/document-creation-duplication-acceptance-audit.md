# 생성·복제 수용 기준 감사 (gh-68 / gh-64)

2026-10-13 현재 gh-64 기준1~7을 서비스/native 구현 `2aed2ec`와 UI 구현 `7aa9437`, 현재 소스·실제 파일 및 UI 실행 결과에 대조했다. 이번 감사는 공통 JSON operation을 역직렬화해 실제 파일을 생성/복제하고 같은 requestId의 native 결과 변환이 캐시된 공통 결과를 바꾸지 않는 검사를 추가한다.

| gh-64 기준 | 구현 및 검증 근거 | 판정 |
| --- | --- | --- |
| 1. 로컬 날짜12자리-CSPRNG hex8, 충돌 검사/재시도/no-clobber | `LocalDocumentIdentity`와 TS `newPermalink`의 로컬 시간/4byte source. Rust adapter 3개 및 TS 로컬시간/random 실패 검사. 실제 파일 검사에서 같은 초 ID, 기존 파일/다른 파일 permalink 충돌, 검사 뒤 late writer, 32회 소진, capacity 거부를 확인한다. server가 새 난수로 재시도하며 원본을 덮어쓰지 않는다. | 충족 |
| 2. ID와 같은 .md 파일명, 생성일 정렬 | `create_identified`는 `{id}.md`만 생성한다. 날짜 경계 정렬 검사, 실제 command handler의 file_stem/permalink 일치, 공통 JSON/native 결과와 실제 파일 내용/revision, browser의 목록/문서 제목을 확인한다. 같은 초의 순서는 난수 suffix이며 초 이하의 순서까지 주장하지 않는다. | 충족 |
| 3. Save As 제거/복제 제공, 이름 선택·대상 덮어쓰기 없음 | `HomePage` 복제 버튼, Ctrl/Meta+Shift+S, create API에 filename/root 인자가 없음. picker/overwrite state와 dialog 제거, native 메뉴에 Save As 없음, `dialog:allow-save` 제거. legacy path-directed Create의 외부 역직렬화 거부. unit에서 picker 미호출 및 browser에서 메뉴/shortcut/생성·복제 흐름 확인. | 충족 |
| 4. 새 permalink/title 사본 및 원문 보존/fallback | native CST patch는 title과 permalink만 변경한다. 실제 파일에서 BOM/CRLF/본문 suffix·header/inline 주석·unknown nested metadata/summary, `문서 사본` 및 title 없는 `legacy.md 사본` 확인. UI는 dirty 원문을 그대로 native 입력으로 전달하고 읽기 모드 복제는 새 편집 문서를 연다. | 충족 |
| 5. 원본/ID/이력/관계 보존, 실패·취소/root/stale 보호 및 결과 반영 | 원본 byte와 Git 이력 개수, 실제 연결 저장소 snapshot/byte 불변을 확인한다. stale source/capacity/난수 실패는 새 파일을 공개하지 않는다. accepted 생성의 응답 drop/root drain은 원래 디렉터리에만 저장한다. UI 실패 후 동일 editor/dirty 내용 및 실제 rich undo, 다른 root remount의 늦은 응답 무시, 기존 설정/이동의 취소 보호, 목록·문서 반영을 확인한다. 복제에는 취소할 파일명 dialog를 제공하지 않는다. | 충족 |
| 6. UI/MCP 공통 생성·복제·저장/requestId/CAS 계약, legacy 호환 | UI native command와 MCP용 `CreateDocument`/`DuplicateDocument`는 같은 scope/registry/service를 사용한다. 새 JSON 검사에서 permalink 참조/expectedRevision/기본 content 생략·파일 결과 및 native absolute path 변환을 확인한다. 재시도는 첫 ID/결과와 이력 한 번을 유지한다. 일반 저장/legacy UUID·custom ID/기존 파일명은 유지하고 없는 ID의 개별 부여만 날짜 형식으로 처리한다. 실제 MCP handler/HTTP는 gh-51의 구현 범위다. | 공통 계약 충족; MCP runtime 후속 |
| 7. 실제 파일/UI 회귀, 기본 검사·문서·개별 commit/push | 아래 실행 결과와 gh-66/67의 커밋/push, 본 감사의 JSON/native 검사 및 문서 링크/diff 검사. 실제 native 파일/command와 browser UI를 구분해 증거로 사용한다. | 충족 |

## 증거 범위

gh-67 로그에서 TypeScript 244개 결과(desktop 61개 현재 실행, 미변경 4개 task cache), Chromium 51개, 앱 68개와 helper subprocess 3회, types/build/fmt/workspace all-targets 성공을 확인했다. 파일 저장소 16개·metadata 16개는 gh-66의 같은 구현 실행 근거다. 추가 검사 뒤 앱은 69개 통과(helper 1개 ignored 및 subprocess 3회 각각 통과), Rust fmt/all-targets도 성공했다. 로그는 `/tmp/box-md-gh68-{native-tests,fmt,rust}.log`, exit 기록은 `/tmp/box-md-gh68-check-results.json`이다. frontend 구현은 gh-67 이후 변경하지 않았다.

공통 JSON 입력/결과 검사는 MCP runtime 대신으로 사용하지 않는다. browser의 native 파일 호출은 테스트 adapter이며 실제 파일/handler 검사는 Rust에서 수행한다. 최신 macOS 창·설치 agent MCP 사용, HTTP disconnect/auth/grant·ACP 주입·UI 외부 변경/dirty 보호는 gh-51~53 및 기존 native gate에 남아 있다. 앱 전체의 실제 native 검증을 이 감사만으로 완료하지 않는다.

현재 중복 방지는 선택한 작업 루트의 완전한 관찰 목록과 same-service 직렬화, 최종 no-clobber를 사용한다. 비협력적인 외부 편집자의 임의 metadata 변경까지 전역 원자 transaction으로 보장하지 않는다. journal은 generation 내부이며 앱 재시작을 넘는 재시도 보장은 아니다. 이력 실패는 성공 파일과 warning으로 처리한다.

gh-68은 gh-64의 마지막 감사 단위다. 현재 기능 구현을 완료 판정하고, MCP handler는 이 계약을 gh-51에서 사용한다. 카드 캔버스 gh-65는 별도 기능이다. 외부 AgentChatSheet 두 파일과 실행 중인 사용자/NativeQA 앱·fixture·문서는 변경하지 않았다.

관련 근거: [서비스](document-creation-duplication-service.md), [UI/화면](document-creation-duplication-ui.md), [계획](document-creation-duplication-plan.md), [mutation 수명](document-mutation-lifecycle.md), [실제 파일/JSON 검사](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [native command](../apps/box-desktop/src-tauri/src/inbound/document_commands.rs), [UI 호출](../apps/box-desktop/src/entities/document/api.ts), [UI 상태](../apps/box-desktop/src/features/manage-document/model/use-document-workspace.ts), [IPC](../apps/box-desktop/src-tauri/src/lib.rs).
