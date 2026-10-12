# 최우측 ACP 채팅 패널 연동 (gh-46)

문서/사이트 영역과 ACP 채팅을 하나의 가로 패널 그룹에 배치했다. 최초에는 40px 채팅 rail을 표시하며 sidebar의 에이전트 채팅, rail/패널 제목, 채팅 헤더의 닫기 버튼으로 접고 펼친다. 구분선은 포인터와 키보드로 조절하고 다시 펼치면 마지막 열린 폭을 복원한다.

## 공유 구현과 상태

- AW vendor pin: `8534a7b78a9706869b513019abe220c56ecb8281` (`box-md-ui-panels`, gh-45).
- `pnpm-workspace.yaml`에 실제 `@yoophi/ui` 패키지를 등록하고 `packages/ui`에서 component와 타입을 재내보낸다. Box 전용 패널 상태 머신이나 AW 소스 복제본은 없다.
- `react-resizable-panels`는 gh-45에서 검증한 4.11.2로 override한다. 재현 가능한 설치는 루트 lockfile로 고정한다.
- `packages/ui/src/theme.css`에서 AW component source를 Tailwind 빌드에 등록하고 기존 linen/forest 색상에 token을 매핑한다. AW globals.css 전체를 가져오지 않는다.

| 소유자 | 상태 |
| --- | --- |
| Home/기존 문서 workspace | 문서 content·baseline·dirty·읽기·pending/overwrite, 문서/사이트 전환 |
| AW shared panels | 측정 폭, 접기/펴기, 마지막 열린 폭. 중앙은 noncollapsible/showTitle false, 양쪽 keepMounted true. |
| 기존 `useAgentChat` / `AgentChatSheet` | 실제 AW HTTP/WS client, session, 대화·권한·session별 입력. 기존 sheet에 inline variant를 추가하며 같은 component identity를 유지한다. |
| SiteBrowser controller | 직렬화된 native layout intent와 ACK, modal/document 복귀 보호 |

Home의 `showChat`은 shared state 통지에서 파생되는 표시 상태다. 외부 버튼도 같은 AW controller를 사용한다. panel group을 제거하거나 재키하지 않으며 문서 key는 기존의 문서 변경 규칙을 따른다. 접기는 session cancel/close를 호출하지 않는다.

중앙은 남은 공간을 실제로 차지한다. native 사이트 bounds는 중앙 표시 영역의 현재 DOM rectangle을 사용하며 고정 drawer inset을 다시 빼지 않는다. native 사이트가 보이는 동안 sidebar/rail로 채팅을 펼치면 먼저 hide ACK를 기다린 뒤 중앙을 줄인다. modal 표시와 문서 복귀의 기존 ACK 보호도 유지한다.

좁은 컬럼에서는 document container query로 header/속성/toolbar를 감싼다. 편집 영역의 최소 높이와 문서·채팅 scroll을 유지해 600×480에서도 입력·동작 버튼에 접근할 수 있다. 좁은 창에서 원래 px 폭은 현재 양쪽 min/max에 맞게 제한된다.

## 검증의 구분

`pnpm test`의 Home DOM 흐름은 실제 AW component를 사용하되 jsdom의 없는 레이아웃/ResizeObserver는 `shared/testing/panel-layout-fixture.ts`에서 제공한다. 이것은 실제 픽셀 크기 증거가 아니다.

`tests/browser/acp-panels.spec.ts`는 실제 Chromium에서 app/editor/shared panels를 렌더링한다. 실제 AW `http_test_host`의 production HTTP/WS router와 ACP engine을 사용하고 별도 Python ACP permission fixture를 띄운다. process 생존/명시적 종료, 두 prompt, permission 보존, 채팅 draft, 동일 editor/composer DOM, 문서 undo, title/sidebar/header 토글, pointer/keyboard resize/폭 복원 및 600×480을 확인한다.

브라우저 테스트에서 문서·사이트 native IPC 경계와 연결 정보 제공만 adapter로 대체한다. 실제 macOS child WebView, 실제 설치된 provider의 응답, native 앱 재실행을 검증한 것으로 취급하지 않는다. 테스트 host·agent·임시 파일은 각 테스트의 소유한 자원만 정리한다. AW의 Vitest 전용 test-host helper는 ESM에서 `__dirname`을 사용할 수 없어 Box 테스트용 process wrapper를 두었으며 제품 ACP client는 실제 공유 라이브러리를 그대로 사용한다.

사이트·설정·연결·원문 보존·Mermaid·문서 목록의 기존 브라우저 회귀도 실행한다. 창 크기 변경은 ResizeObserver가 적용한 현재 rectangle과 native layout snapshot을 같은 poll에서 비교한다.

## 재현

```sh
pnpm install --frozen-lockfile
pnpm check-types
pnpm build
pnpm test
pnpm --filter @box/desktop test:integration
pnpm --filter @box/desktop test:browser
cargo fmt --all -- --check
cargo check --workspace --all-targets
```

설치된 실제 agent 통합 테스트는 별도 opt-in이며 기본 integration 실행에서 skip되는 항목은 통과 수에 포함하지 않는다. gh-3/gh-17 전체 완료와 native/ACP 수용 기준 전수 감사는 gh-47 및 기존 native gate를 유지한다.

## 완료 근거 (2026-10-13)

| 항목 | 결과 |
| --- | --- |
| 루트 `pnpm test` | 202개 통과: editor 43, AW HTTP client 75, AW agent facade 16, AW UI 18, desktop 50. Turbo의 기존 미변경 패키지 결과 재사용을 포함한다. |
| 브라우저 전체 회귀 | 47개 통과. 로그 `/tmp/box-md-gh46-all-browser-clean.log`. |
| 실제 HTTP/WS + ACP fixture 통합 | Home integration 1개 통과. 설치된 provider opt-in 3개는 skip이며 통과로 계산하지 않는다. `/tmp/box-md-gh46-integration.log`. |
| 타입·빌드 | `pnpm check-types`, `pnpm build` 통과. `/tmp/box-md-gh46-{types,build}.log`. |
| Rust / 재현 설치 | fmt, workspace all-targets check, frozen lockfile install 통과. `/tmp/box-md-gh46-{fmt,rust,frozen}.log`. |
| 코드 경계 | vendor worktree clean, pin `8534a7b`; Rust/SDK source는 이전 pin 대비 변경 없음. |

전체 브라우저 실행 중 ENOSPC가 발생했다. Box target의 Rust incremental 디렉터리 범위를 검증하고 생성된 `.bin/.o/.bc` 캐시 파일만 정리한 뒤 전체 47개를 다시 실행해 통과했다. 실행 앱·bundle·source·설정·사용자 문서는 정리 대상에 포함하지 않았다.

아래는 **실제 Chromium 앱 UI** 화면이다. IPC adapter/ACP fixture 기반이며 macOS native 화면 근거를 대신하지 않는다. 넓은 창에서 두 영역이 겹치지 않고 작은 창에서는 문서와 채팅 각각의 scroll로 입력·동작에 접근하는 것을 확인했다.

![1100×760: 문서와 최우측 ACP 채팅](assets/acp-panels-wide.png)

![600×480: 독립 스크롤과 채팅 동작 버튼](assets/acp-panels-narrow.png)

Box 연동 기반 gh-46의 완료 근거다. 실제 native 앱 공존/설치된 provider 응답 및 gh-17 전체 수용 기준은 gh-47과 gh-3의 native gate에서 추가 확인한다.
