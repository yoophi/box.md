# 문서 편집 기능 — gh-2

- 작업: [문서 편집 기능 제공](https://github.com/yoophi/box.md/issues/2).
- 이슈에 상세 수용 조건이 없어 Markdown 문서 생성·열기·서식/원문 편집·수동 저장·다른 이름 저장을 기본 범위로 구현했다. 추가 사용자 요청에 따라 작업 디렉터리 선택·사이드바 목록·클릭 편집을 포함했다.

## 구현

| 영역 | 책임 |
|---|---|
| `packages/editor` | TipTap 3 확장, Markdown↔문서 변환, Hubble YAML 처리, 안전한 원문 모드 판정 |
| `features/edit-document` | 서식 toolbar, rich/source 모드, 링크 입력 |
| `features/manage-document` | 문서 상태, native picker, 저장 및 미저장 확인, 단축키·종료 처리 |
| `entities/workspace` 및 Rust workspace service/repository | 재귀 Markdown 탐색, 경로·파일명 목록, 작업 디렉터리 복원 |
| `entities/document` | Tauri 문서 API와 파일명·오류 변환 |
| Rust `application/ports/infrastructure` | 동시 저장 직렬화, revision 검사, 같은 폴더의 임시 파일 쓰기·atomic rename |

```mermaid
flowchart LR
    UI[서식 편집 / 원문 편집] --> Draft[문서 draft / baseline]
    Draft --> Command[Tauri document command]
    Command --> Service[DocumentService]
    Service --> Port[DocumentRepository]
    Port --> FS[UTF-8 Markdown 파일]
    FS --> Revision[SHA-256 revision]
    Revision --> Guard[외부 변경 충돌 검사]
    Guard --> Temp[임시 파일 sync / rename]
```

- Hubble의 core/UI/platform 분리와 baseline·disk 비교 원칙을 참고했다.
- `frontMatter.ts`는 Hubble commit `8ddecfb55bc26702d3719a2af39bd42d358662fc`에서 가져왔다. MIT 원문과 저작권은 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)에 보존했다.
- Hubble의 큰 React UI·Electron IPC 전체는 이식하지 않았다. Markdown 변환은 TipTap 공식 `@tiptap/markdown`을 사용한다.
- YAML 주석·중첩 구조·개행을 포함한 envelope는 그대로 보존한다. 속성 변경은 원문 모드에서 한다.
- 위키 링크·HTML·footnote·수식·정렬 표는 보존을 위해 원문 모드로 연다.
- 저장은 수동이다. 새 문서가 기존 파일을 암묵적으로 덮어쓰지 않으며 기존 대상으로 다른 이름 저장 시 별도 확인을 받는다.
- 같은 앱의 저장은 service mutex로 직렬화한다. 저장 시작·rename 직전에 revision을 재검사한다. 독립 외부 프로세스와의 완전한 파일 잠금/transaction은 보장하지 않는다.
- 작업 디렉터리는 native folder picker로 선택하고 localStorage에 저장해 재실행 때 복원한다.
- `.md`, `.markdown`, `.mdown`을 하위 폴더까지 검색해 상대 경로와 함께 표시한다. 숨김 폴더·node_modules·target 및 symlink는 탐색하지 않는다. 20,000개 항목을 넘기면 일부 목록임을 표시한다.
- 파일 저장 후, 앱 focus 때, 새로고침 버튼 클릭 시 목록을 갱신한다. 문서·디렉터리 전환 모두 미저장 확인을 거친다.
- 외부 watcher·자동 동기화, ACP, 문서 링크 그래프는 후속 작업 범위다.
- 모드 전환·다시 불러오기 때 rich editor undo history는 초기화된다.

## 검증

- TypeScript 타입 검사, 프런트엔드 빌드, Cargo 검사·포맷 검사 통과.
- 편집 코어 9건: Unicode·heading/emphasis/link/code·task/table round-trip, YAML 원문 보존, 확장 문법 fallback.
- Rust 파일 저장 5건: Unicode 저장/재열기, 외부 수정 충돌·내용 보존, 신규 파일 no-clobber, 확장자·encoding 검사, 외부 삭제 후 stale save 방지.
- macOS 앱에서 원문→서식 전환, 체크리스트 표시, 임시 Markdown 파일 저장, YAML 보존, 미저장 전환 취소, 외부 변경 후 저장 거절을 확인했다.
- Rust workspace 4건: 재귀·확장자·정렬, 숨김/빌드/의존성 폴더 제외, 빈 폴더·잘못된 root, 외부 symlink 제외.
- macOS native Quit를 custom 요청 이벤트로 연결했다. Cmd+Q 취소 시 draft 보존, titlebar close 확인 후 버리기로 실제 종료, 저장 상태에서 종료를 확인했다. onCloseRequested의 destroy 호출에 필요한 capability를 명시했다.
- workspace smoke: 폴더 선택 → 문서 2개 표시 → 하위 폴더 문서 편집 → 저장 후 다른 문서 전환 → 재실행 root 복원 → 새 문서를 root에 저장 → 목록 3개 갱신까지 확인했다.
- 최종 앱은 `~/project/box.md`를 작업 디렉터리로 선택하고 README를 열어 둔다.

## 근거

- [Hubble editor](https://github.com/bholmesdev/hubble.md/tree/8ddecfb55bc26702d3719a2af39bd42d358662fc/packages/editor), [Hubble save flow](https://github.com/bholmesdev/hubble.md/blob/8ddecfb55bc26702d3719a2af39bd42d358662fc/apps/desktop/src/store/actions.ts).
- [TipTap Markdown](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage), [Tauri dialog](https://v2.tauri.app/plugin/dialog/).
