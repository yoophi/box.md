# Scoped mutation 수용 기준 감사 (gh-60)

gh-60의 구현은 gh-62(`6cc8bc3`)와 gh-63(`cf4fa56`)에 나눠 진행했다. 이번 감사는 부모 작업의 명시된 application 범위를 현재 소스와 실제 파일 실행 결과에 대조한다. HTTP/MCP/auth/ACP 및 UI 이벤트·실제 native 화면은 gh-51~53과 gh-57에 유지한다.

| 요구사항 | 현재 구현 및 검증 근거 | 판단 |
| --- | --- | --- |
| scope별 검증된 인자 fingerprint와 최초 결과 보관 | `DocumentMutation::fingerprint`의 타입·경로·크기 검사와 재귀 object key 정렬; `MutationRegistry`가 generation별 `DocumentScope`에 소유됨. nested metadata key 순서 변경 재시도 및 invalid argument 검사는 슬롯/파일을 바꾸지 않음 | 충족 |
| 동일 ID/동일 인자의 동시 재시도는 최초 결과 | 16개 동시 호출의 결과 Arc가 동일하고 실제 content/revision과 일치. native 경로의 Git 이력은 원본과 변경 2개만 존재 | 충족 |
| 동일 ID/다른 payload의 충돌 | 진행 중/완료된 요청의 다른 content/operation은 `requestIdConflict`; 다른 파일을 만들지 않음 | 충족 |
| stale revision 오류 결과도 최초 결과 유지 | 외부 파일을 바꿔 stale 오류를 만든 뒤 다시 원 revision의 내용으로 되돌려도 같은 ID는 같은 오류 Arc를 반환. 파일은 수정되지 않고 이력은 1개 유지 | 충족 |
| caller drop 또는 응답 유실이 수락한 저장을 취소/중복하지 않음 | worker가 service/journal/permit를 소유. 최초 response ticket을 버린 뒤 재시도와 root switch가 같은 결과를 확인. 모든 ticket을 버린 manager Drop 검사에서도 파일·Git 이력 완료 | 충족 |
| root 전환/종료에서 신규 거부와 accepted drain | `ScopeAdmission`이 accept/revoke를 한 mutex에서 처리. history를 barrier로 멈춰 switch/명시적 close/Drop의 미완료를 확인하고 release 이후 완료. 구 scope 신규 호출은 `scopeRevoked`; 새 generation은 별도 결과 | 충족 |
| UI 저장과 동일한 직렬화·이력 경로 | 준비→예약→CAS→이력이 기존 `DocumentService::store` mutex 및 `DocumentStore::write/record`를 사용. native/owned worker 동시 CAS 검사는 한 성공/한 conflict와 이력 2개만 확인 | 충족 |
| count/byte capacity 및 silent eviction 없음 | 128 ID/64 MiB 기본값. 시험용 낮은 한도에서 initial admission 및 create/metadata/restore 응답 예약을 거부하고 원본/복구 데이터 보존. 완료/실패 기록 유지와 capacity 상태의 기존 ID 재시도 확인 | 충족 |
| 성공 후 결과 보관 실패로 재저장하지 않음 | snapshot/metadata와 크기를 쓰기 전에 준비·예약. history warning은 고정 값/null. `restore_checked`는 준비한 path/revision을 최종 잠금 안에서 검사. 쓰기 후 최초 결과 기록을 끝내고 permit 해제 | 충족 |
| 상대 scope를 사용하고 다른 root/secret를 노출하지 않음 | API에는 root 인자가 없고 같은 pinned service 사용. root switch 검사에서 새 root에 구 파일을 만들지 않음. unknown root field 및 traversal 거부. warning/error에는 adapter exception 대신 안전한 고정 메시지 사용 | 충족 |
| 기본 검사·문서·개별 커밋/push | gh-62/63의 개별 구현 커밋과 origin/main 동일 SHA 확인. 앱 60개+helper subprocess 3회, FS 16개, metadata 16개 통과. types/build/fmt/workspace alltargets check 통과 | 충족 |

검사 로그는 `/tmp/box-md-gh63-{native-tests,store-tests,types,build,fmt,rust}.log`다. HTTP에 아직 연결하지 않은 application API의 dead-code 경고 39개와 기존 AW 경고는 남아 있다. 실제 HTTP disconnect 자체는 이번 ticket drop 테스트로 완료 처리하지 않으며 gh-51에서 검증한다. 실제 설치 agent/네이티브 앱 번들은 이번 작업에서 재실행하지 않았다.

소스: [수락 gate](../apps/box-desktop/src-tauri/src/application/scope_admission.rs), [작업 루트](../apps/box-desktop/src-tauri/src/application/document_workspace.rs), [mutation registry](../apps/box-desktop/src-tauri/src/application/document_mutations.rs), [예약과 실행](../apps/box-desktop/src-tauri/src/application/prepared_mutations.rs), [실제 파일 mutation 테스트](../apps/box-desktop/src-tauri/src/application/document_mutation_tests.rs), [수명 테스트](../apps/box-desktop/src-tauri/src/application/document_workspace_lifecycle_tests.rs), [파일 저장소 테스트](../crates/document-store/tests/filesystem.rs).

구체적인 API/정책은 [mutation 수명](document-mutation-lifecycle.md)과 [scope 수락/종료](document-scope-lifecycle.md)를 따른다. gh-56의 다른 서비스 요구사항과 gh-50 전체 감사는 별도 작업의 현재 기준으로 확인하며 이 감사만으로 함께 종료하지 않는다.
