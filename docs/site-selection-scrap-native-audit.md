# 사이트 선택 스크랩 실제 앱 감사 (gh-94)

2026-10-15 CUA native 창 연결이 복구되어, 별도 `box.md QA94`와 임시 loopback fixture에서 실제 child WebView 선택부터 디스크 문서 생성·편집까지 검증했다. 검사 중 발견한 WebKit 포커스 전환 버그는 gh-96에서 수정하고 반복 검증했다. 아래 초기 장애 기록에 이어 마지막 절에 현재 source의 실제 앱 수용 기준과 회귀 결과를 정리한다.

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

## 초기 실제 앱 연결 장애 기록

CUA로 새 NativeQA 번들을 열자 프로세스는 실행됐지만 창 binding에서 `cgWindowNotFound(-10005)`가 발생했다. 해당 QA 프로세스만 종료한 뒤 bundle identifier로 다시 시작해도 같았다. CUA inventory에는 NativeQA가 실행 중으로 나타났으며 Finder 창 연결도 같은 오류를 반환했다. CUA JavaScript 세션을 reset하고 다시 inventory를 읽은 뒤 재연결했지만 오류가 유지됐다. 따라서 앱 자체의 시작 실패로 간주하지 않고 현재 WindowServer/CUA 연결 문제로 분류한다.

초기에는 화면을 읽지 못한 상태에서 UI 성공 여부를 추정하거나 일반 Chromium 결과로 대체하지 않았다. 당시 미검증 항목은 다음과 같았으며, 복구 뒤 마지막 절의 실제 앱 감사에서 확인했다.

- `/selection` 실제 child WebView 선택 → 스크랩 버튼 → 생성 ID 파일의 permalink, title, summary, source, source_title, captured_at, 동적 fence와 원문 바이트 확인
- 선택 없음, `/selection-large`, `/selection-race`, 생성 오류 재시도의 실제 footer와 파일 무생성/일관성 확인
- dirty 문서 저장·버리기·취소, sidebar 갱신, 새 문서 열기·편집, 문서 초안·undo와 ACP session/draft 유지 확인
- `/ipc`에서 일곱 명령의 실제 native `denied` 확인

연결 복구 뒤 기존 NativeQA 프로세스와 분리한 QA94 프로필에서 위 항목을 진행했다.

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

반복 검증에서 WebKit이 `selectionchange:true:0`을 `blur:false:0`보다 먼저 보내는 추가 경계를 발견했다. `hasFocus()`만으로 빈 선택을 즉시 지우면 실제 사용자가 toolbar를 누른 순간의 선택도 삭제됐다. 빈 selectionchange는 50ms 뒤 포커스를 재확인해 처리하고, pointerdown의 즉시 초기화와 pointerup/click/keyup의 선택 갱신을 추가했다. 임시 관찰기는 실제 이벤트 순서와 helper 반환 길이만 표시했으며 최종 소스에서는 제거했다. 회귀 검사는 포커스를 잃기 직전의 빈 selectionchange도 명시적으로 재현한다.

최종 보완 QA94에서 동일한 영역의 첫 선택→미저장 모달→취소→재선택→미저장 모달이 연속 성공했고, 변경 버리고 계속으로 `261015110715-33422349.md`가 생성됐다. 취소 시 sidebar는 4개를 유지했고 버리기 성공 뒤 5개로 늘었다. source/target의 SHA-256은 위 초기 값과 모두 일치해 취소·버리기가 원본에 쓰지 않았음을 확인했다. 변경 전 native 재현과 변경 후 native 반복 성공을 별도 근거로 사용하며 Chromium fixture로 대체하지 않는다.

## 현재 source 실제 앱 최종 감사 (gh-94)

기능 source는 `aadadec`이며 기존 외부 ACP UI 수정 두 파일을 포함한 작업 트리로 QA94를 빌드했다. 해당 두 파일은 이번 커밋에 포함하지 않았다. 최종 QA94 실행파일 SHA-256은 `040a1b4b048df9b7fbb6d32587f45f37f6d555145d50977c904fa496ac8d00ca`다. native 조작은 CUA로만 수행했다.

| 수용 기준 | 실제 native 근거 |
| --- | --- |
| 여러 줄·Unicode·Markdown/HTML·긴 backtick, ID 파일·frontmatter | 앞 절의 실제 생성 파일을 디스크에서 파싱했다. ID 파일 5개 모두 파일명/permalink 일치, title/summary/source/source_title/captured_at 및 날짜 파싱·한줄 summary 통과. 네 backtick 원문은 다섯 backtick fence 안에 보존됐다. |
| 선택 없음·크기 초과·navigation | 실제 페이지에서 선택 해제 후 빈 선택 오류와 무생성, 256 KiB 초과 오류와 무생성, `/one` 이동 뒤 이전 선택 미사용을 확인했다. |
| URL·제목 snapshot | `/selection-race`에서 선택→pushState/제목 변경 뒤 생성한 `261015105943-abb1b399.md`의 source는 `http://127.0.0.1:57407/selection-race?state=2#captured`, title은 `선택 경쟁 이후 제목 🌊`, 본문은 같은 선택 원문이었다. |
| dirty 취소·버리기 | 취소 후 원본 초안과 사이트가 복원되고 파일 수 4개 유지. 같은 영역 재선택 뒤 버리기로 새 파일 생성·5개 표시. 두 원본 해시가 초기 값과 같았다. |
| dirty 저장 후 계속 | source 제목을 `QA94 saved title`로 적용하고 스크랩→저장 후 계속. 원본 title만 의도대로 저장되고 permalink/summary와 본문 suffix는 그대로였다. 이어 `261015110840-80d39454.md` 생성·sidebar 6개·새 편집 문서 열기를 확인했다. |
| 실제 생성 오류와 재시도 | 소유한 임시 workspace만 mode 500으로 바꿔 생성 실패를 유도. 오류 footer와 파일 6개 유지 확인. mode 700 복구 후 스크랩 다시 시도로 `261015111029-aa74d0c4.md` 하나가 생성되고 sidebar 7개로 갱신됐다. |
| ACP session·응답·draft 유지 | 문서 도구를 끈 QA94 전용 Codex session에서 `QA94_OK` 응답을 실제로 받았다. `QA94 preserved chat draft`를 남긴 채 native 사이트와 채팅을 함께 표시하고 생성 실패→재시도를 수행했다. 이후 같은 session 1, 대화 가능 상태, 응답과 draft가 유지됐다. QA session만 종료됨으로 바꿨다. |
| 생성 문서 편집·저장 | 생성 문서를 원문 모드로 열고 `QA94 edited scrap`을 추가한 뒤 Cmd+S. 저장 완료 UI와 실제 파일 suffix를 확인했다. |
| remote child 격리 | 실제 `/ipc`에서 get_app_info/open_document/list_workspace_documents/get_workbench_connection/get_document_mcp_grant/revoke_document_mcp_grant/site_browser_selection 일곱 명령 모두 denied. 응답 원문이나 자격 증명은 표시하지 않았다. |

실제 디스크 감사는 5개 ID 문서와 원본 두 문서를 검사했다. title 저장을 의도한 source의 본문 suffix는 초기와 동일했고, target SHA-256은 계속 `9e99b48fa068591a345f14d4813527b6483bdc14f7e88592fb9433383f89e979`였다. 전송 응답 유실의 request ID 재사용은 실제 디스크를 쓰는 backend와 browser 자동 회귀로 확인하며 native UI에서 네트워크 응답 유실을 주입했다고 주장하지 않는다.

QA94의 ACP session과 앱은 정상 종료했다. fixture PID 4408/11014/25021만 SIGTERM으로 종료해 세 서버의 소유 임시 디렉터리를 정리했다. 별도로 이미 실행 중이던 NativeQA 프로세스는 변경하지 않았다.

최종 현재 source 검증은 전체 `pnpm check-types` 7 packages, `pnpm test`의 desktop 126/editor 90/workbench client 75/UI 18/agent client 16, `pnpm build`, desktop Playwright 56개, Node fixture 4개, Chromium fixture 9개가 모두 통과했다. `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`, `cargo test --workspace`도 종료 코드 0으로 완료했다. 기존 dead-code 경고 4개와 frontend chunk 크기 경고는 남는다. fixture의 blur 재현은 실제 native처럼 선택 해제와 포커스 전환을 같은 task에 넣어 병렬 부하에서도 이벤트 사이 지연이 생기지 않게 했다.

gh-94의 실제 앱 수용 기준과 현재 source 회귀 검증을 모두 충족했다. gh-96의 수정으로 실제 탐색 중 발견한 선택 손실을 해결했고, 상위 gh-5의 스크랩 흐름을 완료 판정할 수 있다.
