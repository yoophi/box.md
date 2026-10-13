# AW vendor 업데이트 (gh-72)

2026-10-13 사용자 요청에 따라 `/Users/yoophi/project/agentic-workspace`의 main HEAD와 GitHub 원격 main을 확인했다. 둘 다 `760415c497f41081cba73a011981f2159c118de0`이며 Box의 `vendor/agentic-workspace` submodule을 기존 `9ee73897ec04476d145536881381b5da313ea8cc`에서 해당 commit으로 변경한다. 릴리스 번호를 임의로 바꾸지 않고 실제 source commit을 고정한다.

## 포함된 변경과 공유 계약

| AW 변경 | Box에 적용되는 의미 |
| --- | --- |
| `be4683f` / AW #218 | 기본 Codex ACP 명령이 `@latest`를 사용하고 실행 전 업데이트를 준비한다. 모델·추론 수준은 Codex App Server에서 동적으로 조회한다. 실패를 정적 모델 목록으로 대체하지 않는다. 사용자 정의 command/model 목록은 유지한다. |
| `760415c` / AW #219 | AW release에서 독립 Workbench 서버를 앱과 같은 CALVER로 bundle하고 검증한다. Box vendor에도 같은 서버 source/build script가 포함된다. |
| `60f8a5b` / AW #216 | 월별 CALVER patch 증가 규칙을 명확히 한다. Box package/Cargo/Tauri 버전 변경은 수행하지 않는다. |
| AW #213~215 | 기존 Box 작업의 공유 HTTP ACP client, 패널 보존/controller 및 authenticated HTTP MCP host가 main에 통합돼 있다. |

두 pin의 `packages/workbench-agent-client`, `packages/ui`, `crates/workbench-desktop-client`, `crates/local-mcp-server`를 `git diff --exit-code`로 비교해 동일함을 확인했다. 기존 공유 기능을 잃는 이전 main으로 돌아가는 업데이트가 아니다. `acp-agent-core`의 Codex 관련 변경과 release/server 수정은 위 최신 main에서 가져온다. AW와 Box의 기존 lockfile package identity를 이 업데이트를 위해 변경하지 않는다.

AW checkout의 미추적 연구 문서 두 개와 Box AgentChatSheet 두 파일의 기존 변경을 보존했다. 진행 중인 gh-69 MCP adapter 변경은 소유한 파일만 stash `a16772c1d1599023f05f8b83ec6d3a1cc3a0bc33`에 보관해 이 업데이트의 commit·검사와 분리한 뒤 복원한다.

## 실행 경계

이 변경은 vendor source pin 업데이트다. 사용자의 실행 중인 AW/Box/QA 앱이나 공유 서버를 종료·교체하지 않는다. 기존 프로세스는 이미 로드한 바이너리를 계속 사용하므로 source pin만으로 실행 중인 서버의 새 모델 조회/자동 업데이트 동작을 완료 판정하지 않는다. 새 source는 후속 서버/앱 빌드에 사용된다. Box의 서버 준비 흐름은 `scripts/prepare-workbench-server.mjs`를 유지한다.

Codex 동작과 AW release bundle의 상세 계약은 [AW 런타임 업데이트 문서](../vendor/agentic-workspace/docs/codex-acp-runtime-updates.md)를 따른다. 설치 agent의 실제 ACP/native 최종 검증은 기존 gh-25/gh-47/gh-53에 남아 있다. 문서 MCP handler 구현은 gh-69를 이어간다.

## 검증 결과

새 pin에서 `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets --locked`가 통과했다. TypeScript 테스트는 244개(desktop 61개 현재 실행, 같은 소스의 공유 task 4개 cache), `acp-agent-core --lib`은 104개 통과/실제 npm·로그인 모델 smoke 1개 ignored, Box Rust library는 69개 통과/helper 1개 ignored 및 subprocess 3회 각각 통과다. 업데이트 성공/실패/시간 초과/오래된 cache 판정은 ACP core의 process fixture 검사에서 확인했다.

`cargo check --manifest-path vendor/agentic-workspace/Cargo.toml -p agentic-workbench-server --target-dir target --locked`도 성공했다. 이는 서버 source compile 근거이며 새 release bundle 제작이나 실행 중인 공유 서버의 교체 증거가 아니다. 기존 app dead-code 및 프런트엔드 chunk 크기 경고가 남아 있다. 로그는 `/tmp/box-md-gh72-{types,build,fmt,rust,tests,acp-tests,native-tests,server}.log`이며 문서 링크/diff와 두 pin의 공유 source 비교도 통과했다.
