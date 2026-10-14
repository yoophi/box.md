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
