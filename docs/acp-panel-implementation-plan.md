# 최우측 ACP 패널 구현 계획 (gh-17, gh-44)

ACP 채팅을 중앙 문서/사이트와 함께 사용하는 최우측 컬럼에 배치한다. AW의 실제 `CollapsibleResizablePanels`를 재사용하고 공용 진입점은 `packages/ui`에 둔다. 패널 전환·폭 변경으로 문서 편집기나 채팅 상태를 재생성하지 않는다. 이 계획은 현재의 고정 drawer를 대체하는 구현 순서를 정하며 gh-17의 구현 완료를 뜻하지 않는다.

## 현재 근거와 라이브러리 충분성

확인한 AW pin은 `662ff07ae3f4d73457712924ddb90138df1d5d69`이다. 다음 파일을 기준으로 판단한다.

| 근거 | 현재 제공 기능 | Box에서 필요한 추가 범위 |
| --- | --- | --- |
| `vendor/agentic-workspace/packages/ui/src/components/collapsible-resizable-panels.tsx` | 좌우 panel, 제목/접힌 rail 토글, resize handle, 상태 통지 | 외부 sidebar 토글, 초기 접기, opt-in content mount 유지 |
| 같은 디렉터리의 `collapsible-resizable-panels-state.ts` | 너비 기억/복원, 마지막 열린 panel 보호, 접힌 동안 layout 변경 무시 | 동일 모델을 유지하고 새 controller도 같은 전이 경로 사용 |
| 같은 디렉터리의 `collapsible-resizable-panels-state.test.ts` | 순수 상태 검증 9개 | 실제 component mount/입력 상태 및 외부 제어 검증 |
| `packages/ui/package.json` | `@yoophi/ui/components/*` subpath export, React 19 peer, react-resizable-panels 4 | Box workspace 등록과 facade, theme token 매핑 |
| `apps/git-explorer/src/stories/molecules.stories.tsx` | 기존 공유 패널 Storybook 사례 | 새 mount 유지/controller 사례 추가 |
| Box `AgentChatSheet.tsx` | session별 draft·선택 상태, 현재 hidden 전환 시 mount 유지 | 고정 위치를 inline variant로 전환하고 상태 유지 |

현재 `PanelContents`의 collapsed 분기는 내용 노드를 반환하지 않으므로 내용을 언마운트한다. 또한 외부 ref/controlled collapse API가 없어 sidebar 버튼에서 같은 토글 경로를 호출할 수 없다. 이 두 부분은 Box의 요구에 충분하지 않다. 공용 기능이므로 AW `packages/ui`에서 개선하고 Box에 동일 구현을 연결한다. 별도 ACP transport나 Box 전용 패널 상태 머신을 만들지 않는다.

Box workspace는 현재 AW SDK 두 패키지만 등록하며 `@box/ui`는 Button과 theme를 제공한다. `@yoophi/ui`의 실제 component를 workspace dependency로 연결하고 `@box/ui`에서 재내보낸다. AW의 원본 UI 구현을 복사해 병렬 유지하지 않는다. AW globals.css 전체 대신 필요한 Tailwind source와 background/foreground/border/ring token을 Box의 기존 linen/forest theme에 매핑한다.

## AW 공유 API 확장 (gh-45)

기존 호출자의 기본 동작을 유지하면서 다음 선택 항목을 추가한다.

| 항목 | 계약 |
| --- | --- |
| panel definition의 `keepMounted?: boolean` | 기본 false로 기존 동작 유지. true이면 접혀도 동일 content DOM/component를 유지하고 hidden/inert로 상호작용·접근성을 막음 |
| `defaultCollapsedPanel?: "left" \| "right" \| null` | 기본 null. 초기 접기는 허용된 panel에만 적용하며 마지막 열린 panel을 보호 |
| `controllerRef?: Ref<CollapsibleResizablePanelsHandle>` | optional. 외부 조작을 내부 제목 토글과 같은 상태/imperative resize 전이에 연결 |
| handle의 `collapse(side)`, `expand(side)`, `toggle(side)`, `getState()` | 현재 상태와 실제 크기를 읽고 같은 restore 정책 적용. collapsible false/showTitle false 및 마지막 열린 panel 보호 |

외부 controller는 ref로 동작을 요청하며 별도의 controlled state 소유자를 추가하지 않는다. 실제 layout과 기억된 너비의 소유자는 공유 component 하나다. `onStateChange`는 기존 공개 상태 통지에 사용한다. collapse 중에 들어온 resize 이벤트가 기억된 폭을 덮지 않아야 하며 expand는 마지막 정상 폭을 현재 경계 안으로 제한해 복원한다.

초기 접기는 실제 측정된 default layout을 기억한 뒤 적용한다. 현재 `sizeAsPercentage`는 숫자/px 값을 50% fallback으로 취급하므로 새 초기 접기에서 이를 실제 복원 폭으로 확정하면 안 된다. percentage와 px default, 현재 min/max 및 좁은 컨테이너 경계를 함께 검증한다. 사용하지 않는 옵션의 기존 동작은 유지한다.

keepMounted 경로는 접기/펴기에서 wrapper와 content identity를 유지해야 한다. expanded/collapsed JSX 분기를 바꾸면서 같은 내용이 재생성되는 구현은 허용하지 않는다. mount 카운터·DOM identity·입력 값으로 이를 검증한다. collapsed content는 focus를 받을 수 없어야 하며 외부 토글도 비허용 panel을 접지 못해야 한다.

AW 변경은 기존 HTTP branch와 사용자 primary checkout을 보존하는 별도 branch/worktree에서 수행한다. AW `docs/`에 한국어 확장 계약을 작성하고 기존 Molecules Storybook에 사례를 등록한다. 순수 상태 검증과 실제 component/DOM 검증, AW의 관련 타입/빌드 검사를 완료한 뒤 commit/push한다. 생성된 OpenWiki 문서는 수정하지 않는다.

## Box 구성과 상태 소유 (gh-46)

전체 구조는 sidebar와 workspace body를 유지하고, workspace body 안에 AW의 좌우 패널을 둔다. left는 중앙 문서/사이트, right는 ACP 채팅이다. 중앙 panel은 `collapsible: false`, `showTitle: false`, `keepMounted: true`로 구성하고 right는 `keepMounted: true`로 유지한다. right의 초기 접힌 rail은 명시적으로 다시 펼칠 수 있어야 한다.

| 소유자 | 상태/책임 |
| --- | --- |
| Home/기존 document workspace hook | 문서 content·baseline·dirty·pending/overwrite, 문서/브라우저 모드 |
| 기존 agent-chat hook와 AgentChat content | AW HTTP client·session·응답, 선택·session별 채팅 draft |
| AW shared panels | 실제 layout, collapsed side, 마지막 expanded 너비, 외부 controller |
| `packages/ui` facade | upstream component/type export와 app 독립 진입점 |
| site-browser controller/영역 observer | 중앙 영역의 실제 bounds, 모달/문서 복귀 hide 확인, native 페이지 수명주기 |

sidebar의 채팅 버튼, inline 헤더 닫기, 접힌 rail은 모두 같은 controller에 연결한다. panel state 통지로 채팅의 표시 상태를 갱신하되 UI toggle만으로 session cancel/close를 호출하지 않는다. `AgentChatSheet`는 별도의 ACP 구현을 만들지 않고 inline 표시 variant를 제공한다. 현재 문서 편집기는 같은 React key/DOM을 유지해 초안과 undo를 보존한다.

그룹 자체를 조건부 제거하거나 key로 다시 생성해서 접기를 구현하지 않는다. 중앙은 접힌 rail을 제외한 공간을 사용하며 다시 펼치면 마지막 폭을 복원한다. keyboard/포인터 resize, 좁은 창, overflow/focus, 마지막 열린 panel 보호를 검증한다.

현재 site-browser는 고정 chat drawer의 occlusion을 반영한다. inline panel로 변경하면 중앙의 실제 영역이 이미 좁아지므로 overlay용 여백/occlusion을 이중 적용하지 않는다. native bounds observer는 중앙 content의 크기 변화를 반영하고 모달 표시 전 hide ACK 규칙을 유지한다.

## 작업 순서와 완료 gate

| 작업 | 범위 | 의존성 |
| --- | --- | --- |
| gh-44 | 현재 근거·공유 API 부족 범위·이 계획 및 하위 task 등록 | 완료된 ACP 기반 gh-23 |
| gh-45 | AW 공유 API 확장·기존 호환성/component 검증·Storybook·branch push | gh-44 |
| gh-46 | vendor pin·workspace/facade·inline 채팅/중앙 배치·자동 검증 | gh-45, gh-23 |
| gh-47 | gh-17 기준1~7, 실제 ACP/앱 공존과 증거 범위 전수 감사 | gh-46, gh-3 |

gh-17은 기존 gh-3 완료 의존성을 유지하고 gh-47을 최종 gate로 추가한다. 설계와 공유 UI 기반은 완료된 SDK/ACP child gh-23으로 독립 준비할 수 있지만 gh-3의 native 최종 검증을 완료한 것으로 대체하지 않는다. gh-17은 gh-47까지 완료되기 전에는 완료 처리하지 않는다.

gh-47은 최우측 컬럼/명시적 토글/공유 component 실제 재사용/폭 복원/진행 응답과 세션·대화 유지/문서 초안 유지/검증 통과 각각의 근거를 기록한다. 자동 DOM/HTTP 결과와 실제 native 앱 화면을 구분한다. 현재 `cgWindowNotFound`는 실제 앱 증거를 얻는 데 남아 있는 조건이며 이 계획으로 해소했다고 주장하지 않는다.

## 기준선 검증 범위

AW worktree의 UI 테스트 실행은 로컬 UI node_modules가 없어 global Vitest의 누락된 `@vitest/utils`로 실패했다(`/tmp/box-md-gh44-aw-ui.log`). 원본 UI 전체의 타입/DOM 검증 통과로 기록하지 않는다.

공유 순수 state 소스와 기존 테스트 두 파일을 그대로 소유한 임시 디렉터리에 복사하고 Box의 설치된 Vitest로 실행했으며 9개가 통과했다(`/tmp/box-md-gh44-state-baseline.log`). 임시 디렉터리는 정리했고 AW 원본·vendor pin·사용자 primary checkout을 변경하지 않았다. 이는 기존 순수 상태 기준선이며 새 mount/controller 계약은 gh-45에서 검증해야 한다.

Box 기본 검사도 통과했다(`/tmp/box-md-gh44-{types,build,fmt,rust}.log`). 이는 현재 프로젝트 기준선이며 계획된 AW API·Box 패널 구현이 완료됐다는 근거가 아니다. 해당 구현과 검증은 gh-45부터 순서대로 수행한다.

## AW 공유 확장 완료 근거 (gh-45, 2026-10-13)

AW 별도 브랜치 [`box-md-ui-panels`](https://github.com/yoophi/agentic-workspace/tree/box-md-ui-panels), commit [`a11a117f09242e626ece4a6908ae8408bf5e9044`](https://github.com/yoophi/agentic-workspace/commit/a11a117f09242e626ece4a6908ae8408bf5e9044)를 push했다. 기존 HTTP 브랜치와 사용자 primary checkout은 보존했다.

공유 component에 `keepMounted`, `defaultCollapsedPanel`, `controllerRef`와 collapse/expand/toggle/getState를 추가했다. 제목 버튼과 외부 제어는 같은 경로를 사용하며 마지막 열린 패널과 비허용 패널을 보호한다. 초기 접기는 실제 측정된 layout을 저장한 뒤 적용하며 숫자/문자열 px 기본 폭을 50% fallback으로 확정하지 않는다. 숨긴 content는 동일 wrapper/DOM/component를 유지하며 hidden/inert/display 처리로 focus를 막는다. 기본 keepMounted false는 기존 unmount 동작을 유지한다.

| 검증 | 결과와 증거 범위 |
| --- | --- |
| AW UI 상태·DOM tests | 17개 통과. 순수 상태 9개 + component 8개. DOM 테스트는 resize primitive mock이므로 실제 크기 근거는 아래 Chromium 결과다. |
| 실제 Chromium + 실제 AW primitive | 9개 통과. 초기 percentage/string px/numeric px/max 경계 복원, DOM/React 초안/selection·문서 및 접힌 채팅 undo, focus 차단, keyboard/pointer resize, 좁은 container min/max, 외부 제약과 마지막 열린 패널, 기존 기본 unmount/showTitle false. |
| UI check-types | 통과. |
| GE build / Storybook build | 통과. 기존 소비자 타입·번들 및 네 가지 PersistentPanels Molecules 사례. |
| 원격 상태 | 로컬 AW HEAD와 origin/box-md-ui-panels가 위 commit으로 일치하고 worktree가 clean. |

실행 로그는 `/tmp/box-md-gh45-ui-tests.log`, `/tmp/box-md-gh45-browser-final2.log`, `/tmp/box-md-gh45-ui-types.log`, `/tmp/box-md-gh45-ge-build.log`, `/tmp/box-md-gh45-storybook.log`다. 재현 명령과 API 계약은 해당 AW commit의 `docs/collapsible-panels-controller.md`에 있다.

Box vendor는 아직 기존 pin이다. 실제 shared import/facade·inline 채팅·native 중앙 geometry 연결은 gh-46 범위이며 이 기록은 Box 통합 또는 native ACP 검증을 완료했다는 뜻이 아니다. gh-17 및 gh-47의 native/ACP 최종 gate는 유지한다.
