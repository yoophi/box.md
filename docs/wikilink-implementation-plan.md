# permalink wikilink 구현 계획 (gh-18)

gh-18의 수용 기준 1~8을 기준으로 구현한다. `[[permalink]]`는 대상의 최신 제목을 표시하고 `[[permalink | alias]]`는 별칭을 표시한다. 원문에는 permalink와 원래 위키 링크 표기를 보관한다. gh-19의 독립 연결 엔티티를 생성하거나 삭제하지 않는다.

## 현재 구조와 구현 위치

- `packages/editor/src/index.ts`는 현재 `[[`를 지원하지 않는 문법으로 판단하여 문서 전체를 원문 모드로 연다. 공용 파서·serializer에서 위키 링크를 지원한 뒤 이 검사를 변경한다. 코드 블록과 inline code는 이미 문법 검사에서 제외한다.
- `apps/box-desktop/src/entities/document/permalink.ts`는 현재 작업 디렉터리의 문서를 8개씩 읽고 permalink를 해석하며 중복과 누락을 오류로 처리한다. 이 판정 규칙을 링크 표시와 클릭에서 공유한다.
- `MarkdownEditor.tsx`의 `RichEditor`는 문서가 바뀌면 새로 생성된다. 제목 조회 결과는 문서 Markdown에 삽입하지 않고 NodeView 표시 상태로 전달한다. 메타데이터 갱신 때문에 미저장 편집을 초기화하지 않는다.
- `HomePage.tsx`는 `boxmd:` 클릭을 기존 `workspace.request({ type: "permalink", path })`로 전달한다. 위키 링크도 이 경로를 사용하여 저장·버리기·취소 보호를 유지한다.

## Module과 interface

공용 editor module은 위키 링크 파싱·원문 보존·제목/별칭 표시를 맡고 파일 읽기나 Tauri에 의존하지 않는다. inline leaf atom에 `permalink`, `alias`, `raw`를 보관한다. 렌더링한 제목을 직렬화하지 않으며 표시 이름은 텍스트로 삽입한다. HTML clipboard는 검증된 원문 속성으로 복원하고 임의의 실행 가능한 HTML을 사용하지 않는다.

문서 해석 module의 interface는 현재 workspace의 permalink에 대한 제목과 `resolved`, `missing`, `duplicate`, `error` 상태를 제공한다. 실제 문서 reader와 테스트 reader가 이 seam의 adapter가 된다. 문서 읽기·메타데이터 검증·중복 판정·제목 추출·오래된 workspace 결과 무시는 module 내부에 둔다. 제목 우선순위는 frontmatter의 비어 있지 않은 `title`, 본문의 첫 Markdown 제목, 파일명 순서로 정한다. 코드 블록 내부의 제목처럼 보이는 문자열은 제목으로 사용하지 않는다.

표시 결과 갱신은 편집기 본문을 변경하지 않는 방식으로 적용한다. 문서 열기, 저장, 작업 디렉터리 목록 새로고침 후 해석 결과를 갱신한다. 이전 디렉터리의 비동기 결과가 새 디렉터리 링크에 적용되지 않도록 한다. 클릭 시에는 현재 workspace에서 다시 확인하여 누락·중복 대상이나 이전 경로를 임의로 열지 않는다. 부분 목록만 제공되는 디렉터리에서 대상의 유일성을 입증할 수 없으면 임의로 선택하지 않고 제한을 표시한다.

## 하위 td task와 실행 순서

GitHub 연결 복구 후 gh-32, gh-33, gh-34를 등록했다. 앞 task의 구현·필요 검증·커밋을 완료한 뒤 다음 task를 진행한다.

| 순서 | 하위 task 제목 | 완료 기준 | 의존성 |
| --- | --- | --- | --- |
| 1 | gh-32 공용 편집기 wikilink 파싱·원문 보존 구현 | 두 문법과 구분자 공백, Unicode 별칭, 여러 링크, 코드/inline code 제외, 잘못된 표기의 보존, leaf atom 및 Markdown/HTML 왕복 검증. 원문 표시 제목이 permalink를 대체하지 않음. | 없음 |
| 2 | gh-33 workspace permalink 해석 및 제목·별칭 링크 표시 연결 | 제목 우선순위와 최신 제목, 별칭 유지, 누락/중복/조회 실패 상태, 파일명·경로 변경 후 연결 유지, workspace 전환 시 오래된 결과 차단. 기존 dirty guard를 사용하는 클릭 이동. 현재 작업 디렉터리 범위 제한. | gh-32 |
| 3 | gh-34 wikilink 문서 이동·보존 통합 검증 | 실제 Chromium에서 보기/서식/원문 전환, 제목 변경, 별칭, 링크 이동과 저장·버리기·취소, 주변 편집·저장·재열기 보존, 누락/중복 및 코드 제외 확인. 수용 기준 1~8 문서화와 기본 검사. | gh-33 |

세 task 모두 `--type task --priority P2 --parent gh-18`로 등록했다. 상위 gh-18은 gh-34에 의존하며 검증 근거를 모두 확인한 뒤 검토·승인한다. 앞선 Mermaid gh-31과 상위 gh-16의 검토·승인 및 push는 완료했다.

## 공용 원문 보존 구현 (gh-32)

`packages/editor/src/wikilink.ts`는 inline leaf atom에 `permalink`, `alias`, `raw`를 보관한다. 구분자 주변 공백을 해석하면서 serializer는 원래 공백과 위키 링크 표기를 반환한다. 여러 링크와 굵게/목록/표 안의 링크를 지원한다. 별칭은 텍스트로 표시하며 HTML이나 다른 Markdown 문법으로 실행·해석하지 않는다. 코드 블록과 inline code 및 이스케이프한 여는 대괄호는 링크로 해석하지 않는다. 비어 있거나 닫히지 않은 표기는 일반 텍스트로 보존한다.

HTML clipboard는 `data-wikilink-raw`를 다시 파싱하여 식별자와 별칭을 복원한다. 표시된 제목이 바뀌어도 직렬화한 원문의 식별자는 유지한다. 올바르지 않은 raw 속성은 위키 링크로 가져오지 않는다. 일반 링크 mark보다 먼저 해당 anchor를 읽으며 내보낸 별칭의 HTML 형태 문자열은 이스케이프된 텍스트로 남는다.

공용 편집기 40개 중 wikilink 검증 13개가 이를 확인한다. 기존 `[[Logseq]]`를 지원하지 않는 문법으로 판단하던 테스트는 제거했다. 위키 링크 안의 HTML 형태 문자열이나 `$`는 원문 모드 강제 조건에서 제외하되, 링크 밖의 지원하지 않는 문법은 기존처럼 원문 모드로 연다.

현재 기본 표시명은 별칭 또는 permalink다. 대상의 최신 제목과 누락·중복 상태 표시는 gh-33, 앱 화면의 이동·저장·재열기 전수 검증은 gh-34에서 완료한다. 상위 gh-18은 아직 완료하지 않는다.

## 검증 범위

공용 테스트는 parser/serializer와 schema 계약을, 문서 해석 테스트는 실제 interface의 중복·제목·오류 판정을 확인한다. Chromium 테스트는 실제 앱과 편집기를 사용하며 native 파일 IPC를 테스트 adapter로 대체했다는 범위를 문서에 명시한다. `pnpm check-types`, `pnpm test`, `pnpm --filter @box/desktop test:browser`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`를 실행한다.
