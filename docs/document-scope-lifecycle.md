# 작업 루트 수락과 종료 대기 (gh-62)

gh-60을 gh-62(수명 관리) → gh-63(requestId 및 서버 소유 mutation)으로 나눠 순서대로 구현한다. 이번 단계는 기존 UI와 scoped API의 `DocumentService` 공유 경로에 수락 gate를 추가한다.

## 수락과 종료

scope의 gate는 accepting 상태와 진행 중인 호출 수를 같은 mutex로 관리한다. 호출은 service 잠금을 얻기 전에 permit를 받는다. permit는 조회·저장·이력 작업이 반환하거나 unwind할 때 해제한다. `stop_accepting` 이후 새 호출은 `scopeRevoked`이며 파일에 접근하지 않는다. 이미 수락한 호출은 원래 directory handle과 같은 service를 끝까지 사용한다.

`close_and_drain`은 신규 수락을 막고 모든 permit가 해제될 때까지 condition variable로 기다린다. 여러 종료 호출과 반복 종료를 허용한다. 이 API는 수락된 호출 내부에서 부르면 자기 자신을 기다리므로 lifecycle 소유자가 호출해야 한다. service 실행 중에는 gate mutex를 보유하지 않는다.

## 루트 전환과 앱 종료

루트 선택은 새 directory handle과 최초 목록을 먼저 검증한다. 실패하면 기존 scope를 유지한다. 성공하면 현재 루트 mutex를 유지한 상태에서 기존 scope를 revoke하고 drain한 뒤 새 generation을 공개한다. native 경로 조회는 이 mutex를 해제한 뒤 gate/service를 호출한다. 기존 generation에서 파일 공개가 끝났더라도 이력 기록이 진행 중이면 전환을 기다린다. 전환 후 구 scope handle로 새로운 호출을 시작할 수 없다.

`DocumentWorkspace::close_and_drain`은 해당 manager의 영구 종료다. 이후 루트 선택과 native 접근도 `scopeRevoked`이며, scope를 지워 절대 경로 fallback으로 우회하지 않는다. manager의 `Drop` 역시 drain한다. Tauri의 확정된 `RunEvent::Exit`에서 이 메서드를 먼저 호출하고 Workbench shell을 종료한다. 종료 취소가 가능한 `ExitRequested`에서는 revoke하지 않는다.

루트 밖의 명시적 native 파일 편집은 기존 서비스 경로를 유지한다. 이번 gate의 accepted-call drain 보장은 선택 루트의 UI/scoped 호출에 적용하며, 별도의 외부 파일 작업 전체에 대한 drain을 광고하지 않는다. 강제 프로세스 종료나 전원 중단을 drain으로 복구하는 기능도 아니다.

## 검증과 남은 작업

실제 임시 파일과 Git 이력을 사용하는 테스트에서 history 기록을 barrier로 멈추고 다음을 확인한다.

- native 저장이 수락되면 root switch가 이력 완료까지 기다린다. 대기 중 구 scope의 조회·저장을 거부하고 새 루트에 파일을 만들지 않는다.
- 명시적 workspace 종료와 `Drop`이 scope 호출의 완료를 기다린다. 살아 있는 구 handle도 신규 호출을 할 수 없다.
- 명시적 종료 후 재선택·scope 조회·native scoped/외부 저장을 거부하며 반복 종료는 성공한다.
- panic unwind도 permit를 반환하므로 종료 대기를 막지 않는다.

기존 테스트는 실패한 루트 선택의 기존 generation 유지, root pinning, native/scoped CAS 및 공유 이력 회귀를 계속 검사한다. 이 테스트는 실제 macOS 종료 화면이나 설치 agent HTTP 사용 검증을 대신하지 않는다.

gh-63에서 응답 수신자가 버려져도 permit를 서버 소유 mutation이 보유하도록 연결하고 fingerprint/최초 결과/capacity를 구현한다. MCP/HTTP는 gh-51, grant와 ACP·UI 이벤트는 gh-52, 실제 앱/agent 사용 검증은 gh-53, 전체 application 감사는 gh-57에 남아 있다.

최종 검증은 `cargo test -p box-desktop --lib`의 47개 통과(helper 1개 ignored 및 subprocess 실행 3개 통과), `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets` 통과다. 아직 연결하지 않은 scoped API의 dead-code 경고 13개와 기존 AW 경고는 남아 있다. 로그는 `/tmp/box-md-gh62-{native-tests,types,build,fmt,rust}.log`에 기록했다. 실행 중인 앱 번들은 재빌드하지 않았다.
