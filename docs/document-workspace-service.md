# 작업 루트와 문서 서비스 공유 (gh-58)

backend의 `DocumentWorkspace`가 선택한 루트와 generation을 보관한다. 각 루트는 directory handle에 고정된 `ScopedFsDocumentRepository`, 기존 `DocumentService`의 mutex/저장 구현, 상대 경로를 기존 절대 경로 이력 키로 바꾸는 history adapter를 가진다. UI와 scoped 호출은 같은 service 인스턴스를 사용한다. application/ports는 Tauri나 파일 시스템 API를 직접 호출하지 않는다.

`select_document_workspace`는 main WebView 전용 native command다. `invoke_handler`, build AppManifest, main capability에 함께 등록했다. workspace 목록 preview는 기존 native 목록 API를 유지하며, 선택한 루트의 refresh는 capability 저장소로 수행한다. generation과 상대 warning을 snapshot에 추가하되 기존 path/documents/truncated 계약은 유지한다.

## 호출과 수명

- scoped handle의 read/revision/save/listing은 상대 Markdown 경로만 받는다. snapshot과 목록에 절대 루트나 history 경로를 넣지 않는다. 에이전트가 루트를 인자로 지정할 API를 제공하지 않는다.
- UI의 절대 파일 경로가 선택한 루트의 canonical/선택 alias에 속하면 같은 scoped service로 연결하고 응답 path를 UI의 절대 경로로 바꾼다. 그 밖의 명시적 native 파일 열기·다른 이름 저장·이력은 기존 native service를 사용한다. native의 hidden/build 파일 직접 편집도 유지하되 agent 목록/경로에는 포함하지 않는다.
- 현재 루트에서 파일 경로 이름이 교체되거나 외부 symlink가 생겨도 UI와 scoped 접근은 처음 연 디렉터리에 고정된다. refresh가 선택 루트를 absolute path로 다시 열지 않는다.
- 같은 경로 복원/초기화는 기존 generation을 유지한다. 명시적인 native directory 선택은 `rebind`로 새 directory handle을 선택할 수 있다. 다른 루트 선택에 성공하면 이전 handle의 신규 호출은 `scopeRevoked`다. 이미 수락한 동기 호출은 원래 service를 소유하여 끝까지 그 디렉터리에 접근한다. accepted mutation task의 재시도·전체 drain과 credential 폐기는 gh-60/gh-52에서 구현한다.
- 디렉터리 open 또는 초기 목록 실패는 현재 루트를 교체하지 않는다. UI는 preference 저장 성공 후 backend binding을 요청하며, binding 실패 시 이전 preference와 문서를 유지한다. storage 자체의 실패에는 backend binding을 요청하지 않는다.

scope 안의 파일은 gh-54의 8 MiB·UTF-8·일반 파일·no-follow 및 상대 경로 제한을 따른다. 이력 키는 기존 canonical 절대 파일 path를 그대로 사용해 먼저 기록한 native 이력을 이어 읽는다. scoped history 오류는 절대 경로를 제거한 메시지로 반환하며, 저장 성공 후 이력 오류는 기존 `historyWarning`이다.

## 검증

실제 임시 파일을 사용하는 service 검사 5개가 다음을 확인한다.

- native와 scoped save의 revision·내용·기존 Git 이력 키 일치, stale UI revision 충돌
- 같은 revision으로 native/scoped가 동시에 저장하면 한 번만 저장·이력 변경
- 다른 루트로 전환한 뒤 old handle 신규 호출 거부 및 native의 루트 밖 명시적 편집 유지
- history 실패 시 내용 저장 성공과 warning의 절대 경로 제거
- 루트 이름을 외부 symlink로 교체해도 원래 파일 접근, leaf symlink 거부, 명시적인 rebind

컴파일된 앱 context의 실제 IPC 테스트는 main에서 새 command와 기존 open/save를 실행해 scoped service의 같은 파일 변경을 확인한다. 외부 child WebView에서는 remote/local origin 모두 workspace binding, file read/write/history/list를 거부한다. 이는 mock runtime의 권한·command 실행 검증이며 macOS 창을 직접 검증한 것으로 주장하지 않는다.

HomePage 설정/문서 unit 19개와 browser settings 8개는 저장/취소/remount/dirty 보호·설정 실패를 검사한다. backend binding 실패의 preference rollback과 불완전한 목록의 경고 표시·permalink 조회 거부를 추가했다. 브라우저 fixture는 새 native binding command를 모사하며 실제 native filesystem 증명은 Rust 검사에서 제공한다.

최종 실행 결과는 Rust 앱 unit 34개 통과(하위 프로세스용 helper 1개 ignored), 전체 TypeScript 236개 통과, browser settings 8개 통과다. 기본 TypeScript 검사·frontend build·Rust format·workspace/all-targets check도 통과했다. 현재 macOS 앱 창을 열어 문서 목록·편집기·채팅 패널 표시를 확인했으나, 이 실행 확인을 새 backend의 전체 native 수용 기준 검증으로 계산하지 않는다.

```sh
CARGO_INCREMENTAL=0 cargo test -p box-desktop --lib
pnpm test
pnpm --filter @box/desktop exec playwright test tests/browser/settings.spec.ts
pnpm check-types
pnpm build
cargo fmt --all -- --check
CARGO_INCREMENTAL=0 cargo check --workspace --all-targets
```

gh-59에서 permalink/index/metadata/CRUD application을 확장하고 gh-60에서 mutation 소유·dedupe/drain을 연결한다. gh-57 전체 감사와 gh-51~gh-53 MCP/ACP/UI 이벤트·native 화면 검증은 유지한다. 실행 중인 사용자 앱의 설정이나 문서를 검증 목적으로 변경하지 않았다.
