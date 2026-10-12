# box.md

생각 수집/기록/연결을 위한 서비스.

AW의 구조를 참고한 **pnpm 모노레포 + Tauri 2 데스크톱 앱**이다. React·TypeScript·Vite·Tailwind CSS를 사용한다.

## 시작하기

Node.js 22.12 이상, pnpm 9.15.5, Rust stable 및 [Tauri OS별 개발 도구](https://v2.tauri.app/start/prerequisites/)가 필요하다.

```sh
pnpm install
pnpm tauri:dev
```

브라우저에서 화면만 확인하려면 `pnpm dev` 실행 후 `http://localhost:1430`에 접속한다. 앱 정보 조회 명령은 Tauri 앱에서 동작한다.

## 명령

| 명령 | 역할 |
|---|---|
| `pnpm dev` | Vite 개발 서버 |
| `pnpm check-types` | 앱·공용 패키지 TypeScript 검사 |
| `pnpm build` | 프런트엔드 프로덕션 빌드 |
| `pnpm check:rust` | Cargo workspace 검사 |
| `pnpm fmt:rust` | Rust 포맷 검사 |
| `pnpm tauri:dev` | 네이티브 개발 앱 |
| `pnpm tauri:build` | 네이티브 릴리스 빌드·번들 |

상세 구조는 [초기 아키텍처](docs/initial-architecture.md)를 참고한다.
