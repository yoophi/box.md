# 본문 링크와 backlinks MCP 조회 (gh-73)

gh-70을 gh-73(본문 조회) → gh-74(독립 연결 변경)으로 나누었다. gh-73은 완료된 gh-69, gh-74는 gh-73에 의존하며 부모 gh-70의 최종 검토는 gh-74 뒤에 수행한다. 기존 부모 gh-51의 gh-70 → gh-71 순서를 유지한다.

## 도구 계약

`get_document_links`는 `document: {path}` 또는 `{permalink}`를 받아 같은 pinned DocumentScope에서 원문을 조회한다. data에는 `document`의 상대 path/revision/permalink?, `links`, `backlinks`, `warnings`, `truncated`를 반환한다. 조회는 파일·ID·Git 이력이나 명시적 연결 저장소를 변경하지 않는다.

각 link는 permalink, alias(null 가능), raw 원문과 body 기준 UTF-8 byteStart/byteEnd를 제공한다. 위치는 frontmatter를 제외한 body에 상대적이며 JS UTF-16 문자 index가 아니다. state는 resolved/missing/duplicate/error 중 하나다. resolved에는 대상의 현재 상대 path/permalink/revision/title이 추가된다. backlink는 현재 문서의 permalink를 본문에서 참조한 문서 descriptor와 해당 link들을 반환한다. 원본 ID가 없는 path 문서는 링크 조회가 가능하며 backlinks는 비어 있다. 중복 ID의 참조를 특정 파일로 임의 해석하지 않는다.

대상 제목은 frontmatter title → 첫 실제 Markdown heading → 파일명 순서다. code block 안의 heading은 사용하지 않는다. heading의 wikilink alias는 markup을 해석하지 않는 텍스트이며 HTML을 실행하지 않는다. 잘못된 title 타입이나 8,192 byte를 넘는 표시 제목은 error 상태로 반환한다. 대상 descriptor/제목은 한 query 안에서 cache해 같은 대상의 반복 링크가 metadata/heading 파싱을 반복하지 않게 한다.

## 공통 문법과 조회 한계

Rust pure domain parser는 `pulldown-cmark = 0.13.4`의 Markdown 이벤트와 원문 offset을 사용한다. parser의 decoded destination으로 opaque ID를 대체하지 않고 원문 `[[permalink]]` 또는 `[[permalink | alias]]`를 Box 문법으로 검사한다. alias의 추가 pipe·Unicode·HTML 형태 텍스트와 구분자 주변 공백을 보존한다. 기존 TS의 String.trim과 같은 공백 집합을 사용해 BOM은 제거하고 NEL은 ID byte로 유지한다. 공식 API 근거는 [Parser](https://docs.rs/pulldown-cmark/0.13.4/pulldown_cmark/struct.Parser.html)다.

공통 `packages/editor/fixtures/wikilinks.json` 16개를 실제 TS Tiptap parser와 Rust parser가 함께 읽는다. marks/list/table, inline/fenced/tilde/indented/blockquoted code, escaped opening, malformed syntax, CRLF, Unicode/opaque ID 및 inert alias를 대조한다. frontmatter 제외는 기존 lossless adapter를 사용하는 application body 경계와 실제 BOM/CRLF HTTP 검사에서 확인한다.

기존 metadata index는 64 MiB scan 한계를 유지하고 graph content 재조회도 별도 64 MiB 한계다. index 이후 revision이 바뀌거나 읽기/metadata 오류가 발생하면 warning을 남기고 유일성을 확인할 수 없는 대상은 error다. 이미 관찰한 중복은 duplicate로 유지한다. malformed metadata 문서의 header를 본문 backlink로 계산하지 않는다. 누락/오류를 숨긴 완전한 검색을 주장하지 않는다. 외부 editor와 동시에 저장소 전체의 원자 snapshot을 보장하는 API는 아니다.

source links와 모든 backlinks의 반환 token은 합계 10,000개, backlink 문서는 1,000개로 제한한다. source/per-document token 및 전체 backlink 한계에 도달하면 linkLimit/backlinkLimit warning과 truncated=true를 반환한다. raw token을 중간에서 자르지 않는다. 이 한계는 문서 원문을 수정하거나 링크를 삭제하는 동작이 아니다.

## 검증과 후속

`pnpm test:document-mcp`는 실제 TCP 회귀 8개를 실행하고 전체 문서 도구 11개의 HTTP 응답 49개를 독립 Ajv JSON Schema 2020-12로 검사했다. 추가된 실제 파일 검증은 링크·backlinks와 네 가지 대상 상태, target 파일 이동, malformed metadata 부분 결과, 원본·실제 connections.json byte 불변, global token 제한과 큰 제목/inert heading alias를 확인한다. 파일 IPC mock을 사용하는 검사가 아니다.

TypeScript 260개(공용 editor 90개 포함)가 통과했다. 기본 검사와 전체 Rust 실행 결과는 gh-73 작업 log에 기록한다. 로그는 `/tmp/box-md-gh73-{parser,editor-tests,http-schema,tests,native-tests,types,build,fmt,rust}.log`다. Rust dependency 추가 전 lock의 package identity는 유지하고 parser/unicase 두 identity를 추가한다.

현재 명시적 관계의 MCP list/create/attach/detach, 결과 reservation·owned mutation 및 재시도는 gh-74의 범위다. native grant/ACP 주입은 gh-52, 실제 설치 provider/native 전체 검증은 gh-53에 남아 있다.

관련 source: [pure parser](../apps/box-desktop/src-tauri/src/domain/wikilink.rs), [application](../apps/box-desktop/src-tauri/src/application/document_links.rs), [HTTP 검사](../apps/box-desktop/src-tauri/src/inbound/document_mcp/tests.rs), [공통 fixture](../packages/editor/fixtures/wikilinks.json), [TS fixture 검사](../packages/editor/src/wikilink-fixtures.test.ts), [기존 문서 도구](document-mcp-tools.md), [독립 연결 저장 계약](document-connections.md).
