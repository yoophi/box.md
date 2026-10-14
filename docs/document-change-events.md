# 문서 변경 완료 이벤트 (gh-82)

MCP 문서·관계 mutation의 실제 완료를 main 화면에 알리는 `box:document-change` 이벤트를 추가했다. application의 `DocumentChangeSink`는 Tauri를 알지 않으며, native adapter가 event target을 `main` WebView로 고정한다. child WebView와 전체 app broadcast를 사용하지 않는다.

## 발행 시점과 중복 방지

`MutationRegistry`가 처음 수락한 request ID의 worker만 이벤트를 발행한다. worker는 파일 변경과 history 처리를 마치고 성공 결과를 journal에 확정한 뒤 이벤트를 보낸다. HTTP 응답 future가 끊겨도 accepted worker와 이벤트는 완료된다. 같은 request ID를 같은 입력으로 재시도하면 저장된 ticket 결과를 반환하므로 이벤트를 다시 만들지 않는다. CAS 실패와 다른 오류는 이벤트를 만들지 않는다.

이벤트 sink 오류나 panic은 이미 완료된 파일 변경과 ticket 응답을 되돌리지 않는다. root 전환은 기존 admission drain을 기다리므로 이전 generation 이벤트가 완료된 뒤 새 root를 공개한다.

## Payload

payload에는 `generation`, 변경 종류 및 필요한 경우 상대 문서 `path`와 `revision`만 포함한다. 종류는 `documentChanged`, `documentDeleted`, `connectionsChanged`다. 문서 본문, 작업 루트 절대 경로, request ID, connection 이름, MCP bearer/grant 정보는 포함하지 않는다. 관계 변경 이벤트에는 문서 정보가 없다.

실제 loopback MCP HTTP 테스트는 create/update/delete와 관계 변경, 실패한 CAS, 같은 request ID 재시도 및 연결이 끊긴 accepted mutation을 검증한다. event가 history 완료 전에는 나오지 않고 root drain 이후 정확히 한 번 나오며, payload에 본문·request ID·절대 root·credential이 없는지 확인한다. native target 단위 테스트는 event가 `main` WebView만 대상으로 하는지 검사한다.

main에서 이 이벤트를 구독해 clean/dirty 문서와 관계를 갱신하는 작업은 gh-83, backend부터 화면까지의 통합 감사는 gh-84에서 진행한다.
