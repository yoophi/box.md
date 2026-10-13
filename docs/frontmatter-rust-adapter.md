# Rust frontmatter adapter (gh-55)

`box-document-store`는 파일 I/O가 없는 네 가지 함수를 제공한다. [기존 TS 계약](../packages/editor/src/metadata.ts)과 [공통 fixture](../packages/editor/fixtures/frontmatter.json)를 사용하며, 실제 filesystem 저장·revision·이력 통합은 gh-56의 책임이다. 이 작업만으로 문서 MCP 또는 native/ACP 연결이 구현됐다고 판단하지 않는다.

| 함수 | 계약 |
| --- | --- |
| `document_property(markdown, key)` | 기존 TS getter처럼 미존재/null은 빈 문자열, 문자열은 해석한 값, 다른 타입은 오류다. alias/collection node는 문자열 getter에서 자동으로 펼치지 않는다. |
| `set_document_property(markdown, key, value)` | 기존 TS setter의 영문·숫자·`_`·`-` key 및 한 줄 값 규칙을 따른다. 빈 문자열은 삭제다. |
| `document_metadata(markdown)` | 아래 정책으로 전체 metadata JSON 객체를 반환한다. 일부 값을 조용히 생략하지 않는다. |
| `patch_document_metadata(markdown, patch, remove)` | 최상위 JSON 값 변경/삭제를 원문 CST 위치에서 수행한다. patch/remove 중복 및 remove 내 중복은 오류다. 실패 시 replacement를 반환하지 않는다. |

## 원문 보존

opening, YAML raw, closing과 본문 suffix를 별도로 보관한다. 선택적 BOM, delimiter의 space/tab, LF/CRLF, `---`/`...` closing 및 closing-at-EOF를 지원한다. opening이 없으면 일반 Markdown이며, 닫히지 않은 header는 `invalidMetadata`다. source span은 UTF-8 byte 위치를 사용한다. 원래 opening과 closing 이후 suffix는 그대로 붙이므로 본문을 YAML parser에 넘기거나 재직렬화하지 않는다.

`yaml-rt-core = 0.3.2`의 CST·scalar decoding·lexer·source patch API를 사용한다. 전체 YAML 값을 Serde로 다시 출력하지 않는다. scalar 교체는 해당 value span과 lexer가 구분한 inline comment를 사용한다. collection 교체는 사용자가 지정한 해당 subtree만 바꾼다. 새 key는 JSON 문자열로 반드시 quote하며, block/flow 삽입·삭제는 CST entry와 separator 위치에서 원문 문자열을 유지한다. root span을 교체하는 경우에도 기존 문자열을 그대로 복사하고 지정된 entry/쉼표만 삽입·제거한다.

변경하지 않은 nested 값·주석·공백·혼합 줄바꿈은 원래 문자열로 남는다. 선택된 scalar의 inline comment도 유지한다. entry를 삭제하면 그 entry에 속한 내용과 주석은 삭제할 수 있으며 다른 entry 및 entry 사이의 주석은 유지한다. 수정한 subtree나 새 속성의 표기는 기존 TS 출력과 byte 단위로 같다고 주장하지 않는다. typed JSON 값과 저장 후 실제 해석한 값이 일치하는지 재검사한다.

들여쓴 최상위 mapping을 parser가 거부하는 경우, 원문 앞에 파싱용 부모를 추가해 원래 byte를 그대로 CST로 읽는다. 이 부모는 내부 상태로만 관리하며 출력 시 정확한 prefix를 제거한다. 원문을 dedent/reindent하거나 실제 저장할 header에 부모를 추가하지 않는다.

## 의미와 오류 정책

모든 mapping의 중복 key를 재귀적으로 검사한다. 문자열은 decoded 값, 숫자는 정규화된 정확한 YAML 숫자, collection key는 구조를 기준으로 비교한다. cycle·unresolved alias와 malformed YAML은 오류다. header는 하나의 empty 또는 mapping 문서여야 하며 YAML/태그 directives와 multiple document는 지원하지 않는다.

문자열 getter와 JSON projection은 역할이 다르다. TS에서 unknown/해석할 수 없는 scalar tag가 warning과 문자열로 남는 경우, 문자열 getter는 그 동작을 따른다. JSON projection은 표현할 수 없는 tag를 오류로 반환한다. getter에서 alias는 TS `doc.get()`처럼 node 타입 오류지만 JSON projection에서는 유효한 acyclic alias를 펼칠 수 있다. `<<`는 core schema의 일반 key이며 merge expansion을 자동으로 수행하지 않는다.

| YAML 값 | JSON 조회 정책 |
| --- | --- |
| 문자열·null·bool·string-key mapping·sequence | JSON 타입으로 변환한다. |
| 유효한 core scalar tag, `!!map`/`!!seq`, non-specific `!` | 지원되는 해당 타입으로 해석한다. |
| integer syntax | JS safe integer 범위 `±9,007,199,254,740,991` 안에서만 제공한다. 큰 정수의 조용한 반올림을 거부한다. |
| finite floating syntax | JSON의 유한 f64로 제공한다. arbitrary decimal precision을 보장하지 않는다. |
| `.nan`/`.inf`, overflow, unknown tag, 잘못된 typed tag, non-string/complex key | `invalidMetadata`로 전체 조회를 실패시킨다. 일부 key/value를 생략하거나 문자열로 바꾸지 않는다. |
| cyclic/unresolved alias | `invalidMetadata`다. |

JSON projection 실패와 원문 편집 가능 여부는 구별한다. 표현할 수 없는 unknown subtree가 있어도, 다른 속성을 편집할 때 그 subtree를 그대로 유지할 수 있다. 이 경우 전체 JSON 조회는 계속 실패한다. application이 JSON 응답까지 필요한 mutation을 처리할 때는 저장 전에 그 응답 정책도 검증해야 한다.

`summary`와 `permalink`의 patch 값은 CR/LF가 없는 문자열이며 빈 문자열은 삭제다. 일반 key의 JSON null 저장은 삭제와 구별한다. 기존 getter는 원문에 있는 multiline 문자열을 반환할 수 있지만 새 summary/permalink 입력은 한 줄만 허용한다. 변경/삭제할 entry 안의 anchor를 바깥 alias가 참조하면 오류로 처리해 다른 속성이 조용히 바뀌거나 끊어지지 않게 한다. alias 자체를 새 값으로 바꾸는 것은 원래 anchor를 수정하지 않는다.

header 8 MiB, 탐색 깊이 128, node/alias expansion 100,000, 중복 key 비교 1,000,000으로 제한한다. 제한 초과 역시 `invalidMetadata`이며 저장 후보를 반환하지 않는다. 이 순수 adapter는 파일을 쓰지 않으므로 실패 후 원본을 복구할 별도 write가 필요하지 않다.

## 채택 과정에서 검증한 crate 보완

[조사 문서](frontmatter-rust-adapter-research.md)의 후보를 실제 fixture로 검증한 결과 아래 보완이 필요했다. 배포 버전의 공식 소스 commit은 `31d06fbd28722be65498e99ba56df6c2ada6ec4e`다.

- `semantically_equal`은 scalar를 비교할 때 `ResolvedScalar::String` 타입을 비교하고 실제 문자열 text를 포함하지 않는다. adapter가 별도의 key identity를 사용한다. [scalar 비교 소스](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/value.rs)
- 기본 숫자 resolver는 leading-zero decimal을 거부하고 binary·underscore·signed radix 문법도 읽는다. 기존 앱의 YAML core schema에서는 `0755`가 십진수, `0b10`·`1_000`·`-0x10`은 문자열이다. adapter가 이를 맞추고 TS/Rust 공통 fixture로 확인한다. [resolver 소스](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/value.rs)
- `get_mapping_value`는 scalar key의 decoded text를 비교해 numeric key와 string key를 혼동할 수 있고 complex key를 처리하지 못한다. adapter는 key의 타입을 확인한 뒤 조회한다. [조회 소스](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/doc.rs)
- scalar replacement fast path는 이전 plain style/explicit tag를 유지할 수 있다. typed 문자열 `"true"`가 boolean이 되거나 원래 tag가 새 타입을 바꾸는 것을 피하기 위해 선택된 CST span을 변경하고 실제 결과 타입을 검사한다. inline comment도 별도로 보존한다. [편집 소스](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/edit.rs)
- parser는 indented root에 parent collection을 요구한다. 저장되는 원문을 바꾸지 않는 파싱용 부모로 이 경계를 보완했다. 실제 공통 fixture가 original indent·metadata·본문을 검사한다.

현재 crate MSRV는 dependency에 맞춰 1.96으로 올렸다. 로컬 Rust 1.99로 검증한다. Rust 1.96 자체 및 다른 OS에서의 실행 검증을 수행했다고 주장하지 않는다.

## 검증

[31개 공통 fixture](../packages/editor/fixtures/frontmatter.json)를 [TS runner](../packages/editor/src/metadata-fixtures.test.ts)와 [Rust runner 및 추가 테스트](../crates/document-store/tests/frontmatter.rs)가 읽는다. 기존 TS 다섯 사례, BOM/CRLF/comments/unknown nested 값, 본문 suffix, string/null/type 오류, duplicates/unclosed/malformed, indented/flow root, schema 숫자와 alias getter를 포함한다. Rust 추가 테스트는 JSON patch/remove, tag/type 교체, complex/numeric key 충돌, anchor dependency, bounded alias expansion, literal/folded/quoted/plain multiline 값, 혼합 줄바꿈, trailing comma와 주석을 검사한다.

```sh
CARGO_INCREMENTAL=0 cargo test -p box-document-store
CARGO_INCREMENTAL=0 cargo test -p box-desktop --lib
pnpm --filter @box/editor test
pnpm check-types
pnpm build
cargo fmt --all -- --check
CARGO_INCREMENTAL=0 cargo check --workspace --all-targets
CARGO_INCREMENTAL=0 cargo clippy -p box-document-store --all-targets -- -D warnings
```

검증 범위는 순수 metadata adapter, 실제 파일 저장소의 회귀, 기존 Box application unit 및 기본 compile/build다. 기존 UI의 metadata 저장을 Rust로 마이그레이션하거나 MCP에서 호출하는 작업은 gh-56~gh-52에 남아 있다.

gh-55 결과: 공통 fixture 31개를 양쪽 runner가 실행했고, Rust metadata 추가 검사 포함 16개·실제 filesystem 15개·기존 Box unit 28개·editor 74개가 통과했다. Box의 ignored peer-worker 1개는 기존 다른 프로세스 동시성 테스트가 별도로 실행한다. 기본 검사 네 가지와 crate clippy, 문서 상대 링크 및 lockfile 기존 dependency identity 보존도 확인했다. 기존 AW deprecated API와 프런트엔드 chunk 크기 경고는 남아 있다. `cargo test --workspace` 전체 실행은 gh-54에서 발생한 디스크 제한으로 통과했다고 주장하지 않으며, 이번 변경의 package 검증은 위 범위다.
