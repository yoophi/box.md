# 생성일순 문서 생성과 복제 계획 (gh-64)

신규 문서와 복제본은 선택한 작업 디렉터리에 `{permalink}.md`로 생성한다. ID는 앱 로컬 시각의 `yyMMddHHmmss`와 OS CSPRNG 4 byte의 소문자 hex 8자를 `-`로 연결한다. shell 실행 없이 `date +%y%m%d%H%M%S`와 `openssl rand -hex 4`에 해당하는 값을 만든다. 기존 문서의 ID나 파일명을 일괄 변경하지 않는다.

infrastructure 구현은 Cargo.lock에 존재하는 chrono 0.4.45와 getrandom 0.4.3을 사용한다. `Local::now()`로 로컬 시각/offset을 얻고 `getrandom::fill`로 OS random byte를 채운다. adapter 실패를 정상 ID로 숨기지 않는다.

## 구현 완료 판정 (2026-10-13)

서비스/native gh-66 (`2aed2ec`), UI gh-67 (`7aa9437`), 수용 기준 감사 gh-68 (`43bfe8e`)를 각각 구현·검증하고 main에 push했다. [최종 감사](document-creation-duplication-acceptance-audit.md)는 gh-64 기준1~7의 소스와 실제 파일·command 및 브라우저 UI 결과를 연결한다. 새 문서와 복제본의 ID 파일 생성, 원문 보존, Save As 제거 및 일반 저장/legacy 호환을 완료 판정한다.

UI와 MCP용 공통 mutation 계약은 같은 application을 사용한다. 문서 MCP handler의 실제 discovery/HTTP 실행은 gh-51, native grant/ACP 주입 및 외부 변경 UI 처리는 gh-52, 설치 agent와 최신 macOS 창 검증은 gh-53에 유지한다. 이 기능 감사로 해당 후속 작업을 완료 처리하지 않는다.

## 순차 구현 단위

1. **gh-66 · application/native 계약**: clock/random을 infrastructure port 뒤에 두고 같은 service mutex·CAS·Git 이력·request journal에서 신규 생성과 복제를 실행한다. ID와 파일 경로는 서버에서 결정한다. file/permalink 충돌은 새 난수로 재시도하고 no-clobber를 마지막 공개 조건으로 사용한다. 새 main 전용 command는 handler·AppManifest·permission을 함께 등록한다.
2. **gh-67 · UI 교체**: 신규 저장은 작업 디렉터리에 ID 파일을 생성한다. 다른 이름 저장과 이름 선택·덮어쓰기 dialog 및 Shift 저장 동작을 복제 흐름으로 교체한다. 일반 저장/직접 열기/legacy ID·CAS는 유지한다. 제목이 없으면 기존 문서 표시 제목을 복제 title의 기준으로 사용한다.
3. **gh-68 · 부모 기준 감사**: 실제 파일·UI 결과와 gh-64 기준1~7을 대조한다. 공통 생성·복제 입력/출력과 requestId/CAS 계약은 후속 gh-51 MCP handler도 사용한다. MCP runtime의 discovery/HTTP/ACP 실제 호출 검증은 gh-51~53에 유지한다.

세 단위를 gh-64의 td 하위 task로 등록했다. 선행 순서는 gh-56 → gh-66 → gh-67 → gh-68이며 gh-64는 마지막 gh-68에 의존한다. 개별 구현과 필요한 검증이 끝날 때마다 커밋·push·검토·완료 알림을 남긴다.

## 보존과 오류 처리

복제는 새 permalink와 `원래 title 사본`을 저장하며 나머지 metadata·주석·BOM·CRLF와 본문을 보존한다. 원본 파일·ID·Git 이력과 명시적 연결 관계는 변경하지 않는다. title 편집은 다른 YAML 값의 전체 재직렬화를 사용하지 않는다.

현재 화면의 미저장 내용을 복제하더라도 원본을 자동 저장하지 않는다. 성공 이전에는 원본의 content·undo·baseline을 보존하고 실패·취소·root 전환 또는 이전 문서의 늦은 응답으로 현재 편집기를 교체하지 않는다. 생성/복제 후 목록은 갱신하고 새 파일에 접근할 수 있게 한다. 기존 문서의 일반 저장은 기존 revision 검사와 이력을 사용한다.

시각/난수 실패나 충돌 재시도 한도 도달은 안전한 오류로 반환한다. 실패를 UUID나 사용자 파일명으로 대신하지 않으며 기존 파일을 덮어쓰지 않는다. 같은 requestId 재시도는 처음 생성된 ID/파일 결과를 다시 반환해야 한다.

## 검증

- 실제 파일: 로컬 날짜 형식·생성 시각 정렬·같은 초의 생성·강제 난수/파일/ID 충돌·no-clobber·동시 생성과 재시도 결과 일치.
- 복제: title/fallback·본문/metadata/주석/BOM/CRLF·원본과 이력/연결 불변, stale revision·capacity 실패·root drain.
- 화면: 신규 저장/복제·목록·메뉴/단축키·SaveAs 제거, 취소/오류/미저장 내용·undo·root/stale 응답 보호와 legacy 일반 저장.
- 계약: UI/native와 MCP용 공통 mutation, unknown path/root 거부와 main 권한/child 거부.
- 기본 검사: types/build/Rust fmt/workspace all-targets와 관련 테스트·문서 링크·diff 검증.

기반: [서비스 수용 기준 감사](scoped-document-service-acceptance-audit.md), [mutation 수명](document-mutation-lifecycle.md), [metadata adapter](frontmatter-rust-adapter.md), [MCP 계획](document-mcp-implementation-plan.md).
