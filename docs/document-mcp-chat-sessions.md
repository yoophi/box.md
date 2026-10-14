# 문서 MCP 채팅 세션 제어 (gh-79)

Box의 `DocumentChatSessions`는 기존 AW 공유 `AgentChatClient`를 사용한다. ACP 프로세스와 HTTP/WS 전송을 별도로 구현하지 않는다. native `get_document_mcp_grant` 응답을 현재 workspace generation과 run ID에 대조하고 loopback HTTP `/mcp` 및 Authorization header 형식을 검사한 뒤 `SessionOptions.mcpServers`에 추가한다. 기존 다른 MCP 서버 설정은 유지한다.

## 수명과 상태

문서 도구 사용 세션만 grant를 요청한다. 일반 채팅은 grant 없이 생성한다. grant 발급 중 같은 run ID의 중복 요청은 거절한다. 생성 실패·불확실 결과·예외, closed/failed/lost 상태, root generation 변경, 명시 종료 및 disposal에는 grant를 폐기한다. 늦게 도착한 grant와 생성 결과도 폐기하며 새 generation의 오류·busy·agent 목록을 덮어쓰지 않는다.

패널 collapse는 세션 종료가 아니다. 별도 lifecycle 구독이 계속 동작하므로 숨긴 패널에서도 종료 상태를 관찰한다. 일시적인 WS 연결 오류만으로 정상 세션의 권한을 폐기하지 않는다. 폐기 실패는 pending 상태로 유지하고 reconnect에서 재시도한다. 이미 성공한 폐기를 중복 실행하지 않는다.

AW의 HTTP MCP 미지원 diagnostic을 받으면 grant를 폐기하고 일반 채팅 세션은 유지한다. 사용자 안내와 도구 선택 UI는 다음 작업 gh-80에서 연결한다.

## 비밀값과 경계

grant와 bearer 값은 controller의 private 런타임 메모리에 보관한다. UI snapshot·오류·permission 및 event payload에 같은 값이 반사되면 문자열과 객체 key에서 가린다. 공유 client의 원본 snapshot은 변경하지 않는다. 늦게 도착하거나 재생된 event도 가릴 수 있도록 폐기 후의 비밀값 역시 해당 controller 수명 동안만 기억한다. localStorage와 문서에 credential을 저장하지 않는다.

`entities/document-mcp`는 native DTO adapter, `features/agent-chat/model`은 세션 정책과 hook을 담당한다. HomePage가 backend workspace generation을 hook에 전달한다. 기존 AgentChatSheet의 별도 변경은 이 작업에 포함하지 않는다.

## 검증과 남은 통합

2026-10-14에 `pnpm test`의 5개 작업이 성공했다(전체 287개, desktop 88개). native DTO adapter 테스트는 실제 invoke를 모킹하며 generation/run 불일치·잘못된 URL/header·잘못된 응답의 폐기를 검사한다. controller/hook 테스트는 late grant/outcome/catalog, 생성 결과 각 분기, 숨긴 패널 종료, 미지원 진단, private 값 가림, 폐기 실패 재시도와 동시 중복 생성을 검사한다. `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`를 통과했다. Rust 검사는 변경 없는 gh-75 backend의 이번 작업 검증 결과를 재사용한다.

이 테스트는 실제 AW HTTP/WS 및 ACP agent 실행 증거가 아니다. gh-76을 gh-79 → gh-80(UI) → gh-81(실제 AW/ACP fixture 및 부모 감사)로 나누었고 gh-76은 gh-81에 의존한다. main 변경 반영 gh-77, 전체 통합 gh-78 및 설치 agent/native 전체 검증 gh-53은 계속 필요하다.
