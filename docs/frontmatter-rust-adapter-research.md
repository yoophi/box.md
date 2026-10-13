# Rust frontmatter adapter 조사 (gh-50 / gh-55)

조사일: 2026-10-13. **이 문서는 구현·실행 검증 결과가 아닌, 배포된 crate 소스와 기존 box.md 계약을 비교한 조사다.** crates.io API에서 현재 비 prerelease·비 yanked 버전을 확인하고, 해당 배포 tarball의 `Cargo.toml`, `.cargo_vcs_info.json`, 구현 및 upstream 테스트를 읽었다. `main` 또는 `latest` 대신 아래의 고정 버전·commit 링크를 기준으로 한다.

## 권고 및 남은 채택 조건

**판단:** 새 서버 adapter의 첫 검증 후보는 `yaml-rt-core = "=0.3.2"`가 적합하다. 원본에 국소 patch를 적용하는 모델과 문자열을 타입에 맞게 출력하는 fragment API가 요구사항에 가깝다. `yaml-edit = "=0.3.2"`도 CST 편집 후보이지만 새 entry에서 LF를 생성하는 구현, 별도의 strict validator 필요, AST에서 값으로 변환할 때의 정보 누락 가능성을 adapter가 보완해야 한다. 일반 YAML 값을 전체 재직렬화하는 방식은 채택하지 않는다. [yaml-rt source model](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/lib.rs), [yaml-edit entry 생성](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/mapping/entry.rs)

**미해결 채택 조건:** 실제 adapter fixture를 실행해 BOM/CRLF, unknown YAML, body byte 보존을 증명해야 한다. 모든 mapping의 중복 key 검사, JSON으로 표현할 수 없는 YAML의 처리 정책, anchor 소유 entry 변경/삭제 정책도 필요하다. yaml-rt의 선언 MSRV는 1.96이며 현재 로컬 `rustc --version` 결과는 1.99.0이지만 CI 및 배포 빌드 환경은 이 조사에서 확인하지 않았다. Cargo workspace에는 별도 `rust-version` 선언이 없다. 선언 MSRV가 만족된다는 사실만으로 전체 dependency graph의 해당 toolchain 빌드를 검증했다고 볼 수 없다. [yaml-rt-core 0.3.2 manifest](https://docs.rs/crate/yaml-rt-core/0.3.2/source/Cargo.toml), [현재 workspace](../Cargo.toml)

## box.md의 실제 계약

확인한 정본은 [metadata.ts](../packages/editor/src/metadata.ts), [metadata.test.ts](../packages/editor/src/metadata.test.ts), [MCP 구현 계획](./document-mcp-implementation-plan.md)이다.

- opening은 문서 맨 앞의 선택적 BOM + `---` + 선택적 space/tab + LF 또는 CRLF이다. closing은 행 시작 `---` 또는 `...`와 선택적 space/tab, newline 또는 EOF이다. opening이 없으면 일반 Markdown이며, opening만 있고 closing이 없으면 오류다.
- YAML은 `uniqueKeys: true`, `schema: "core"`로 읽는다. 빈 header는 허용하며 nonempty root는 mapping이어야 한다. malformed YAML·중복 key를 오류로 처리한다.
- `documentProperty`는 미존재 또는 null이면 `""`, string이면 해석한 문자열을 반환하며 나머지 타입은 오류다. `setDocumentProperty`는 key를 `[a-zA-Z0-9_-]+`로 제한하고 입력 value의 CR/LF를 거부한다. 빈 문자열은 key 삭제이며 whitespace만 있는 문자열은 삭제가 아니다. `true`, 숫자처럼 보이는 값도 새 문자열로 저장한다.
- 기존 opening과 closing 이후 suffix는 그대로 붙인다. 새 frontmatter는 BOM 뒤에 LF로 생성한다. 기존 header serialization은 opening의 newline에 맞게 정규화한다. 따라서 현재 TS 계약은 **본문·envelope exact 보존과 unknown YAML의 의미·주석 보존**이며, 모든 header byte의 identity를 이미 보장하는 구현은 아니다.
- MCP 계획은 `metadata` JSON 객체를 반환하고 최상위 `patch` 및 `remove`를 지원한다. 동일 key의 patch/remove 충돌은 오류다. `summary`와 `permalink`의 한 줄 문자열 규칙을 유지하며 unknown nested YAML과 comments를 보존하고 본문을 byte 단위로 유지한다.

**판단:** Rust와 TS의 전체 출력 문자열을 무조건 같게 비교하면 quoting·header 정규화 차이 때문에 유효한 국소 편집까지 실패한다. shared fixture는 read 의미, 오류 분류, suffix byte identity, 변경하지 않은 YAML subtree 보존을 분리해서 확인해야 한다. 기존 TS fixture가 없는 anchor·복합 key·tag의 동작을 TS와 같다고 먼저 선언하면 안 된다.

## 고정 버전 비교

| 후보 | 2026-10-13 확인 버전 / 선언 MSRV | features와 API | 채택 판단 |
| --- | --- | --- | --- |
| `yaml-edit` | 0.3.2 / 1.70, edition 2021 | default `binary` → optional base64 0.22; optional `regex`; rowan 0.16. `YamlFile::from_str`, `Mapping::{get,set,remove}`, `validator::Validator`, `ScalarValue::from_scalar` | CST 보존은 유용하나 아래 보완 필요. frontmatter만 다루면 `default-features = false` 검토 |
| `yaml-rt-core` | 0.3.2 / 1.96, edition 2024 | 외부 dependency 및 feature 선언 없음. `YamlDoc::parse`, `JsonPointer`, `YamlFragment`, `add_at`, `replace_at`, `remove_at`, `resolve_scalar` | 국소 patch 우선 후보. CI MSRV와 fixture 통과가 채택 조건 |
| `yaml-rt` facade | 0.3.2 / 1.96 | default `derive`; optional `serde`; core 재export | derive overlay가 필요하지 않으면 core 직접 사용이 단순함 |
| `saphyr` / `saphyr-parser` | 각각 0.2.1 / 1.85.0, edition 2024 | saphyr default `encoding` → encoding_rs; parser optional `debug_prints`. `Yaml::load_from_str`, `YamlEmitter`; parser event stream | 의미 parsing 또는 독립 검증 후보. 이 API 자체가 source-preserving edit를 제공하지 않으므로 저장용 대체는 아님 |
| `yaml_serde` | 0.10.7 / 1.82, edition 2021 | default `std`; `from_str`, `to_string` | 유지 관리되는 Serde YAML 구현. JSON/typed conversion에는 검토 가능하지만 전체 write source로 쓰지 않음 |

버전·MSRV·features 근거: [yaml-edit 0.3.2 manifest](https://docs.rs/crate/yaml-edit/0.3.2/source/Cargo.toml), [yaml-rt-core 0.3.2 manifest](https://docs.rs/crate/yaml-rt-core/0.3.2/source/Cargo.toml), [yaml-rt 0.3.2 manifest](https://docs.rs/crate/yaml-rt/0.3.2/source/Cargo.toml), [saphyr 0.2.1 manifest](https://docs.rs/crate/saphyr/0.2.1/source/Cargo.toml), [saphyr-parser 0.2.1 manifest](https://docs.rs/crate/saphyr-parser/0.2.1/source/Cargo.toml), [yaml_serde 0.10.7 manifest](https://docs.rs/crate/yaml_serde/0.10.7/source/Cargo.toml). 대안 API 근거: [saphyr 배포 README](https://docs.rs/crate/saphyr/0.2.1/source/README.md), [YAML Serde 배포 README](https://docs.rs/crate/yaml_serde/0.10.7/source/README.md).

## yaml-edit 0.3.2에서 확인한 사실

배포 소스 commit은 `ae2303a72dac6496e7ecd543034d17ff0cb52d98`이다. `YamlFile::from_str`는 positioned parse error가 있으면 첫 오류를 반환한다. relaxed API는 오류와 tree를 함께 반환한다. **strict FromStr 성공이 YAML strict validation 완료를 뜻하지 않는다.** 별도의 `Validator::validate` 또는 `validate_syntax`가 있으며 default config는 duplicate keys, indentation, tabs, document markers, anchors를 검사한다. duplicate 검사에는 quoted/unquoted 및 타입 의미 비교, sequence/mapping key 비교가 들어 있다. [parse 진입점](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/yaml.rs), [validator](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/validator.rs)

`Mapping::set`는 기존 entry의 value를 splice하며, 미존재 key는 새 entry를 추가한다. `remove`는 첫 matching entry를 제거한다. 중복 입력을 허용한 채 이 API를 사용하면 단일 최상위 property라는 앱 계약을 보장하지 못한다. [mapping 구현](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/mapping/mod.rs)

leading comment는 stream-level이라 `Document` 밖에 있을 수 있다. upstream test도 leading comment가 있는 문서를 `YamlFile::from_str(...).document()`로 접근한다. **판단:** 편집 대상은 Document의 mapping이더라도 serialization owner는 YamlFile이어야 한다. Document만 출력하면 header 맨 앞 comment 손실 위험이 있다. [upstream position fixture](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/lib.rs)

새 entry와 trailing newline 복구는 `"\n"` token을 생성한다. **판단:** raw CRLF tree를 직접 편집한 결과에는 LF가 섞일 수 있다. 전체 결과에 단순 `replace("\n", "\r\n")`를 적용하면 기존 CRLF가 CRCRLF가 된다. 원래 header를 LF로 정규화한 뒤 기존 TS처럼 전체 CRLF로 출력하는 방식은 homogeneous CRLF 계약에는 맞출 수 있지만 unknown header byte 보존의 더 강한 계약에는 맞지 않는다. 원본 span patch 또는 새 token만 newline을 조정하는 보완이 필요하다. [entry builder](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/mapping/entry.rs), [newline helper](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/mod.rs)

`&str`/String의 AsYaml는 문자열 타입을 구성하고 필요한 quoting을 적용한다. 읽기에서는 `Scalar::as_string`만 호출하면 bool/number도 문자열처럼 얻으므로 `ScalarValue::from_scalar(...).scalar_type()`을 먼저 검사해야 한다. `to_i64()`는 legacy leading-zero octal을 읽으며 `to_i64_yaml_1_2()`가 별도로 있다. `Scalar::to_string()`은 source spelling이므로 quoted 문자열의 JSON 값으로 바로 사용하면 안 된다. [AsYaml 문자열 입력](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/as_yaml.rs), [scalar 의미·숫자 API](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/scalar.rs), [scalar decoding](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/scalar_node.rs)

`YamlValue`는 formatting을 잃는 별도 값 모델이다. sequence 변환은 `filter_map`, mapping은 string key BTreeMap으로 구성한다. alias/지원하지 않는 node를 포함한 JSON 전체 projection이 완전하다고 이 API만으로 주장할 수 없다. `get_resolved`와 merge view는 별도 read API이며 CST write가 resolved object를 자동으로 anchor/merge 문법으로 되돌리는 것은 아니다. [값 변환 구현](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/value.rs), [anchor resolution](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/anchor_resolution.rs)

`MappingEntry::set_value`는 새 value node에서 anchor를 가져온다. **판단:** 기존 anchored scalar를 raw String으로 바꾸면 기존 anchor가 없어져 외부 alias가 깨질 수 있다. 변경 후 strict 재검사만으로 atomic failure는 구현할 수 있지만, 기존 anchor 의미를 유지하는 편집까지 증명되지는 않는다. [value replacement](https://github.com/jelmer/yaml-edit/blob/ae2303a72dac6496e7ecd543034d17ff0cb52d98/src/nodes/mapping/entry.rs)

## yaml-rt-core 0.3.2에서 확인한 사실

배포 소스 commit은 `31d06fbd28722be65498e99ba56df6c2ada6ec4e`이다. core는 원본 source/CST를 보관하고 queued edit를 국소 span에 적용한다. `to_string()`은 pending patch preview, `commit_edits()`는 이를 재parse해 다음 baseline으로 삼는다. `add_at`/`replace_at`은 transaction을 사용하고 `remove_at`은 root 제거를 거부한다. typed mapping insertion은 선호 line ending으로 fragment를 생성한다. **판단:** 여러 patch를 한 작업 사본에 적용한 뒤 전체 candidate 검증이 끝난 경우에만 저장 payload를 반환해야 한다. [YamlDoc](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/doc.rs), [transactional edit](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/edit.rs)

`set_scalar(path, value)`는 기존 scalar style을 보존하는 low-level edit이다. 문자열 타입의 JSON patch에는 String의 `ToYamlFragment` 또는 JSON 문자열 fragment를 사용해야 `"true"`, `"123"`, `"null"`이 문자열로 남는다. `resolve_scalar`는 decoded value, style, explicit tag를 받아 YAML 1.2 core 타입을 구분하며 알 수 없는 scalar tag를 오류로 처리한다. **판단:** bool→string replacement를 `set_scalar(..., "true")`만으로 구현하지 않는다. [typed fragment](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/typed.rs), [core scalar resolver](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/value.rs)

parse 자체는 duplicate mapping을 허용한다. upstream pointer test는 `foo: one\nfoo: two`를 parse한 뒤 `/foo` lookup에서 `AmbiguousKey` 오류를 확인한다. 따라서 대상 key lookup의 성공 여부만 검사하면 unrelated 또는 nested duplicate를 놓친다. 모든 mapping을 재귀적으로 검사해야 한다. JSON Pointer는 non-string key를 주소 지정하지 못한다. [pointer 구현과 duplicate fixture](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/src/pointer.rs)

upstream은 untouched byte identity, unrelated source 유지, transactional patch를 문서화한다. alias는 emitted anchor를 계속 참조하며, 일부 copy/move는 anchor 소유권이 모호하면 거부한다. string key만 insertion 대상이며 flow nesting에는 1,024 제한이 있다. README에 적힌 production-usable 설명은 upstream의 주장이고 box.md에서 검증한 결과가 아니다. YAML test suite harness의 expected-failure 목록은 비어 있고 README는 `data-2022-01-17` 기준 semantic JSON 비교를 설명한다. 이 조사에서는 그 suite를 실행하지 않았다. [고정 README의 보장·제한](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/README.md), [고정 suite harness](https://github.com/hdevalke/yaml-rt/blob/31d06fbd28722be65498e99ba56df6c2ada6ec4e/crates/yaml-rt-core/tests/yaml_test_suite.rs)

## adapter 설계 제안과 JSON 정책

다음은 소스에서 확인한 사실이 아닌 **구현 제안**이다.

1. frontmatter envelope를 Rust에서 별도로 나누고 `opening`, `raw_yaml`, `suffix`를 원본 byte slice로 유지한다. body를 YAML parser에 넘기지 않는다. BOM은 envelope가 소유하며 새 header도 BOM 뒤에 붙인다.
2. header 전체를 parse하고 empty/mapping root 및 recursive duplicate를 검사한다. error-recovery tree는 저장을 허용하는 근거로 쓰지 않는다. key validation과 patch/remove 충돌을 첫 단계에서 확인한다.
3. read 모델은 write CST와 분리한다. JSON 객체는 string key만 허용한다. number의 range/precision, `.nan`/`.inf`, explicit unknown tags, complex key, unresolved/cyclic alias가 있을 때 `invalidMetadata` 또는 별도 lossless 표현 중 무엇을 반환할지 계약으로 명시한다. JSON에 들어가지 않는 항목을 조용히 생략하거나 string으로 바꾸지 않는다.
4. JSON patch value는 JSON 문법 fragment로 만드는 방법을 검토할 수 있다. string, array, object, bool, number, null의 의도가 명확하고 변경하지 않은 subtree를 건드리지 않는다. 사용자가 patch하지 않은 unknown nested YAML은 projection으로 재출력하지 않는다.
5. summary/permalink는 읽기에서 absent/null→빈 값, string→decoded 값, 다른 타입→오류를 적용한다. 쓰기는 CR/LF가 없는 string만 허용하고 `""`는 TS setter처럼 remove한다. 일반 metadata null patch는 null 저장과 remove를 구분한다. JSON key escaping 및 `__proto__` 등도 ordinary key로 취급한다.
6. 미지원 문법을 가진 unknown subtree의 보존과 해당 subtree의 JSON projection 실패를 구분한다. 전체 metadata JSON 응답 때문에 edit까지 제한할지, edit 이후 별도 projection 오류를 반환할지는 API 설계 결정이며 이번 조사에서는 확정하지 않는다.
7. alias expansion에는 visited-set, 깊이·node count 한도를 둔다. 변경/삭제하는 entry가 anchor를 소유하면 dependent alias를 보존하는 정책 또는 원문을 그대로 두고 오류를 반환하는 정책을 정한다. 자동 merge expansion은 `schema: core` TS 동작을 확인하기 전 도입하지 않는다.
8. 모든 operation 후 다시 parse·validate하고 suffix byte identity를 검사한다. 성공한 candidate만 application service의 기존 CAS/atomic write 경로로 전달한다. adapter는 파일 시스템과 저장 side effect를 소유하지 않는다.

YAML mapping key는 scalar뿐 아니라 sequence/mapping일 수도 있고 alias로 graph를 만들 수 있어 일반 JSON 객체와 표현력이 다르다. 따라서 임의의 valid YAML을 항상 JSON 객체로 반환하는 계약과 완전 lossless 보존을 동시에 주장하려면 추가 표현 정책이 필요하다. [YAML 1.2.2 representation model](https://yaml.org/spec/1.2.2/#321-representation-graph), [YAML core schema](https://yaml.org/spec/1.2.2/#103-core-schema)

## 실행해야 할 shared fixture

| 범주 | 입력/operation | 필요한 assertion |
| --- | --- | --- |
| 기존 TS 다섯 fixture | 현재 metadata.test.ts 사례를 그대로 데이터 fixture로 추출 | summary/permalink read 의미, 에러, body bytes를 TS/Rust에서 공통 확인 |
| envelope | BOM 유무, LF/CRLF, closing `---`/`...`/EOF, delimiter space/tab, no header, empty/comment-only header | opening/suffix exact identity; unclosed 오류; no-header empty remove는 원문 그대로 |
| 보존 | nested block/flow mapping, sequence, inline/leading/trailing comment, mixed line endings, blank lines, Unicode body와 trailing spaces | patch하지 않은 source span과 body exact byte identity |
| string 의미 | `true`, `123`, `null`, 날짜, `0755`, `yes`, `off`, quoted 값, `!!str`, escaped Unicode, literal/folded 값 | core schema read 값과 TS의 string/null/type 오류; 새 문자열의 type 유지 |
| add/replace/remove | 기존/없는 key, 마지막/유일 entry, root flow mapping, JSON null·bool·number·array·object, 빈 String 삭제 | replacement 범위, 나머지 entry 유지, 삭제 후 valid empty header, idempotency |
| malformed/duplicate | 깨진 flow/quote/indent, root sequence/scalar, nested duplicate, quoted/unquoted 같은 key, 의미 같은 numeric key, multiple document/directive | 후보를 반환하거나 파일을 쓰지 않고 오류; unrelated duplicate도 검출 |
| anchors/tags/keys | unknown anchored mapping, scalar alias, anchor owner patch/remove, merge `<<`, explicit scalar/sequence/mapping key, unknown tag, recursive/unresolved alias | 보존·오류·JSON 지원 정책을 명시적으로 확인; silent omission 금지 |
| 입력 계약 | CR/LF 포함 string, invalid property key, patch/remove 같은 key, remove 미존재, whitespace-only value | TS의 한 줄/key/빈문자 계약 및 atomic failure |
| JSON 경계 | int 최대·초과, 2^53 경계, exponent, nonfinite, non-string/complex key, cyclic graph | 명시한 JSON 변환 정책; overflow·precision 손실·key 충돌의 silent 처리 금지 |

fixture에는 original Markdown, operation, expected metadata/property, expected error category, expected suffix bytes와 보존해야 할 header span을 함께 저장한다. quoting 전체 equality는 canonical 새 header 같은 제한된 사례에서만 사용한다. **이 조사 완료는 adapter 구현 완료 또는 production 검증 통과를 뜻하지 않는다.**
