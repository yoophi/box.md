# 작업 루트 문서 application (gh-59)

`DocumentScope`는 이미 선택된 directory handle과 generation에 연결된 조회·검색·생성·변경·metadata·복구 삭제 API를 제공한다. 루트 인자를 받지 않으며 응답에는 상대 문서 경로만 넣는다. 모든 호출은 gh-58의 같은 `DocumentService` mutex 안에서 실행하고 기존 native UI의 저장·revision·Git 이력을 공유한다. MCP handler와 requestId/task 수명은 각각 gh-51, gh-60에서 연결한다.

## 문서 식별과 저장

`DocumentRef`는 `{path: string}` 또는 `{permalink: string}` 중 하나이며 둘 다 지정하거나 알 수 없는 필드를 넣으면 역직렬화가 실패한다. path는 기존 permalink 없는 문서를 다룬다. permalink는 요청마다 현재 파일 목록과 metadata에서 정확히 한 문서를 찾으며, 이동·개명 후에도 같은 ID로 조회한다. 없으면 notFound, 중복이면 duplicatePermalink, ID 자체가 비었거나 문서의 ID를 요구했는데 없으면 missingPermalink다. 마지막 read에서도 ID가 일치하는지 확인한다.

생성은 permalink가 없거나 null/빈 문자열이면 lossless adapter로 UUID를 추가하고 filesystem no-clobber 저장을 사용한다. update/metadata/delete는 비어 있지 않은 expectedRevision이 필요하다. 읽은 현재 revision과 저장소의 최종 CAS를 모두 확인하고 실패한 변경은 파일·이력을 갱신하지 않는다.

UI의 scoped save를 포함해 후보 frontmatter의 permalink/summary를 한 줄 문자열로 검증한다. 후보 ID가 있으면 해당 문서 자체를 제외한 현재 목록에서 중복을 검사한다. 불완전한 scan으로 고유성을 증명하지 않으며 workspaceUnavailable로 쓰기를 거부한다. 외부에서 중복이나 잘못된 metadata가 생긴 대상은 명시적 path와 올바른 revision으로 새 유효 내용을 저장해 수정할 수 있다. 선택 루트 밖의 명시적 native 직접 편집 흐름은 기존 서비스를 사용한다.

metadata API는 JSON 객체 조회와 최상위 patch/remove다. 겹치는 key, 잘못된 summary/permalink 타입, 지원하지 않는 JSON projection은 쓰기 전에 거부한다. 부분 CST 편집으로 BOM/CRLF, 변경하지 않은 nested 값·주석과 본문 byte를 유지한다. 응답의 JSON projection도 저장 전에 검증한다. 원문에 JSON으로 나타낼 수 없는 custom tag 등이 있으면 invalidMetadata이며 원본을 유지한다.

## 목록·검색·cursor

- 목록은 상대 path, revision, 선택적 permalink/summary를 반환한다. metadata 오류가 있는 파일도 path/revision을 표시하되 해당 속성은 생략하고 warnings를 추가한다. 읽기 실패도 상대 path와 code로 알린다.
- filesystem의 20,000 entry 및 파일별 8 MiB 한도에 더해 한 scan에서 인덱싱할 내용을 64 MiB로 제한한다. 파일을 읽은 뒤 크기를 확인하므로 마지막 한도 판정 파일까지 최대 72 MiB를 읽을 수 있다. 한도를 넘으면 truncated와 scanLimit warning을 반환한다. search 결과 역시 불완전한 scan 상태를 그대로 전달한다.
- 검색은 본문·summary·permalink의 Unicode 소문자 literal 검색이다. 임의의 다른 frontmatter 값은 검색 대상에 포함하지 않는다. excerpt는 해당 원문의 Unicode 경계를 유지하며 최대 3개, 각 240자 이하로 제한한다. 검색어는 비어 있지 않은 1024자 이하 문자열이다.
- limit은 1~100, 기본 50이다. cursor는 generation, 전체 관찰 목록의 path/revision/metadata/warnings digest, query hash, offset에 연결된다. 파일 내용·목록·검색어·generation이 달라지면 staleCursor다. cursor에 절대 루트나 자격 증명을 넣지 않는다.

조회마다 현재 파일을 읽으므로 영구 permalink index를 파일 identity 저장소로 사용하지 않는다. 이 mutex는 현재 service의 UI/scoped 검사→변경→이력을 직렬화한다. 협력하지 않는 외부 editor가 scan과 공개 사이에 쓰는 것을 전역 원자 transaction으로 보장하지 않으며, 감지한 revision 변경은 conflict다. gh-62의 [scope 수락과 종료 대기](document-scope-lifecycle.md)는 generation 전환/종료에서 수락한 UI/scoped 호출을 drain한다. gh-63의 [mutation 수명](document-mutation-lifecycle.md)은 requestId와 서버 소유 mutation을 연결한다.

## 삭제·복원과 이력

삭제는 원본 snapshot과 trashId를 반환하고 `.box.md/trash`에 보존한다. 기존 Git 이력과 별도 connections 데이터는 지우지 않는다. `read_trash` port는 관리 디렉터리를 생성하거나 파일을 공개하지 않고 retained snapshot을 검사한다. application은 복원 전에 metadata·ID 중복을 확인한다. 실제 restore는 읽은 trash slot handle을 유지한 채 filesystem no-clobber 공개를 수행한다.

복원 경로에 새 문서가 있거나 다른 문서가 보존 ID를 사용하면 실패하고 새 원본과 복구 데이터를 유지한다. 복원 성공은 기존 내용·revision을 유지하며 같은 이력 서비스를 사용한다. 저장·삭제·복원 뒤 이력 오류는 historyWarning으로 전달하며 이미 성공한 파일 변경을 실패로 바꾸지 않는다.

## 검증

실제 임시 파일 application 검사 9개는 nested/Unicode·BOM 문서와 UUID 생성, missing/duplicate/개명 조회, CRLF 본문·주석/nested metadata 보존, invalid patch 원본 유지, native/scoped 동시 CAS와 이력 한 번 변경, no-clobber 생성·복원, duplicate 복원 전 거부, 검색 대상·Unicode excerpt·페이지/cursor 만료, metadata/encoding warning, 64 MiB scan 한계 및 외부 path 원본 보존을 검사한다. gh-58의 native IPC·root pin·기존 저장 회귀도 함께 실행한다.

```sh
CARGO_INCREMENTAL=0 cargo test -p box-desktop --lib
CARGO_INCREMENTAL=0 cargo test -p box-document-store
pnpm test
pnpm check-types
pnpm build
cargo fmt --all -- --check
CARGO_INCREMENTAL=0 cargo check --workspace --all-targets
```

이번 application 검사는 실제 macOS 창이나 실제 설치 agent의 MCP 도구 사용을 대체하지 않는다. 실행 중인 NativeQA는 이 변경 전 번들이며 재빌드하지 않았다. gh-60의 requestId/accepted-task/drain, gh-57의 전체 감사, gh-51~gh-53의 HTTP MCP·native grant·ACP/UI 이벤트 및 실제 사용 검증은 계속 남아 있다.

최종 실행 결과는 Rust 앱 43개 통과(helper 1개 ignored), 저장소 파일 시스템 15개와 metadata 16개 통과, 전체 TypeScript 236개 통과다. 타입 검사·frontend build·Rust format·workspace/all-targets check도 통과했다. gh-51에서 아직 연결하지 않은 새 application API의 dead-code 경고와 기존 AW 경고는 남아 있다. 검사 로그는 `/tmp/box-md-gh59-{native-tests,store-tests,ts-tests,types,build,fmt,rust}.log`에 기록했다.
