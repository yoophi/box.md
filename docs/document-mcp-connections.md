# 독립 연결 MCP 변경과 수명 (gh-74 / gh-70)

기존 앱 프로필의 `ConnectionService`/`connections.json`을 backend가 `FsDocumentScopeFactory.with_connections`로 주입한다. production setup은 native Tauri 연결 command와 같은 Arc를 사용한다. 문서 작업 디렉터리를 바꿔도 연결 저장소를 다른 위치로 옮기거나 새 파일로 대체하지 않는다. 본문 wikilink와 별도 엔티티/membership 모델은 유지한다.

## 도구와 범위

| 도구 | 입력 | 성공 data |
| --- | --- | --- |
| list_connections | document? (현재 작업 루트의 path/permalink 참조) | connections snapshot, warnings, truncated |
| create_connection | name, requestId | 생성한 connection(id/name)과 connections snapshot |
| attach_connection | connectionId, permalink, requestId | 변경된 connections snapshot |
| detach_connection | connectionId, permalink, requestId | 변경된 connections snapshot |

연결 namespace는 기존 앱 프로필 전체의 공유 데이터다. document를 생략한 조회는 독립 엔티티와 저장된 memberships를 반환한다. document 필터는 현재 scope의 문서를 읽고 저장된 permalink에 속하는 관계·엔티티만 반환한다. 각 membership의 실제 문서 경로는 현재 작업 루트에서만 해석한다. 루트에 없거나 삭제된 ID는 unresolved, 중복은 duplicate, 부분 목록/읽기 실패는 error다. 다른 작업 루트의 ID가 저장돼 있어도 외부 파일을 열거나 절대 경로를 반환하지 않는다.

attach/detach의 permalink는 기존 독립 저장 모델처럼 opaque 논리 ID다. 파일명이 아니며 파일을 생성·수정하지 않는다. 아직 파일이 없거나 루트 밖의 ID도 관계 데이터에 존재할 수 있다. 엔티티/문서 쌍의 중복은 추가하지 않고 detach는 요청한 쌍만 제거한다. 관계 해제 시 엔티티, 다른 membership, 문서를 유지한다. name 정규화·중복 및 저장 형식 검증은 기존 도메인이 담당한다. 고정 도구 객체의 unknown key/type과 scope-local requestId 검사를 함께 수행한다.

## 수락, reservation과 재시도

세 변경은 문서 변경과 같은 DocumentScope admission, owned worker와 requestId journal을 사용한다. 문서/관계 operation 사이에 같은 requestId를 다른 payload로 재사용하면 requestIdConflict다. root generation 안의 재시도는 처음 결과를 반환하며 생성 UUID를 다시 뽑거나 관계를 다시 저장하지 않는다. native UI가 별도로 변경한 최신 연결 파일도 기존 process lock에서 읽으므로 다른 관계를 덮어쓰지 않는다.

`ConnectionRepository.transact`의 exclusive read/edit 단계에서 도메인을 적용·검증하고 정확한 JSON 결과를 준비한다. journal count/byte reservation이 성공한 뒤에만 저장소가 임시 파일을 sync하고 원자적으로 교체한다. capacity 실패나 잘못된 name/entity는 profile 파일을 바꾸지 않는다. 실패 결과도 같은 요청에 보존한다. 연결 변경은 문서 파일과 Git 문서 이력을 기록하지 않는다.

HTTP future가 취소돼도 수락한 worker와 scope permit은 유지된다. 실제 workspace select는 이전 scope의 신규 요청을 막고 수락 작업이 완료될 때까지 기다린다. 완료 뒤 새 generation과 같은 프로필 연결 서비스를 공개한다. 이전 principal의 새 요청은 scopeRevoked다. journal은 기존 계약처럼 앱 재시작을 넘는 retry 보장을 제공하지 않는다.

## 검증과 부모 기준

실제 HTTP/temporary filesystem에서 다대다 공유, 부분 해제, 같은 nonce 재시도·다른 payload 거부, 동시 생성/연결, root별 resolved/unresolved, unknown entity/name와 입력 검증을 확인한다. 연결 작업 전후 두 원본 Markdown의 byte가 같고 본문·metadata ID/title 변경 및 복구 삭제 전후 connections.json byte가 같다. 저장된 ID 변경이 기존 관계를 새 ID로 자동 이동시키지 않는다.

TCP 유실 검사는 결과 reservation 뒤 profile persist 이전에 exclusive transaction을 barrier에서 대기시킨다. 실제 socket을 닫고 재시도해 엔티티 하나만 생성됨을 확인한다. 같은 barrier에서 실제 `DocumentWorkspace.select`를 호출하면 old admission 중단 이후에도 새 root 공개가 대기하고, 수락된 연결 저장 후 새 generation과 엔티티를 확인한다. 직접 admission stop만으로 root 전환을 대신하지 않는다. application capacity 검사는 create/attach/detach 각각에서 reservation 실패와 최초 실패 재시도 cache, 실제 profile/source byte 불변을 확인한다.

| gh-70 기준 | 증거 |
| --- | --- |
| 본문 토큰·backlinks·code/escape 제외 및 해결 상태 | gh-73 공통 TS/Rust fixture 16개와 [본문 조회 검증](document-mcp-links.md) |
| 명시적 관계 list/create/attach/detach 실제 HTTP | gh-74 네 도구와 실제 profile snapshot/UUID/pair 결과 |
| 본문/metadata와 관계 독립, 다대다·부분 해제·미해결 | 실제 두 원본 및 connections.json 보존, ID/title 변경·삭제 및 다른 pair 유지 |
| nonce·동시·capacity·disconnect/root/drain | shared registry, 실제 HTTP concurrent/lost response, actual select + persist barrier, 세 operation capacity 이전 write 거부 |
| schema와 기본 검사·문서·단위 commit | `pnpm test:document-mcp`와 독립 Ajv 응답 검사, 관련 Rust 및 기본 검사 결과 |

현재 HTTP 회귀는 문서/본문/관계 도구 15개를 포함한다. 검사 로그는 `/tmp/box-md-gh74-{http-schema,capacity,native-tests,fmt,rust,types,build}.log`다. frontend 구현은 변경하지 않았고 gh-73의 TypeScript 260개 근거를 유지한다. production에서 아직 시작하지 않는 MCP adapter의 dead-code와 기존 frontend chunk 경고는 남아 있다.

최종 실행은 HTTP 회귀 12개와 독립 Ajv 실제 응답 83개/도구 15개, 앱 Rust 84개(helper 1개 ignored 및 subprocess 3회 각각 통과), capacity 회귀 및 types/build/fmt/workspace all-targets가 성공했다. Cargo/pnpm dependency와 vendor pin은 이 단위에서 변경하지 않았다. 문서 링크/diff 검사도 통과했고 기존 AgentChatSheet 두 파일의 외부 변경을 보존했다.

이 단위는 실제 loopback와 파일 검증이다. native grant/ACP 주입·main UI 외부 변경 반영은 gh-52, 설치 agent/native 창 전체 감사는 gh-53이다. 부모 gh-51의 전체 HTTP/auth/범위 감사는 gh-71에서 진행한다.

관련 source: [connection reservation](../apps/box-desktop/src-tauri/src/application/connection_service.rs), [공통 mutation](../apps/box-desktop/src-tauri/src/application/document_mutations.rs), [실행](../apps/box-desktop/src-tauri/src/application/prepared_mutations.rs), [scope factory](../apps/box-desktop/src-tauri/src/infrastructure/document_scope_factory.rs), [profile 주입](../apps/box-desktop/src-tauri/src/lib.rs), [HTTP 검사](../apps/box-desktop/src-tauri/src/inbound/document_mcp/tests.rs), [capacity 검사](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs).
