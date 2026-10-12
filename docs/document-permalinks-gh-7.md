# 문서 고정 링크 (gh-7)

문서 저장 시 YAML `permalink`가 없으면 UUID 문자열을 생성한다. 기존 사용자 설정 값은 유지한다. YAML이 잘못된 문서는 자동 속성 생성을 생략하고 원문 저장을 허용한다. 문서 속성에서 고정 링크를 설정·생성·복사할 수 있다.

문서 링크는 `boxmd://document?permalink=<URL 인코딩한 값>` 형식이다. 앱의 “고정 링크로 열기”에 붙여 넣거나 OS deep link로 열 수 있다. 현재 작업 디렉토리의 문서 속성을 다시 읽어서 파일을 찾으므로 같은 작업 디렉토리 안에서 파일명과 상대 경로가 바뀌어도 링크가 유지된다. 링크에 파일 경로를 넣지 않는다. 중복 permalink, 찾을 수 없는 대상, 불완전한 대규모 목록은 명시적으로 오류를 표시한다. 외부 디렉토리를 자동으로 검색하지 않는다.

앱 시작 시 전달된 링크는 작업 디렉토리 복원이 끝난 뒤 연다. 실행 중 링크도 기존 미저장 문서 보호를 거친다. Tauri deep-link와 single-instance 플러그인을 사용하고 `boxmd` 스킴을 번들에 등록한다. macOS OS 전달 검증은 설치된 번들이 필요하다.

참고: [Tauri Deep Linking](https://v2.tauri.app/plugin/deep-linking/), [JavaScript API](https://v2.tauri.app/reference/javascript/deep-link/).

타입 검사·웹 빌드·Rust check/fmt/test 및 macOS debug 번들 생성 통과. 에디터 13개, 데스크톱 7개, Rust 12개 테스트가 통과했다. 번들 Info.plist의 boxmd 스킴을 확인했다. 파일명 변경 후 링크 열기와 시작 링크 전달은 HomePage 통합 테스트로 검증했고, 설치된 macOS 앱의 OS 전달 smoke는 네이티브 창 연결 제한 때문에 검증하지 못했다.
