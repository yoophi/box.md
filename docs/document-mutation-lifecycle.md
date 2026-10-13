# 작업 루트 mutation 재시도와 결과 보관 (gh-63)

`DocumentScope::submit_mutation(request_id, DocumentMutation)`은 선택된 generation 안에서 생성·본문 변경·metadata patch·복구 삭제·복원을 수락하고 `MutationTicket`을 반환한다. 이 API는 루트 인자를 받지 않는다. HTTP 인증과 MCP handler 연결은 gh-51/52에서 수행한다.

| mutation | 성공 값 |
| --- | --- |
| Create / Update / Restore | `{document: {path, content, revision, historyWarning, permalink?}}` |
| UpdateMetadata | `{document: snapshot, metadata: {path, revision, metadata: object, permalink?, summary?}}` |
| Delete | `{deleted: {path, revision, permalink?}, trashId, historyWarning}` |

업무 오류는 `DocumentError`의 code/message다. MCP의 `{ok, data/error}` 및 `isError`/output schema는 gh-51에서 이 값에 연결한다.

## 검증과 재시도

requestId는 공백만 있는 값, 제어 문자 또는 256 byte 초과를 거부하며 나머지는 원래 문자열 그대로 비교한다. mutation은 unknown field를 거부하는 tagged typed 값이다. 상대 Markdown 경로는 파일 저장소와 같은 순수 validator를 사용한다. 본문과 permalink 인자는 각각 8 MiB 이하, revision은 비어 있지 않은 128 byte 이하 값이다. metadata patch는 깊이 128, 값 node 100,000 및 key/string/remove key 합계 8 MiB로 제한하고 patch/remove의 겹치는 key를 거부한다. 파일 내용·frontmatter·permalink 고유성·실제 revision 검사는 수락된 worker가 기존 service에서 수행한다.

검증된 mutation의 JSON object key를 재귀적으로 정렬한 SHA-256 fingerprint를 저장한다. 배열 순서, 문자열과 operation 종류는 유지한다. scope의 동일 ID/동일 fingerprint 호출은 진행 중인 경우와 완료된 경우 모두 같은 최초 결과를 공유한다. 다른 fingerprint는 `requestIdConflict`다. 최초 결과가 stale revision 등 오류여도 재시도에서 다시 파일을 바꾸지 않는다. 인자 구문이나 초기 수락 capacity 오류처럼 journal에 들어가지 못한 요청은 mutation을 시작하지 않는다.

## 결과를 쓰기 전에 확보

기본 journal 한도는 scope당 128개 ID와 64 MiB다. ID별로 4096 byte의 오류/기록 예산과 requestId byte를 예약하고, 성공 응답의 JSON 직렬화 크기를 추가로 계산한다. 이는 보관 응답과 기록의 논리적 byte 예산이며 프로세스 전체 heap 사용량 한도를 의미하지 않는다. 수락된 인자와 준비 중인 YAML/JSON 값은 별도의 일시 메모리를 사용한다.

worker는 UI와 같은 `DocumentService` mutex 아래에서 현재 문서 확인, 후보 작성, metadata projection과 성공 응답을 먼저 준비한다. JSON counting writer가 전체 JSON 문자열을 추가 생성하지 않고 응답 크기를 계산한다. journal 예약에 실패하면 `requestCapacityExceeded` 결과를 보관하고 파일/이력을 변경하지 않는다. 예약 성공 뒤에도 filesystem CAS/no-clobber가 최종 revision/존재 여부를 확인한다.

성공 응답은 미리 준비한 snapshot을 사용한다. 이력 경고는 고정된 안전한 문자열 또는 null이고, 삭제 후 trashId는 고정 길이 UUID다. 복원은 미리 확인한 retained path/revision이 publication 시점에도 같은지 저장소 잠금 안에서 검사한다. 쓰기 이후 새 metadata projection이나 용량 실패 때문에 성공 결과를 버리지 않는다. 일반 오류도 adapter exception을 그대로 노출하지 않고 code와 안전한 메시지로 보관한다.

완료 시 사용하지 않은 예약 byte를 반환하며 ID와 최초 결과는 지우지 않는다. 한도가 찬 상태에서도 기존 ID의 정상 재시도는 가능하다. 구문이 유효한 요청의 업무/용량 실패 결과도 ID 한도를 소비한다. TTL, LRU, 자동 journal 초기화는 없다. journal은 generation 수명에 연결되며 같은 루트의 일반 refresh는 유지하고 명시적 rebind/새 루트 선택은 새 generation을 만든다. 앱 재시작을 넘는 재시도 보장은 제공하지 않는다.

## 수락한 작업 소유와 종료

새 요청의 worker는 고정된 service, journal, [scope permit](document-scope-lifecycle.md)을 소유한다. 응답 ticket나 HTTP adapter의 기다리는 작업을 버려도 worker는 저장·이력·최초 결과 기록을 끝낸 뒤 permit를 해제한다. 최대 worker 수는 수락 ID 한도로 제한하며 실제 파일 변경은 같은 service mutex에서 직렬화한다.

`MutationTicket::wait`는 blocking API다. gh-51의 async HTTP handler는 blocking executor에서 기다려 reactor를 막지 않아야 한다. `try_result`는 이미 완료된 결과를 확인한다. 루트 전환/명시적 종료/manager Drop은 새로운 호출을 거부하고 수락한 worker의 결과 기록까지 drain한다. 구 generation의 결과 ticket은 수락된 원 작업의 결과를 받을 수 있지만, 폐기된 scope로 새로운 재시도 호출을 할 수 없다.

## 실제 파일 검증

앱 테스트 13개는 16개 동시 재시도의 같은 최초 결과·저장/이력 한 번, 다른 payload/operation 충돌, 응답 drop 후 root 전환·manager Drop 대기, 구 scope 신규 거부와 새 generation의 독립 결과, stale 오류 보관, count/byte capacity와 기존 결과 재시도, canonical nested metadata fingerprint와 BOM/CRLF/주석/본문 보존, native/worker 동시 CAS, 삭제/복원 ID 및 이력 보존, metadata/복원 용량 거부 전 원본 보존, 잘못된 metadata의 path 삭제, 안전한 이력 경고와 인자 거부를 확인한다.

추가 저장소 테스트는 준비 이후 복구 manifest의 path 또는 revision/content가 함께 변경돼도 `restore_checked`가 공개 전에 거부하는지 확인한다. 이 검증은 실제 HTTP disconnect/auth/MCP discovery나 설치 agent·macOS 화면 증거를 대신하지 않는다. 이 범위는 gh-51~53 및 gh-57에서 계속 검증한다.

최종 실행 결과는 앱 60개 통과(helper 1개 ignored 및 subprocess 3회 통과), 파일 저장소 16개·metadata 16개 통과다. `pnpm check-types`, `pnpm build`, `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`도 통과했다. HTTP handler에 아직 연결하지 않은 application API의 dead-code 경고 39개와 기존 AW 경고는 남아 있다. 로그는 `/tmp/box-md-gh63-{native-tests,store-tests,types,build,fmt,rust}.log`에 기록했다. 실행 중인 앱 번들은 재빌드하지 않았다.
