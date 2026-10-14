# 실제 설치 ACP agent·native 문서 MCP 감사 (gh-53)

2026-10-14에 격리된 macOS 앱 `com.yoophi.box-md.acpqa`와 일회용 작업 루트 두 개에서 최종 검증했다. 설치된 `@agentclientprotocol/codex-acp` 2.2.2의 initialize 응답은 `mcpCapabilities.http: true`였고, Box가 AW 공유 HTTP/WS 세션에 주입한 `box_documents` 도구를 agent가 직접 호출했다. fixture agent나 앱 외부 MCP client의 결과로 이 판정을 대신하지 않았다.

검증 앱은 현재 Box source와 AW vendor pin `c3aafbed7a173fd14113c1cb19f645ae97024a66`으로 만든 격리 번들이다. 테스트 root, ACP raw event와 별도 연결 저장소만 사용했으며 사용자 문서와 기본 Box 프로필은 변경하지 않았다. 아래에는 bearer 값, 계정 정보와 provider 내부 응답을 기록하지 않는다.

## 실제 agent 호출

첫 root에는 `261014194500-ac250001.md` 한 개를 준비했다. 실제 ACP run `1b00076e-c24f-47b1-8273-caee40678994`에서 agent가 다음 MCP 호출을 수행했다.

| 호출 | 실제 결과 |
| --- | --- |
| `list_documents` | `261014194500-ac250001.md`, revision `c1939076…` 한 개를 반환했다. |
| `read_document` | permalink `261014194500-ac250001`로 title `ACP QA`와 본문을 읽었다. |
| `create_document` | request ID `gh53-native-create-001`로 `261014213223-ecb05a3d.md`를 만들었다. 서버가 생성한 permalink와 파일명이 같고 title `MCP 실제 검증`, summary `실제 ACP 문서 도구 검증`이 frontmatter에 저장됐다. 최초 revision은 `40603ebc…`다. |
| `read_document` → `update_document` | request ID `gh53-native-update-001`로 `MCP 업데이트 완료`를 추가해 revision이 `674ec78e…`로 바뀌었다. |
| 두 번째 `read_document` → `update_document` | request ID `gh53-native-dirty-update-001`로 `외부 MCP 변경`을 추가해 revision이 `67324c8b…`로 바뀌었다. |
| 존재하지 않는 문서 `read_document` | `notFound` 업무 오류를 반환했다. 같은 session의 뒤이은 `list_documents`는 성공했고 두 실제 파일을 반환했다. |

최종 생성 파일 SHA-256은 `67324c8baf8adb0df2718a462f4592855359e0c00f887ad861724e372d2c4aaf`이며, MCP 결과 revision과 디스크 byte hash가 일치했다. agent tool update는 각 호출을 `mcp.box-documents.<tool>`로 표시했고 completed/failed 상태를 구분했다.

## native UI와 동시 변경

- agent가 문서를 생성하자 사이드바 문서 수가 1개에서 2개로 자동 갱신됐다.
- 기존 문서에 미저장 초안이 있는 상태에서 새 문서를 열면 저장 여부 dialog가 나타났다. 취소하면 초안이 유지됐고, 검증용으로 변경을 버리고 이동한 뒤에도 원래 파일 hash는 바뀌지 않았다.
- 열린 clean 문서를 agent가 수정하자 본문과 revision이 즉시 갱신되고 `외부에서 변경된 문서를 반영했습니다.` 안내가 나타났다.
- 같은 문서에 로컬 미저장 초안을 둔 뒤 agent가 다시 수정하자 편집 내용과 undo 상태를 유지하면서 외부 변경 안내가 나타났다. 저장 시 `문서가 변경되었습니다. 다시 조회해주세요.` 충돌을 반환했고 disk의 `외부 MCP 변경`을 덮어쓰지 않았다.
- 존재하지 않는 문서 오류 뒤에도 채팅, 문서 목록과 앱이 계속 동작했다.

이 화면 검증은 [main 변경 통합 감사](document-change-integration-audit.md)의 mock/state 검사를 실제 설치 agent의 mutation과 macOS 앱 화면에서 다시 확인한 것이다.

## root, 관계와 권한 경계

앱 설정에서 작업 루트를 `/tmp/box-md-gh53-root-b`로 바꾼 뒤 새 ACP session을 만들었다. run `2be74f99-0c92-460d-b46b-efb2ade76d78`의 `list_documents`는 새 root의 `261014214000-bbbbbbbb.md`만 반환했고 첫 root의 두 permalink는 반환하지 않았다. root 전환 시 이전 chat client/session은 화면에서 제거됐고 새 session은 새 generation grant를 사용했다. 이전 credential의 401과 새 generation의 실제 파일 격리는 [native grant 감사](document-mcp-native-grants.md)의 실제 HTTP 회귀가 보완한다.

같은 새 session에서 agent가 `get_document_links`, `create_connection`, `attach_connection`, `list_connections`를 순서대로 호출했다. 본문 links/backlinks는 빈 배열로 유지됐고, 별도 entity `9598b30d-6e41-4db2-9ec9-5b304426f59c`와 permalink membership만 연결 저장소에 생겼다. 문서 revision `eed447fe…`와 본문 byte는 바뀌지 않았다. 따라서 wikilink 조회와 명시적 중간 연결이 실제 agent 호출에서도 독립적이었다.

실제 remote child WebView의 `/ipc` 페이지에서는 `get_app_info`, `open_document`, `list_workspace_documents`, `get_workbench_connection`이 모두 native ACL에서 거부됐다. 검증 fixture는 이어서 `get_document_mcp_grant`와 `revoke_document_mcp_grant`도 검사하도록 확장했다. compiled Tauri permission test는 두 grant 명령을 포함한 main/child allowlist를 직접 실행하며, fixture의 브리지 없음·ACL 거부·일반 오류·예상 밖 허용 분류는 Chromium에서 7개 모두 통과했다. fixture는 허용 또는 오류 응답의 값과 credential을 DOM, console, request URL에 표시하지 않는다.

ACP raw event에는 session/new의 outbound Authorization header가 기록되지 않았고 64자리 bearer 형식도 나타나지 않았다. 앱을 종료한 뒤 Box 번들의 Workbench sidecar와 테스트 `codex-acp` process가 남지 않은 것도 확인했다.

## gh-20 수용 기준 전수 대조

| 기준 | 정본 근거와 이번 실행 | 판정 |
| --- | --- | --- |
| 1. 문서 CRUD·검색·metadata 도구 발견/호출 | [전체 HTTP 감사](document-mcp-http-acceptance-audit.md)의 15개 도구 schema/실제 TCP 검증. 이번 설치 agent가 list/read/create/update를 직접 발견·호출했다. | 통과 |
| 2. permalink 식별과 오류 | [scoped application](scoped-document-application.md)의 rename/missing/duplicate 회귀. 이번 read/update가 permalink를 사용했고 `notFound`를 명확히 반환했다. | 통과 |
| 3. ACP 주입과 root 격리 | [ACP 연결 감사](document-mcp-acp-acceptance.md)의 실제 AW HTTP/WS/session-new 경로. 이번 HTTP-capable 설치 agent와 두 root의 실제 목록 결과가 일치했다. | 통과 |
| 4. 앱 반영과 충돌 | 생성 후 목록, clean 자동 반영, dirty/undo 보존, save conflict를 실제 native 화면과 disk hash로 확인했다. | 통과 |
| 5. 실패 복구 | 실제 `notFound` 뒤 같은 session의 목록 호출과 앱/채팅이 정상 동작했다. 지원하지 않는 agent와 연결 실패는 ACP 연결 감사가 다룬다. | 통과 |
| 6. 범위·credential | 두 root 격리, 이전 grant 폐기 실제 HTTP, main/child ACL, credential 비노출을 함께 확인했다. | 통과 |
| 7. wikilink와 명시적 연결 | 실제 agent가 빈 wikilink 결과와 독립 connection entity/membership을 만들었고 문서 byte/revision은 유지됐다. | 통과 |
| 8. 문서화 | [도구 계약](document-mcp-tools.md), [관계 계약](document-mcp-connections.md), [native 통합](document-mcp-native-acp-ui-audit.md)과 이 영문 파일명·한국어 감사가 실행·오류 처리를 설명한다. | 통과 |
| 9. 실제 ACP와 기본 검증 | 설치 agent의 실제 read/write/tool failure, native UI/disk 일치와 아래 현재-source 검증을 사용한다. | 통과 |

## 현재 source 검증

- `pnpm --filter @box/desktop test:native-browser-fixture`: 4 passed.
- `pnpm --filter @box/desktop exec playwright test tests/native/site-browser-fixture.spec.mjs --config playwright.native-fixture.config.ts`: 7 passed.
- `pnpm check-types`: 7 packages 통과.
- `pnpm test`: 5 packages 통과. Desktop 112, editor 90, AW client 75, AW agent client 16, AW UI 18 tests가 통과했다.
- `pnpm --filter @box/desktop test:integration`: 7 passed, 설치 agent opt-in 3 skipped. 이번 수동 설치 agent 검증이 skip 범위를 실제 앱에서 보완한다.
- `pnpm build`: production build 통과. 기존 500 kB chunk warning만 남는다.
- `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`: 통과. 기존 dead-code warning 4개만 남는다.
- `cargo test --manifest-path apps/box-desktop/src-tauri/Cargo.toml`: 97 passed, 1 ignored.

이번 실행은 gh-78에서 의도적으로 남긴 실제 설치 agent·macOS 화면 공백을 채웠다. gh-20 기준 1~9를 소스·프로토콜·파일·native UI·실제 provider 실행으로 모두 확인했으므로 gh-53과 부모 gh-20을 완료할 수 있다.
