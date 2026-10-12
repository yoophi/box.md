# box.md 개발 규칙

- pnpm workspace + Turbo, Tauri 2 + Cargo workspace를 사용한다.
- 프런트엔드는 `apps/box-desktop/src`에서 FSD (`app`, `pages`, `features`, `entities`, `shared`)를 따른다.
- 공용 TypeScript 코드는 `packages/`에 두고 앱에 직접 의존하지 않는다.
- Rust 백엔드는 `domain`, `ports`, `application`, `infrastructure`, `inbound`로 구분한다. domain/ports에서 Tauri와 파일 시스템 API를 직접 사용하지 않는다.
- 여러 실행 환경에서 실제로 공유할 Rust 코드가 생기면 `crates/`로 추출하고 Cargo workspace에 등록한다.
- 문서는 `docs/`에 영문 파일명·한국어 내용으로 작성한다. 다이어그램은 Mermaid만 사용한다.
- 기본 검증: `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`.
- 잠금 파일 `pnpm-lock.yaml`, `Cargo.lock`을 함께 관리한다.

<!-- td-agent-instructions:start -->
<!-- td-agent-instructions:version=3 -->

## Working with td

td keeps task context durable across sessions. In a new context, run `td usage --new-session -q` to see current work.

Use your judgment about how much tracking a task needs. For substantive work: `td start <id>`, record progress with `td log`, hand off with `td handoff <id>`, then `td review <id>`.

Closing needs a review. Say who did it (default trusted mode; delegated/strict allow only the first):

- independent session: `td approve <id> --reason "..."`
- a sub-agent: `td approve <id> --reviewed-by "<who>"`
- you: `td approve <id> --self-review --reason "..."`

Prefer a reviewer with its own `TD_CONTEXT_ID`; never name one who did not review.

Run `td usage` or `td <command> --help`.

<!-- td-agent-instructions:end -->
