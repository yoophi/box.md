# 문서 MCP native 호스트와 grant (gh-75)

앱 setup에 `DocumentMcpRuntime`을 등록했다. 최초 main grant 요청에서 AW 공용 `local-mcp-server`를 시작하고, 기존 `DocumentMcpHandler`와 같은 backend `DocumentScope`를 principal로 주입한다. listener는 `127.0.0.1:0`, 기본 HostConfig는 모든 Origin을 거부하고 요청 크기를 2 MiB로 제한한다. ACP process/stdio 구현과 AW vendor source는 추가·변경하지 않았다.

## native 명령

| 명령 | 인자 | 결과 |
| --- | --- | --- |
| get_document_mcp_grant | generation, runId | grantId, generation, runId, server(type=http/name/url/headers) |
| revoke_document_mcp_grant | grantId | 성공 시 null, 이미 폐기된 ID도 반복 폐기 가능 |

generation은 현재 backend 작업 루트와 일치하는지 검증하는 값이다. authority는 `DocumentWorkspace.scope()`에서만 선택하며 caller의 경로나 MCP tool 인자로 루트를 고르지 않는다. 두 명령을 invoke handler, build manifest와 main capability에 함께 등록했다. main label과 기존 Box native URL allowlist를 검사하고 grant 준비 후 URL·generation·scope 활동 상태를 다시 확인한다. 준비 중 루트가 바뀌면 늦은 결과를 폐기하고 scopeRevoked를 반환한다. child WebView에는 permission을 주지 않는다.

server는 기존 AW `SessionOptions.mcpServers` HTTP DTO와 같은 type/name/url/header 구조다. Authorization 값은 trusted native 응답을 통한 런타임 전달에만 사용한다. grant 모델과 응답 DTO는 Debug를 구현하지 않으며 credential을 문서·설정 파일·사용자 메시지·diagnostic에 기록하지 않는다. 실패 메시지는 provider 원문·token·작업 루트 경로를 포함하지 않는다. host 시작 실패는 mcpUnavailable로 정리하고 다음 요청에서 다시 시작할 수 있다.

## grant 수명과 authority

application `DocumentGrants`는 OS CSPRNG의 32바이트를 lowercase hex 64자로 만든 credential을 사용한다. 같은 generation/run 재요청은 처음 grantId/credential을 반환한다. 한 run의 폐기는 해당 credential만 제거하며 다른 run과 native 문서 접근을 유지한다. 폐기된 run은 같은 generation에서 새 credential로 자동 부활하지 않는다. 새 generation에서는 같은 run 문자열을 새 grant로 바인딩할 수 있다.

credential 조회는 메모리 registry와 `ScopeAdmission.is_active`를 확인한다. 작업 루트 current mutex나 filesystem을 조회하지 않는다. root 전환이 old admission을 닫으면 native command의 record 정리 전에도 old credential은 HTTP 401이다. 같은 경로의 강제 rebind도 generation 변경으로 구분한다. 정상 native workspace 선택 후 비활성 records를 정리한다. 폐기 tombstone은 weak scope를 사용하고 종료된 generation의 records는 제거한다. registry는 활성 generation/run records를 폐기 tombstone을 포함해 최대 1024개로 제한하며 초과하면 grantCapacity를 반환한다.

main 창 파괴는 runtime을 retire하여 신규 credential 인증을 막는다. 앱 Exit는 HTTP 신규 수락 중단 → DocumentWorkspace.close_and_drain → host shutdown 순서다. host 시작·종료는 runtime 소유 mutex에서 직렬화하며 종료된 runtime은 다시 열지 않는다. 종료 실패는 고정된 일반 로그만 남긴다.

credential 폐기는 이미 수락된 문서 변경의 worker/permit을 취소하지 않는다. TCP가 끊기거나 root/앱 종료가 시작돼도 기존 application owned mutation과 이력이 완료된 후 drain이 끝난다. 프로필 연결 저장소와 문서 mutation/CAS/journal은 기존 공유 서비스를 그대로 사용한다.

## 검증

실제 ephemeral HTTP와 temporary filesystem에서 nonce별 credential 재사용, 서로 다른 run의 독립 폐기, root 이동·같은 경로 rebind, old principal 거부·새 generation 파일 쓰기, 시작 실패 재시도·동시 준비, permanent shutdown과 listener 해제를 확인했다. entropy 실패와 잘못된 token provider 결과는 credential을 발급하거나 원문을 노출하지 않는다.

연결 유실 검사는 실제 TCP 요청을 보내 원자 파일 공개 뒤 Git history를 barrier에서 대기시키고 socket을 닫는다. grant 폐기 후 실제 Workspace.select는 old admission을 막고 accepted write를 기다린다. 별도 종료 검사는 HTTP admission을 먼저 닫고 workspace drain이 동일 worker를 기다림을 확인한다. release 뒤 실제 파일 내용과 원본/변경본 Git 두 버전을 확인하며 새 root는 자기 문서를 읽는다. native 이력 키는 canonical 경로를 사용한다.

Tauri framework IPC 검사는 실제 handler/manifest/capability context에서 main으로 grant를 받아 HTTP 호출하고, 세 origin의 외부 child가 발급·폐기 모두 거부됨을 확인한다. main 폐기 뒤 401, stale generation 거부와 새 generation 발급을 확인한다. 추가 IPC barrier 검사는 grant 준비 중 backend 루트를 바꾸고 old generation 응답이 거부되는지 검사한다. 이 검사는 최신 macOS 화면이나 설치 agent의 실제 사용을 대신하지 않는다.

| 검사 | 결과 |
| --- | --- |
| cargo test -p box-desktop --lib document_mcp --locked | MCP 및 native IPC 22개 통과 |
| pnpm test:document-mcp | inbound HTTP/runtime 20개 통과, 독립 Ajv 실제 응답 143개/15도구 검증 |
| cargo test -p box-desktop --lib --locked | 앱 Rust 94개 통과, helper 1개 ignored 및 subprocess 3회 각각 통과 |
| pnpm check-types / pnpm build | 성공 |
| cargo fmt --all -- --check / cargo check --workspace --all-targets --locked | 성공 |

Rust 실행은 CARGO_INCREMENTAL=0으로 재생성 캐시를 줄였다. 로그는 `/tmp/box-md-gh75-{mcp-tests,http-schema,native,types,build,fmt,rust}.log`다. 컴파일 경고는 기존 미사용 service API 4개와 frontend chunk 경고가 남아 있다. Cargo dependency 버전과 lock, pnpm lock, vendor pin은 유지하며 tokio sync feature만 직접 명시했다. 기존 사용자 AgentChatSheet 두 파일을 보존하고 이 단위 커밋에 포함하지 않는다.

## 후속

gh-76은 이 native grant를 AW 공유 HTTP ACP session에 주입하고 실패/EOF/종료·disposal 수명과 HTTP 미지원 진단·일반 채팅 선택을 연결한다. gh-77은 main 변경 이벤트와 clean/dirty·undo 보호, gh-78은 부모 gh-52 전체 통합 감사다. 실제 설치 agent와 최신 native 전체 검증은 gh-53이다.

관련 source: [grant registry](../apps/box-desktop/src-tauri/src/application/document_grants.rs), [native runtime](../apps/box-desktop/src-tauri/src/inbound/document_mcp_runtime.rs), [native 명령](../apps/box-desktop/src-tauri/src/inbound/document_mcp_commands.rs), [CSPRNG](../apps/box-desktop/src-tauri/src/infrastructure/random_document_grant_token.rs), [main/child IPC](../apps/box-desktop/src-tauri/src/document_mcp_permission_tests.rs), [실제 HTTP/drain](../apps/box-desktop/src-tauri/src/inbound/document_mcp_runtime/tests.rs), [후속 계획](document-mcp-native-integration-plan.md).
