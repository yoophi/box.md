# 사이트 선택 스크랩 실제 앱 감사 (gh-94)

2026-10-15 현재 source로 별도 `box.md NativeQA` 번들과 선택 전용 loopback fixture를 만들었다. 자동 검증은 모두 통과했지만 macOS Computer Use가 시스템의 모든 native 창에 `cgWindowNotFound(-10005)`를 반환해 실제 child WebView 조작은 아직 완료하지 못했다. 이 문서는 완료 증명이 아니라 재현 가능한 준비 상태와 남은 native 증거를 기록한다. gh-94와 상위 gh-5는 실제 앱 항목을 확인할 때까지 완료로 판정하지 않는다.

## 격리 환경

- 시작 source: `7adf7ef48cf352992385ba152dcaac324b99ad61`
- 빌드 명령: `pnpm --filter @box/desktop tauri build --debug --config tests/native/tauri.qa.conf.json`
- 앱: `target/debug/bundle/macos/box.md NativeQA.app`, 130.98 MiB
- 실행 파일 SHA-256: `c2768e957efe1fab255b21b2d71c7997f29caf1de4a36fd71177b723ec787d4d`
- 앱 식별자: `com.yoophi.box-md.nativeqa`
- fixture 명령: `pnpm --filter @box/desktop fixture:native-browser`
- 감사 시 할당된 주소: `http://127.0.0.1:54982`
- 임시 작업 디렉터리: `box-md-browser-fixture-tq8Fan/workspace`

fixture는 자신이 만든 임시 디렉터리와 loopback 서버만 소유한다. 기본 사용자 앱·설정·문서는 읽거나 변경하지 않았다. 감사 종료 시 QA 프로세스와 fixture를 종료하면 임시 작업 디렉터리도 삭제된다.

## 선택 전용 fixture

| 경로 | 실제 앱에서 확인할 내용 |
| --- | --- |
| `/selection` | 버튼이 여러 줄 Unicode, Markdown/HTML 형태, 네 개의 연속 backtick을 포함한 실제 DOM Selection을 만든다. |
| `/selection-large` | 버튼이 UTF-8 262,144 byte를 넘는 실제 DOM Selection을 만들어 `selectionTooLarge` 경계를 확인한다. |
| `/selection-race` | 선택을 유지한 채 `pushState`와 제목을 바꾸어 캡처 결과의 URL·제목·본문이 한 callback 결과인지 확인한다. |
| `/ipc` | 기존 앱·문서·Workbench 여섯 명령과 `site_browser_selection`이 remote child에서 모두 `denied`인지 확인한다. |

일반 Chromium은 위 페이지의 Selection과 URL·제목 변경, 크기 조건, IPC 결과 분류기 자체만 검증한다. 실제 Tauri bridge나 WKWebView adapter의 증거로 사용하지 않는다.

## 자동 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @box/desktop test:native-browser-fixture` | Node fixture 4 passed |
| `pnpm --filter @box/desktop test:native-browser-pages` | Chromium fixture 8 passed |
| `pnpm test` | desktop 122, editor 90, workbench client 75, UI 18, agent client 16 passed |
| `pnpm check-types` | 7 packages passed |
| `pnpm build` | production frontend build passed |
| `pnpm exec playwright test` | desktop browser 55 passed |
| `cargo fmt --all -- --check` | passed |
| `cargo check --workspace --all-targets` | passed; 기존 dead-code warning 4개 |
| `cargo test --workspace` | passed; opt-in·측정 test만 ignored |
| NativeQA debug bundle | app 및 DMG 생성 passed |

Rust 전체 테스트에는 `SiteSelection` URL·제목·본문 검증, Unicode byte 한계, 선택 원문 보존, service 오류 전달, main-only command/capability, macOS callback JSON·오류·timeout 검사가 포함된다. React와 Playwright 검사는 formatter, dirty 저장·버리기·취소, 응답 유실 request ID 재사용, sidebar 갱신, 생성 문서 열기와 기존 문서·설정·채팅 회귀를 포함한다.

## 실제 앱 상태

CUA로 새 NativeQA 번들을 열자 프로세스는 실행됐지만 창 binding에서 `cgWindowNotFound(-10005)`가 발생했다. 해당 QA 프로세스만 종료한 뒤 bundle identifier로 다시 시작해도 같았다. CUA inventory에는 NativeQA가 실행 중으로 나타났으며 Finder 창 연결도 같은 오류를 반환했다. CUA JavaScript 세션을 reset하고 다시 inventory를 읽은 뒤 재연결했지만 오류가 유지됐다. 따라서 앱 자체의 시작 실패로 간주하지 않고 현재 WindowServer/CUA 연결 문제로 분류한다.

화면을 읽지 못한 상태에서 UI 성공 여부를 추정하거나 일반 Chromium 결과로 대체하지 않았다. 아래 항목은 미검증 상태다.

- `/selection` 실제 child WebView 선택 → 스크랩 버튼 → 생성 ID 파일의 permalink, title, summary, source, source_title, captured_at, 동적 fence와 원문 바이트 확인
- 선택 없음, `/selection-large`, `/selection-race`, 생성 오류 재시도의 실제 footer와 파일 무생성/일관성 확인
- dirty 문서 저장·버리기·취소, sidebar 갱신, 새 문서 열기·편집, 문서 초안·undo와 ACP session/draft 유지 확인
- `/ipc`에서 일곱 명령의 실제 native `denied` 확인

CUA 창 연결이 복구되면 위 네 항목을 같은 NativeQA 프로필과 새 fixture에서 실행하고, 생성 파일과 원본 두 문서의 해시를 기록한다. 모든 항목이 통과한 뒤에만 이 문서를 완료 결과로 갱신하고 gh-94와 gh-5를 닫는다.

## 2026-10-15 CUA 복구와 선택 유지 수정 (gh-96)

CUA가 Finder와 native 앱 창을 정상적으로 읽게 되어 실제 검증을 재개했다. 이미 실행 중인 NativeQA 프로세스는 그대로 두고, `8c06d20` 작업 트리에서 별도 productName `box.md QA94`, identifier `com.yoophi.box-md.qa94`, scheme `boxmd-qa94`로 빌드했다. 같은 QA 설정을 복사해 식별자와 창 제목만 바꾼 `/tmp/box-md-qa94.conf.json`을 사용했다. 선택 유지 수정까지 포함한 QA94를 다시 빌드하고 정상 종료·재실행했다.

실제 native에서 선택 버튼 직후 하이라이트와 선택 문자 수 106을 확인했지만, main toolbar 클릭 뒤 `document.hasFocus()`가 false가 되고 Selection이 0자로 바뀌어 `selectionEmpty`가 발생했다. 같은 동작을 반복해 재현했다. 임시 fixture 관찰기로 선택 길이·포커스만 확인했으며 원문/자격 증명을 로그로 보내지 않았다. 이 관찰기는 진단 후 제거했다.

`site_selection.js`를 child 초기화 스크립트로 넣어 포커스가 있는 동안의 선택 원문과 복제 Range를 보관한다. 포커스가 있는 상태의 빈 선택과 새 pointer 조작, pagehide에서 캐시를 비운다. native 캡처는 현재 선택을 우선 읽고, 포커스 이탈 시에는 연결된 live Range가 남은 마지막 선택만 읽는다. DOM이 제거되면 원문을 반환하지 않는다. 캐시 문자열은 262,145 UTF-16 code unit까지 보관하며 기존 UTF-8 256 KiB 제한은 그대로 적용한다. 이 스크립트는 선택을 읽는 기능만 제공하며 IPC나 앱 권한을 추가하지 않는다.

| 실제 QA94 동작 | 결과 |
| --- | --- |
| 여러 줄 Unicode·HTML/Markdown 형태·네 backtick 선택 후 toolbar 스크랩 | `261015105728-05ff097b.md` 생성, sidebar 2→3, 새 문서 편집 모드로 열림 |
| 디스크 metadata·본문 | 파일명과 permalink 일치, title/source_title `선택 수집 제목 🌱`, source `http://127.0.0.1:57407/selection`, captured_at `2026-10-15T01:57:28.830Z`, 한줄 summary와 다섯 backtick fence 및 선택 원문 확인 |
| 선택 후 페이지 제목을 클릭해 해제하고 스크랩 | 빈 선택 오류, sidebar 3개 유지 |
| `/selection-large` 선택 후 스크랩 | 크기 초과 오류, sidebar 3개 유지 |
| 선택 이후 `/one`으로 navigation 후 스크랩 | 빈 선택 오류, 이전 선택 미사용, sidebar 3개 유지 |

작업 디렉터리는 첫 fixture의 `box-md-browser-fixture-oJKzJG/workspace`이고 선택 페이지는 두 번째 fixture `http://127.0.0.1:57407`이다. 초기 원본 SHA-256은 source `98708e35bcb80f76a4f2d4e42adc924e771afe68af292b39e2c24dc9da1d307e`, target `9e99b48fa068591a345f14d4813527b6483bdc14f7e88592fb9433383f89e979`다.

자동 회귀는 실제 production tracker를 iframe에 주입해 포커스 이탈·Selection 제거 후 동일 원문, 명시적 해제·DOM 제거·navigation 후 빈 값을 확인한다. fixture Chromium 9개와 Rust selection 검사, Rust fmt 및 QA94 app build가 통과했다. 전체 gh-94의 dirty 저장·버리기·취소, ACP 유지, IPC 거부, navigation snapshot 항목은 이어서 검증한다. 본 절은 gh-96 수정 근거이며 gh-94 전체 완료를 뜻하지 않는다.
