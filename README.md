# box.md

생각 수집/기록/연결을 위한 서비스.

AW의 구조를 참고한 **pnpm 모노레포 + Tauri 2 데스크톱 앱**이다. React·TypeScript·Vite·Tailwind CSS를 사용한다.

## 시작하기

Node.js 22.12 이상, pnpm 9.15.5, Rust stable 및 [Tauri OS별 개발 도구](https://v2.tauri.app/start/prerequisites/)가 필요하다.

```sh
pnpm install
pnpm tauri:dev
```

브라우저에서 화면만 확인하려면 `pnpm dev` 실행 후 `http://localhost:1430`에 접속한다. 파일·작업 디렉터리 열기와 저장은 Tauri 앱에서 동작한다.

## 명령

| 명령 | 역할 |
|---|---|
| `pnpm dev` | Vite 개발 서버 |
| `pnpm check-types` | 앱·공용 패키지 TypeScript 검사 |
| `pnpm build` | 프런트엔드 프로덕션 빌드 |
| `pnpm test` | Markdown 변환·보존 테스트 |
| `pnpm test:rust` | 파일 저장·충돌 테스트 |
| `pnpm check:rust` | Cargo workspace 검사 |
| `pnpm fmt:rust` | Rust 포맷 검사 |
| `pnpm tauri:dev` | 네이티브 개발 앱 |
| `pnpm tauri:build` | 네이티브 릴리스 빌드·번들 |

## 문서 편집

- 작업 디렉터리 선택·복원, 하위 폴더의 Markdown 문서 사이드바 목록, 클릭하여 열기.
- 새 문서 작성, Markdown 파일 열기, 저장·다른 이름 저장. 새 파일은 작업 디렉터리에 저장하도록 제안한다.
- TipTap 서식 편집 및 Markdown 원문 모드, 제목·강조·목록·체크리스트·인용·코드·표·링크.
- YAML front matter 원문 보존. 확장 문법은 원문 모드로 편집.
- 수동 저장: `Cmd/Ctrl+S`, 다른 이름 저장: `Cmd/Ctrl+Shift+S`, 열기: `Cmd/Ctrl+O`, 새 문서: `Cmd/Ctrl+N`.
- 미저장 변경이 있으면 문서 전환·창 닫기·앱 종료 전에 저장/버리기/취소를 선택한다.
- 외부 변경은 저장 전 revision 검사에서 충돌로 표시한다. 다시 불러오거나 다른 파일로 저장할 수 있다.

[문서 편집 기능 기록](docs/document-editing-gh-2.md)과 [초기 아키텍처](docs/initial-architecture.md)를 참고한다.
