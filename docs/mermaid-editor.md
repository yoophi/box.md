# Mermaid 문서 편집기 (gh-16)

Mermaid fenced code는 공용 `packages/editor`의 `mermaidBlock` leaf atom으로 읽는다. Mermaid DSL은 편집 가능한 ProseMirror 텍스트 대신 `source` 속성에 보관하고, 저장할 원문은 `raw` 속성에 보관한다. 보기·서식 편집에서 차트 내용을 직접 수정하지 않으며 Markdown 원문 모드에서 수정한다.

## 원문 보존 (gh-29)

Mermaid 노드가 일반 코드 블록보다 먼저 Markdown `code` 토큰을 처리한다. 다른 언어의 코드 블록은 StarterKit CodeBlock을 확장해 처리한다. 코드 내용에 펜스가 있으면 더 긴 펜스를 선택해 뒤의 실제 차트가 일반 코드로 흡수되지 않게 한다. serializer는 차트의 `raw`를 사용하므로 Mermaid 문법, 공백, Unicode, 백틱/물결 펜스 길이와 언어 표기를 보존한다. Marked가 정규화한 줄바꿈은 모든 실제 코드 토큰을 순서대로 추적해 입력의 대응하는 원문 행에서 복원한다. 다른 코드 안의 예시에는 차트 복원을 적용하지 않는다. 인용문·목록의 컨테이너 접두사는 Markdown serializer가 처리한다.

확장 문법 검사는 fenced code와 inline code를 제외하고 수행한다. Mermaid 내부 HTML 형태의 라벨이나 `$` 때문에 문서 전체가 원문 모드로 강제되지 않는다. HTML clipboard 내보내기는 실행 가능한 SVG 대신 이스케이프된 코드 텍스트를 사용한다. 외부 clipboard의 raw 속성은 같은 Mermaid 코드 블록과 원문인지 검증한다.

공용 테스트 25개와 기존 desktop 27개, Chromium 회귀 13개 및 프로젝트 기본 검증이 통과했다. Mermaid 전용 10개 검증에는 여러 블록, Unicode, CRLF/혼합 줄바꿈, 백틱/물결 펜스, 인용문, 주변 본문 수정, 코드 문법 검사 제외, leaf atom schema가 포함된다. 일반 코드 안의 Mermaid 예시를 실제 차트와 구별하며, 인용문과 목록이 결합된 경우 schema와 저장·재열기 원문을 확인했다. BOM만 있는 문서는 BOM을 별도 prefix로 보존한다.

## 차트 렌더러 (gh-30)

Mermaid 12.1.0과 DOMPurify 3.4.17을 첫 차트에서 지연 로딩한다. `securityLevel: strict`, `htmlLabels: false`, `secure` 설정으로 문서 지시문이 보안을 낮추지 못하게 한다. 출력은 SVG 프로파일로 정제하고 실행 가능한 태그와 외부 href를 제거한다. Mermaid callback 바인딩은 사용하지 않는다. 최종 SVG는 Shadow DOM에 넣어 차트 스타일을 문서 UI에서 분리한다.

측정용 임시 DOM은 성공·실패 모두 정리한다. NodeView는 소스 변경마다 generation을 갱신해 이전 결과를 무시하며, 삭제한 뷰에는 결과를 적용하지 않는다. 오류는 해당 차트 블록에만 표시하고 문서의 나머지는 유지한다. 원문 크기 50,000자와 500 edge 제한을 사용한다. 렌더링 한도로 표시하지 못해도 저장할 원문은 유지한다.

Mermaid가 일반 문단 대신 기본 블록으로 선택되지 않도록 schema에서 paragraph 순서를 유지하면서 Mermaid 파서를 일반 코드 파서 앞에 등록한다. 본문 편집·원문 전환에서 빈 차트가 생기는 회귀를 검증했다.

공용 28개(보존 10개 및 NodeView 수명 3개 포함), desktop 27개, 실제 Chromium 16개가 통과했다. 실제 렌더링 검증 3개는 여러 차트/독립 오류, 두 모드 비편집·주변 편집/원문 갱신, 보안 지시문/HTML 이벤트/JavaScript 링크를 다룬다. unsafe 입력 검증에서 실행·외부 요청·외부 href가 발생하지 않았다.

![실제 Chromium Mermaid 차트 화면](assets/mermaid-render.png)

## 남은 하위 작업

- gh-31: 실제 브라우저 차트 렌더링, 읽기·서식·원문 전환, 수정 후 재렌더, 주변 편집·저장·재열기 원문 보존 및 안전성 검증.

상위 gh-16은 렌더링과 통합 검증이 끝날 때까지 완료 처리하지 않는다.

참조: [Tiptap JavaScript node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/javascript), [Mermaid 보안 설정](https://mermaid.js.org/config/schema-docs/config.html#securitylevel).
