# Mermaid 문서 편집기 (gh-16)

Mermaid fenced code는 공용 `packages/editor`의 `mermaidBlock` leaf atom으로 읽는다. Mermaid DSL은 편집 가능한 ProseMirror 텍스트 대신 `source` 속성에 보관하고, 저장할 원문은 `raw` 속성에 보관한다. 보기·서식 편집에서 차트 내용을 직접 수정하지 않으며 Markdown 원문 모드에서 수정한다.

## 원문 보존 (gh-29)

Mermaid 노드가 일반 코드 블록보다 먼저 Markdown `code` 토큰을 처리한다. 다른 언어의 코드 블록은 기존 StarterKit으로 처리한다. serializer는 차트의 `raw`를 사용하므로 Mermaid 문법, 공백, Unicode, 백틱/물결 펜스 길이와 언어 표기를 보존한다. Marked가 정규화한 줄바꿈은 입력의 대응하는 원문 행에서 복원한다. 인용문·목록의 컨테이너 접두사는 Markdown serializer가 처리한다.

확장 문법 검사는 fenced code와 inline code를 제외하고 수행한다. Mermaid 내부 HTML 형태의 라벨이나 `$` 때문에 문서 전체가 원문 모드로 강제되지 않는다. HTML clipboard 내보내기는 실행 가능한 SVG 대신 이스케이프된 코드 텍스트를 사용한다. 외부 clipboard의 raw 속성은 같은 Mermaid 코드 블록과 원문인지 검증한다.

공용 테스트 22개와 기존 desktop 27개, Chromium 회귀 13개 및 프로젝트 기본 검증이 통과했다. Mermaid 전용 7개 검증에는 여러 블록, Unicode, CRLF/혼합 줄바꿈, 백틱/물결 펜스, 인용문, 주변 본문 수정, 코드 문법 검사 제외, leaf atom schema가 포함된다.

## 남은 하위 작업

- gh-30: 지연 로딩 Mermaid 렌더러, strict 설정·SVG 정제, 비편집 NodeView, 블록별 오류 및 stale 결과 정리.
- gh-31: 실제 브라우저 차트 렌더링, 읽기·서식·원문 전환, 수정 후 재렌더, 주변 편집·저장·재열기 원문 보존 및 안전성 검증.

차트 렌더러가 연결되기 전 단계에서는 원문을 비편집 코드 블록으로 표시한다. 상위 gh-16은 렌더링과 통합 검증이 끝날 때까지 완료 처리하지 않는다.

참조: [Tiptap JavaScript node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/javascript), [Mermaid 보안 설정](https://mermaid.js.org/config/schema-docs/config.html#securitylevel).
