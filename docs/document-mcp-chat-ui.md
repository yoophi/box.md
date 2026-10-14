# 문서 도구 채팅 선택 UI (gh-80)

main 채팅 패널에 문서 도구 선택 영역을 추가했다. 기본 선택은 문서 도구 사용이며, 사용자가 해제하면 새 세션을 일반 채팅으로 생성한다. 이미 열린 세션의 권한이나 대화를 이 선택으로 바꾸지 않는다. workspace generation이 없는 상태에서는 도구 선택 영역을 표시하지 않는다.

연결 실패·HTTP MCP 미지원·폐기 확인 실패의 모델 안내를 status 영역에 표시한다. 사용자는 다음 세션을 일반 채팅으로 선택하거나 다시 연결할 수 있다. 선택이 바뀌는 시점과 작업 디렉터리 범위를 명시하고 credential과 내부 전송 설정을 표시하지 않는다. 요청 처리 중에는 선택·재연결을 비활성화한다. 패널을 숨기면 선택 영역도 숨기며 문서의 확인 대화상자가 열리면 inert로 처리한다.

`DocumentChatTools`는 독립 feature UI로 HomePage에서 기존 AgentChatSheet와 조합한다. 기존 AgentChatSheet 사용자 변경을 보존했다. 현재 패널의 배경·글자색·간격을 재사용하고 작은 폭에서는 설명과 버튼을 줄바꿈한다.

## 검증

- UI 단위 검증: 선택의 다음 세션 적용, 기존 세션 종료/생성 호출 없음, 오류 안내와 일반 채팅·재연결, busy 비활성화, collapse/inert, workspace 미선택. 관련 UI/HomePage 회귀 34개 통과.
- 전체 `pnpm test`: 291개(desktop 92개), 5개 작업 성공. `pnpm check-types`, `pnpm build` 성공. Rust 소스 변경 없이 gh-79에서 확인한 fmt/alltargets 결과를 유지한다.
- Playwright ACP 패널 검증 2개 통과. 실제 AW HTTP/WS 및 ACP permission fixture의 일반 채팅, 에디터/undo·채팅 입력 보존, panel collapse와 크기 조절, 사이트 영역 공존을 확인했다. 이 기존 패널 테스트는 문서 도구 선택을 해제하여 일반 채팅을 검증한다.
- 1100×760 및 600×480 screenshot을 확인했다. 작은 폭에서 선택·설명이 줄바꿈되며 채팅 입력·전송 버튼에 접근할 수 있다.

문서 도구의 실제 AW session/new 주입 및 MCP 사용 경로는 gh-81에서 검증한다. 이 UI 검증을 문서 도구 wire 또는 설치 agent/native 전체 검증의 완료로 간주하지 않는다.
