# 사이트 브라우저 실제 앱 감사 준비 (gh-43 → gh-42)

gh-43은 실제 macOS 앱 감사에 사용할 로컬 HTTP 페이지와 임시 문서를 준비한다. gh-42의 렌더링·클릭·배치·ACP·종료 보호·접근 거부 결과를 대신하지 않는다. gh-42와 상위 gh-4는 미완료다. 2026-10-13 실제 앱 창에 접근해 아래 일부 근거를 확보했지만 최신 앱의 전체 기준 감사는 아직 끝나지 않았다.

## 실행과 정리

저장소 루트에서 다음 명령으로 fixture를 실행한다.

```sh
pnpm --filter @box/desktop fixture:native-browser
```

첫 JSON 줄에 `baseUrl`, `workspacePath`, `sourceDocumentPath`, `targetDocumentPath`, `slowMs`, `pid`가 나온다. 서버는 `127.0.0.1`의 비어 있는 포트만 사용한다. QA 앱에 이 출력의 `workspacePath`를 설정하고 `baseUrl`을 사이트 주소로 입력한다. fixture는 두 permalink 문서 `qa-source`와 `qa-target`를 새 임시 디렉터리에 생성한다. 기존 문서나 앱 설정을 읽거나 변경하지 않는다. 문서의 사이트 링크는 실행 시 선택된 포트를 사용한다.

고정 포트가 필요한 경우 `--port 18242`를 추가할 수 있다. 기본 느린 응답은 17초이며 자동 검증에서만 `--slow-ms 30`처럼 짧게 설정한다. 정상 QA 감사는 17초 기본값을 사용한다.

종료는 해당 터미널에서 `Ctrl+C`를 사용한다. 다른 터미널에서는 JSON에 나온 **그 fixture의 pid**에만 `kill -TERM <pid>`를 적용한다. SIGINT/SIGTERM은 열려 있는 응답과 타이머를 끝내고 fixture가 만든 임시 디렉터리만 삭제한다. QA 앱이 임시 문서를 사용하는 동안은 서버를 유지하고, 감사가 끝난 뒤 정리한다. 종료 후 그 작업 디렉터리가 없다는 앱의 안내는 예상되는 결과다. 사용자 앱을 종료하거나 사용자 문서를 삭제하지 않는다.

## 실제 앱의 검증 순서

QA42 번들은 별도 식별자 `com.yoophi.box-md.qa42`와 링크 스킴 `boxmd-qa42`를 사용한다. 경로는 `target/debug/bundle/macos/box.md QA42.app`이다. 이 프로필에서만 아래 절차를 진행한다. 실제 macOS 조작과 화면 확인은 Computer Use를 사용한다.

| 단계 | 경로/조작 | 실제 native에서 필요한 근거 |
| --- | --- | --- |
| 준비 | QA 설정에서 `workspacePath` 선택, source.md 열기 | 두 문서 목록, source 문서의 permalink와 원본 본문 |
| 문서 유지 | 본문에 미저장 메모 작성, 문서의 검증 사이트 링크 열기 | `/one`이 앱 내부에 렌더링, 문서 복귀 시 초안/undo 유지·문서 쓰기 없음 |
| 이력 | `/one` → 링크로 `/two`, 앱 뒤로·앞으로, 새로고침 | 주소·제목·본문 이동, `/one`의 방문·새로고침 횟수 증가 |
| redirect/제목 | `/redirect`, `/title` | 최종 주소 `/two?redirect=1`, `Fixture title updated 🌱` 동적 제목 |
| 같은 문서 이력 | `/fragment`에서 URL과 제목 변경, 앱 뒤로 | query/fragment 및 제목 복원, 앱 주소 표시가 실제 WebView URL과 일치 |
| popup | `/popup`의 target blank 링크 및 window.open 버튼 | 새 앱 창 없이 현재 사이트 영역에서 `/two?popup=…` 이동 |
| 하위 프레임 | `/iframe`에서 iframe 내부 링크 클릭 | 주 주소 `/iframe`·주 제목 유지, 프레임 URL로 주소 표시가 바뀌지 않음 |
| 지연/오류 | `/slow`, `/stall`, `/disconnect`, `/error` | 로드 안내·명시적 재시도/다른 주소 이동, 연결 끊김에서 복구 가능, HTTP 503 본문 표시 |
| 공간/모달 | 앱 크기 변경, 채팅 열기/닫기·좁은 창, 설정/미저장 모달 | toolbar/상태/채팅을 사이트가 덮지 않음, 숨김 확인 뒤 모달·문서 복귀, 재표시 시 기존 페이지 유지 |
| ACP/종료 | 실제 ACP 세션과 응답 중 위 토글, 미저장 상태에서 종료 시도 | 세션·대화·진행 응답·초안 유지, 미저장 종료 보호·취소 복귀 |
| 접근 경계 | `/ipc`에서 접근 거부 확인 | 실제 native 브리지에서 네 명령 모두 `denied`, 문서 원본·앱/Workbench 상태 유지 |

각 단계의 주소·제목·화면·실행 로그·원본 문서 바이트/수정 시각 등 근거를 gh-42에 기록한다. `/slow`는 첫 응답 헤더를 지연한다. `/stall`은 HTML을 표시하되 응답을 완료하지 않는다. `/disconnect`는 헤더를 보내기 전에 연결을 끊는다. `/error`는 정상적인 HTML을 가진 HTTP 503이며 연결 실패와 구분해서 관찰한다.

## IPC 확인 결과 해석

`/ipc`는 읽기 동작 `get_app_info`, `open_document`, `list_workspace_documents`, `get_workbench_connection`을 실제 Tauri 브리지로 요청한다. 대상 파일은 fixture의 임시 문서뿐이다. 반환 데이터·연결 자격 증명·원문 오류를 표시하거나 서버에 POST하지 않는다. 명령 이름과 아래 상태만 페이지에 표시한다.

| 결과 | 의미 | 감사 판정 |
| --- | --- | --- |
| `denied` | 해당 명령의 Tauri ACL 또는 Workbench caller 거부 | 실제 native 실행과 화면 근거를 함께 기록 |
| `missing-bridge` | 일반 브라우저 등에서 Tauri 브리지 없음 | **접근 거부 미검증** |
| `inconclusive-error` | 거부로 판정할 수 없는 다른 오류 | **미검증**, 오류 원인을 별도 확인 |
| `unexpected-allow` | 명령 호출이 성공 | **실패**, 응답 값은 폐기하고 앱 상태를 확인 |

일반 Chromium에서 브리지가 없다는 결과나 synthetic 브리지의 거부 결과를 실제 앱의 접근 거부로 기록하지 않는다. 파일 시스템의 `Permission denied` 등 일반 오류는 ACL 거부로 판정하지 않는다. 자격 증명을 얻기 위해 원문 응답을 출력하지 않는다.

## 자동 검증과 현재 범위

```sh
pnpm --filter @box/desktop test:native-browser-fixture
pnpm --filter @box/desktop test:native-browser-pages
```

Node HTTP 검증 4개는 loopback·routes/redirect/status·느린 응답·연결 끊김, permalink 문서와 원본 바이트 보존, 외부 Host 헤더 거부, 끝나지 않는 응답 종료, 자기 디렉터리만 정리, 실제 CLI의 JSON/종료 신호 정리를 확인한다.

일반 Chromium 검증 7개는 fixture 페이지 자체의 이력/새로고침·제목·redirect·popup·iframe·pushState가 재현됨을 확인한다. 브리지 없음, synthetic 거부·허용·일반 오류를 구분하고 synthetic 응답의 비밀값이 DOM/콘솔/요청 URL에 나타나지 않는지도 확인한다. 이는 fixture 동작과 확인기의 검증이며 **실제 macOS WebView 실행 결과는 아니다**.

fixture는 파일 시스템을 HTTP로 제공하지 않으며 임시 문서의 경로만 준비 정보로 알려준다. POST를 받지 않고 일반 사용자 디렉터리를 설정 인자로 받지 않는다. 현재 검증 로그는 `/tmp/box-md-gh43-{http,pages}.log`에 있다. gh-42의 실제 앱 수용 기준은 여전히 미완료다.

## 2026-10-13 실제 native 관찰과 남은 범위

Computer Use에서 이전 QA42 번들을 실행해 별도 프로필로 fixture 폴더를 설정했다. fixture는 PID 75134, `http://127.0.0.1:56492`, `box-md-browser-fixture-k6xc83/workspace`다. 일반 브라우저나 synthetic IPC를 사용하지 않았으며 실제 child WebView의 accessibility tree와 native screenshot을 확인했다.

| 이전 QA42에서 직접 확인한 동작 | 관찰 |
| --- | --- |
| 링크·이력·새로고침 | /one→/two, 앱 뒤로·앞으로, /one 새로고침 후 횟수 3. 주 주소·제목과 toolbar 상태가 일치했다. |
| redirect·동적 제목·동일 문서 이력 | /two?redirect=1 최종 주소, Fixture title updated 🌱 제목, pushState의 /fragment?state=2#changed와 뒤로 복원. |
| popup·iframe | target blank와 window.open은 현재 사이트 영역에서 /two?popup=link 또는 script로 이동했다. iframe 내부 탐색에도 주 주소 /iframe 및 Fixture main with frame 제목을 유지했다. |
| 느린 응답·모달 | /slow에서 로드 안내 뒤 실제 완료. /stall에서 지연 안내가 표시됐다. 설정 및 미저장 종료 모달에서 사이트가 숨겨졌고 취소 후 복귀했다. |
| 실제 ACP 유지 | Codex GPT-5.6 Sol 세션에서 1~100 응답 중 패널을 접었다 재개한 뒤 같은 세션·응답을 유지했다. 대화 가능 상태까지 확인했고 채팅 초안도 접기/재개 및 종료 취소 후 유지됐다. QA에서 만든 해당 세션만 정상 종료했다. |
| 실제 IPC 경계 | /ipc 네이티브 브리지에서 get_app_info, open_document, list_workspace_documents, get_workbench_connection 네 명령 모두 denied. missing-bridge를 거부로 간주하지 않았다. |
| 문서·종료 보호 | source의 미저장 초안이 사이트 왕복 뒤 유지됐다. Cmd+Q 확인에서 취소해 복귀했다. 원본 두 파일의 해시는 변경되지 않았다. 이후 QA 테스트 초안만 버리고 이 이전 QA 앱을 정상 종료했다. |

이전 QA42의 채팅 레이아웃은 현재 소스보다 오래됐다. 위 결과만으로 현재 버전의 전체 gh-42를 완료 처리하지 않는다. 현재 소스를 [NativeQA 설정](../apps/box-desktop/tests/native/tauri.qa.conf.json)으로 다시 빌드했고, bundle 및 실행파일 식별 근거는 [gh-28 기록](workspace-settings-native-verification.md)에 있다. 기본 사용자 앱 PID 59546은 그대로 유지했다.

최신 NativeQA PID 11222에서 원본 source.md를 열고 미저장 초안과 rich editor undo 변경을 만들었다. 문서 속 검증 사이트 링크가 실제 child WebView의 /one을 열었고 링크를 눌러 /two로 이동했다. 실제 내용·제목·주소·앱 뒤로 버튼의 갱신을 확인했다. 이후 뒤로 버튼 조작 및 bundle ID 재연결에서 `cgWindowNotFound(-10005)`가 다시 발생했다. 프로세스는 실행 중이고 원본 파일 해시는 그대로였다. 뒤로 조작의 성공 여부와 현재 창 상태는 추가 화면 근거 없이 판단하지 않는다.

다음 단계는 최신 NativeQA 창을 다시 관찰하고 현재 버전에서 이력/제목/popup/iframe/IPC 및 ACP·문서 초안/undo/모달/종료 기준을 마저 검증하는 것이다. 창 resize·좁은 창 배치, /disconnect·/error 복구와 지연 상태에서 다른 주소/재시도 검증도 남아 있다. fixture 서버와 현재 QA 앱은 유지한다. 현재 QA에는 저장하지 않은 테스트 초안이 있으며 사용자 기본 앱이나 기존 세션을 종료하지 않는다. 완료 알림은 이 미완료 감사에 발송하지 않았다.
