# 문서 변경 이벤트의 main 갱신 (gh-83)

main 화면이 `box:document-change`를 구독해 현재 workspace generation의 변경만 반영한다. frontend adapter는 payload의 종류와 크기, 상대 경로 및 revision을 확인하고 절대 경로·상위 경로·알 수 없는 payload를 버린다.

## 문서 목록과 열린 문서

모든 유효한 현재 generation 이벤트는 문서 목록 재조회를 예약한다. 조회 중 새 이벤트가 오면 한 번 더 조회해 마지막 변경을 놓치지 않는다. clean 상태로 열린 문서가 변경되면 디스크 내용을 읽고 event revision과 일치할 때 content, baseline, revision을 함께 갱신한다. editor key를 새로 만들어 외부 내용에 맞는 새 편집 history를 시작한다.

dirty 문서는 content, editor key, undo history, baseline과 revision을 그대로 둔다. 외부 변경 안내를 표시하고 다음 저장에서 기존 revision CAS가 충돌을 판정한다. 외부 삭제도 내용은 복구할 수 있도록 유지하고 목록에서만 제거하며 clean/dirty에 맞는 안내를 표시한다.

event 처리 중 사용자 입력·문서 선택·저장·root 전환 또는 같은 경로 rebind가 발생하면 시작 시점의 document identity와 generation 검사를 통과하지 못하므로 늦은 읽기 결과를 적용하지 않는다. 저장 같은 작업 중 도착한 이벤트는 문서별 최신 이벤트로 모아 작업 종료 후 처리한다. 연속 event가 목록 조회와 겹치면 pending refresh를 수행한다.

## 관계 갱신

`connectionsChanged`는 현재 generation에서만 관계 목록을 다시 읽는다. 기존 관계 mutation과 event 재조회가 겹치면 sequence 검사를 통해 오래된 응답을 버리고 최신 목록을 다시 읽는다. 관계 event에는 문서 정보가 없으며 문서 editor를 변경하지 않는다.

## 검증

단위 회귀는 clean 갱신과 새 revision 저장, dirty editor instance와 draft 유지, clean/dirty 삭제, old generation, 사용자 입력 뒤 늦은 read, 저장 중 event, 연속 목록 refresh 및 관계 generation 갱신을 검사한다. payload adapter는 절대·상위·Windows 절대 경로, 과도한 revision과 잘못된 관계 payload를 거절한다. 실제 backend event부터 화면과 undo까지의 브라우저 통합은 gh-84에서 검증한다.
