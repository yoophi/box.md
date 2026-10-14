# 문서 변경 이벤트와 main 갱신 계획 (gh-77)

MCP의 문서·관계 변경을 main 화면에 반영한다. 변경 중인 사용자 문서를 자동으로 덮어쓰지 않으며 content, editor key, undo, baseline과 revision을 보존한다. 구현은 backend 완료 이벤트 → main 갱신 → 전체 통합 감사 순서의 하위 td 작업으로 나누어 진행한다.

## Backend 완료 이벤트

`MutationRegistry`의 accepted worker가 실제 변경과 history 처리를 끝낸 시점에 성공한 변경을 한 번 발행한다. HTTP handler가 응답을 보낸 시점에 발행하지 않는다. 같은 request ID의 ticket 재사용, 응답 유실 후 재시도와 실패한 CAS는 추가 이벤트를 만들지 않는다. 성공했지만 history warning이 있는 변경은 파일 변경이 완료되었으므로 이벤트 대상이다.

application은 Tauri에 의존하지 않는 변경 sink를 주입받는다. payload에는 generation, 상대 문서 식별 정보와 문서/관계 변경 구분만 포함한다. bearer, 본문, 입력 인자, request ID 및 작업 루트 절대 경로를 포함하지 않는다. Tauri adapter는 main WebView로만 전달하며 외부 child WebView에는 발행하지 않는다. 응답을 기다리는 consumer가 없어도 accepted worker의 이벤트는 발생해야 한다.

## Main 갱신과 편집 보호

현재 workspace generation의 이벤트만 처리한다. 목록은 변경 완료 후 재조회하고, 관계 이벤트는 별도 관계 모델을 갱신한다. 현재 문서의 외부 변경·삭제를 구분한다. clean 문서는 조회 결과를 반영하고 dirty 문서는 본문과 저장 기준을 유지한 채 외부 변경/삭제를 안내한다. 이후 저장은 기존 expected revision CAS를 사용한다.

조회 중 문서 선택·root 변경·같은 경로 재선택·사용자 입력·저장이 발생하면 오래된 응답을 적용하지 않는다. 여러 이벤트와 동시 저장에서 필요한 최종 재조회가 누락되지 않도록 요청을 합치고 pending refresh를 다시 처리한다. 패널·보기 모드 전환은 문서 편집기를 불필요하게 재생성하지 않는다.

## 검증

backend는 실제 mutation/HTTP 테스트에서 성공·실패·nonce 재시도·응답 유실·root 전환과 history 완료 순서를 확인한다. main 전용 event 대상과 credential 비노출도 확인한다. frontend는 목록/clean/dirty/삭제, 조회 중 사용자 입력·저장·root 변경, undo/baseline 및 관계 갱신을 검증한다. 최종 감사는 backend 이벤트부터 main 반영까지의 실제 실행과 부모 gh-77 기준을 대조하고 기본 검사, 문서, 단위 commit/push 및 완료 알림을 남긴다.

이 계획은 구현 완료 증거가 아니다. ACP 세션 연결의 선행 근거는 [gh-76 감사](document-mcp-acp-acceptance.md)이며 native 전체·설치 agent 감사 gh-53과 부모 gh-52 통합 gh-78의 범위를 유지한다.
