# 작업 루트 문서 저장소 (gh-54)

`crates/document-store`는 기존 `DocumentSnapshot`, `DocumentError`, `DocumentRepository` 계약과 새 `ScopedDocumentRepository` 계약을 제공한다. 앱의 기존 domain/ports 경로는 이 계약을 재export한다. 기존 `FsDocumentRepository`와 새 `ScopedFsDocumentRepository`가 같은 port를 구현하며, application/domain에는 파일 시스템 API를 추가하지 않았다.

gh-54는 실제 파일 저장소 기반이다. MCP 도구나 native command는 아직 이 adapter를 등록하지 않는다. metadata, permalink, 기존 `DocumentService`의 저장 이력과 UI 경로 통합은 gh-55/gh-56에서 진행한다. 전체 범위는 [MCP 구현 계획](document-mcp-implementation-plan.md)을 따른다.

## 범위와 경로

`ScopedFsDocumentRepository::open`은 사용자 설정으로 선택한 절대 디렉터리를 한 번 열어 directory handle을 소유한다. 이후 read/list/save/trash/restore는 이 handle에서 상대 경로로 수행한다. 매 요청 absolute path를 canonicalize한 뒤 다시 여는 방식을 사용하지 않는다.

- 각 부모 디렉터리를 한 구간씩 `open_dir_nofollow`로 연다. 파일도 no-follow로 열고 일반 파일인지 확인한다. FIFO open에는 Unix `O_NONBLOCK`을 사용해 타입 검사 전에 대기하지 않게 한다.
- 절대 경로, `.`/`..`/빈 구간, backslash, Windows drive prefix, control 문자를 거부한다. 확장자는 대소문자를 무시한 `.md`, `.markdown`, `.mdown`이다.
- hidden 디렉터리, `node_modules`, `target`, 관리 경로 `.box.md`는 일반 문서 경로와 목록에서 제외한다. 기존 앱처럼 `.note.md`와 같은 일반 dot 파일은 허용한다.
- 경로 이름이 바뀌어도 권한은 처음 연 디렉터리 객체에 남는다. 원래 루트 이름을 외부 symlink로 바꿔도 외부 디렉터리로 재연결하지 않는다. 열린 하위 디렉터리가 이동하면 그 handle이 가리키는 객체에 접근한다. 루트 변경 시 기존 scope 폐기는 gh-52의 application 수명 관리 책임이다.

라이브러리는 `cap-std = 4.0.3`, `cap-fs-ext = 4.0.3`에 고정했다. no-follow 동작과 handle 상대 경로 작업은 배포 crate의 공식 소스를 확인했다. `open_dir_nofollow`는 마지막 구간에 적용되므로 전체 경로를 한 번에 전달하지 않는다. 근거: [Dir 구현](https://github.com/bytecodealliance/cap-std/blob/b7acf8e8807fe3fab991884d2208b7e03d35a409/cap-std/src/fs/dir.rs), [DirExt 구현](https://github.com/bytecodealliance/cap-std/blob/b7acf8e8807fe3fab991884d2208b7e03d35a409/cap-fs-ext/src/dir_ext.rs), [sandboxed hard-link](https://github.com/bytecodealliance/cap-std/blob/b7acf8e8807fe3fab991884d2208b7e03d35a409/cap-primitives/src/fs/hard_link.rs).

## 읽기·목록·저장

revision은 파일의 원본 byte SHA-256이다. 읽기와 저장은 8 MiB로 제한하며 UTF-8 오류를 반환한다. 잘못된 UTF-8 기존 파일을 replacement 문자열로 덮어쓰지 않는다. 목록은 상대 경로로 정렬하고 symlink를 제외한다. 읽을 수 없는 구간과 경로 encoding 오류는 warnings로 전달하며 20,000 entry scan을 넘으면 `truncated: true`를 반환한다. 목록 완전성이나 permalink 고유성을 불완전한 scan으로 주장해서는 안 된다.

새 파일은 `expectedRevision: None`일 때만 생성한다. 기존 파일은 현재 byte revision과 일치하는 `Some(revision)`이 필요하다. 같은 부모 handle 안에 UUID staging 파일을 만들고 내용을 write/fsync한 뒤, 생성은 no-clobber hard-link, 변경은 atomic rename으로 공개한다. 생성 파일은 Unix mode 0600이며 변경은 기존 permissions를 보존한다. 성공 snapshot은 저장 문자열과 새 revision을 반환한다. staging 파일은 정리한다.

인스턴스 내 mutex와 `.box.md/documents.lock`의 OS 파일 잠금이 협력하는 저장소 인스턴스의 mutation을 직렬화한다. 잠금 파일은 exclusive create를 먼저 시도하고 이미 있으면 no-follow로 연다. 저장 직전 revision을 다시 확인한다. 같은 내용을 다시 저장하면 content revision이 바뀌지 않으므로, content revision은 mutation 횟수나 파일 identity가 아니다.

일반 외부 editor는 이 잠금을 따르지 않을 수 있다. 최종 확인과 rename 사이의 비협력적인 쓰기까지 OS 수준의 원자적 compare-and-swap으로 보장하지 않는다. atomic 공개는 부분 파일이 보이지 않는다는 의미다. 이 구현은 process 재시도 journal이나 power-loss transaction을 제공하지 않는다. requestId dedupe와 accepted-task drain은 gh-56에서 구현한다.

## 복구 삭제

삭제는 expected revision과 UTF-8을 확인한 뒤 `.box.md/trash/<UUID>/manifest.json`에 원래 상대 경로와 revision을 저장하고 같은 루트 내 `document.md`로 rename한다. 성공은 `trashId`와 삭제 전 snapshot을 반환한다. 일반 목록은 이 데이터를 제외한다. 새 저장소 인스턴스도 `trashId`로 복원할 수 있다.

복원은 manifest 경로를 다시 검증하고 보존 파일의 revision을 확인한 뒤 no-clobber hard-link로 원래 경로에 공개한다. 이미 새 문서가 있으면 그 문서와 보존 데이터를 모두 유지하며 conflict를 반환한다. permissions와 내용 byte를 유지한다. 복원 이후 데이터 파일을 제거하고 manifest는 남겨 반복 복원을 notFound로 처리한다. 공개 후 cleanup이 실패하면 보존 복사본을 남기고 복원 성공을 반환한다. 이 경우 반복 복원은 기존 파일 때문에 conflict로 처리하며 덮어쓰지 않는다.

삭제 직전·직후 비협력적인 파일 교체가 감지되면 원래 경로에 no-clobber rollback을 시도한다. 이미 새 파일이 있어 rollback할 수 없으면 보존 데이터를 지우지 않고 오류에 복구 데이터 ID를 표시한다. 이 예외 경로는 성공한 삭제로 보고하지 않는다. 바뀐 byte나 symlink 때문에 원래 manifest 검증이 실패하는 데이터는 자동 복원할 수 없으며 수동 확인이 필요하다.

## 검증

[실제 임시 파일 시스템 테스트](../crates/document-store/tests/filesystem.rs)는 Unicode/중첩 목록, 원본 CRLF/BOM byte, 생성·수정·stale/deleted revision, 서로 다른 인스턴스의 동시 생성/CAS, 권한 보존, oversized/invalid UTF-8 원본 보존, 재시작 후 삭제 복원과 복원 충돌, 변조된 manifest/data, scan 한계를 검사한다. Unix 테스트는 외부 leaf/parent/관리/잠금 symlink, 반복적인 동시 부모 symlink 교체, 루트 이름 교체, FIFO 거부, 저장 중 읽기의 완전한 파일 관찰을 검사한다. 외부 파일의 내용과 파일 개수가 그대로인지 확인한다.

```sh
CARGO_INCREMENTAL=0 cargo test -p box-desktop --lib
CARGO_INCREMENTAL=0 cargo test -p box-document-store
CARGO_INCREMENTAL=0 cargo clippy -p box-document-store --all-targets -- -D warnings
pnpm check-types
pnpm build
cargo fmt --all -- --check
CARGO_INCREMENTAL=0 cargo check --workspace --all-targets
```

실행 환경은 macOS arm64와 로컬 Rust 1.99다. gh-54 당시 MSRV 1.89는 `std::fs::File::lock`을 반영했다. gh-55에서 YAML dependency를 추가하며 현재 crate MSRV를 1.96으로 올렸다. [metadata adapter 계약](frontmatter-rust-adapter.md)을 참고한다. 해당 구버전 toolchain 및 다른 OS의 실행 검증은 수행하지 않았다. native 화면·ACP agent 검증은 이 저장소 테스트의 범위에 포함하지 않는다.

`cargo test --workspace`도 시도했으나 vendored AW 통합 테스트 실행 파일을 빌드하는 중 디스크 공간 부족으로 중단됐다. 전체 workspace 테스트가 통과했다고 주장하지 않는다. 위 두 package 검증으로 변경한 저장소와 기존 Box application의 저장·이력 동작을 실행 검증하며, 전체 target 컴파일은 별도 기본 검사로 수행한다.

gh-54 완료 검증: 저장소의 실제 파일 테스트 15개, 기존 Box unit 테스트 28개가 통과했다. Box의 ignored peer-worker 1개는 기존 다른 프로세스 동시성 테스트가 하위 프로세스로 실행한다. 기본 검사 네 가지와 저장소 crate의 `clippy -D warnings`, 문서 상대 링크 및 `git diff --check`도 통과했다. AW 기존 deprecated API 경고와 프런트엔드 chunk 크기 경고는 남아 있다.
