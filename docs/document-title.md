# 문서 제목 (gh-95)

문서 속성의 `제목` 입력란에서 값을 입력한 뒤 `문서에 적용`과 `저장`을 누르면 Markdown frontmatter의 `title` 문자열에 저장한다. 앞뒤 공백은 제거하고 빈 값은 속성을 삭제한다. 읽기 모드에서는 제목 입력도 비활성화한다. 기존 metadata helper와 문서 저장 경로를 사용해 본문과 다른 frontmatter 속성을 유지한다.

문서 카드는 파일명 대신 frontmatter `title`을 표시한다. 속성이 없거나 빈 문자열 또는 공백뿐이면 정확히 `제목 없음`으로 표시한다. 경로는 카드 아래에 계속 표시한다. 카드 모달 저장, 카드 재진입 및 현재 workspace generation의 문서 변경 이벤트에서 metadata를 다시 읽어 제목을 갱신한다. 제목은 React 텍스트로 표시한다.

2026-10-15 검증: desktop Vitest 126개, Playwright 전체 56개, desktop typecheck와 production build 통과. 신규 검증은 특수문자·Unicode 제목의 저장 및 재열기, permalink·summary·custom 속성·본문 보존, 제목 누락·빈 값·공백 fallback, 카드 모달에서 원문 title을 수정·저장한 뒤 카드 갱신을 포함한다. 브라우저 저장은 기존 native adapter fixture를 사용하며 실제 macOS 창 검증으로 주장하지 않는다.
