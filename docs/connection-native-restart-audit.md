# 연결 데이터의 네이티브 앱 재실행 감사 (gh-38)

## 목적과 격리 범위

실제 macOS Tauri 앱을 종료하고 같은 프로필로 다시 실행했을 때 명시적 연결 엔티티와 관계가 복원되는지 확인했다. 브라우저 새로고침이나 저장소 객체 재생성을 근거로 사용하지 않았다.

- 제품명: `box.md GH38QA`
- bundle identifier: `com.yoophi.box-md.gh38`
- 앱 bundle: `target/debug/bundle/macos/box.md GH38QA.app`
- 임시 작업 디렉터리: `/tmp/box-md-gh38.pJIOCw`
- 문서 permalink: `261014170500-11111111`, `261014170501-22222222`

별도 bundle identifier를 사용했으므로 앱 데이터, WebKit 데이터, preferences가 사용자용 `com.yoophi.box-md`와 분리됐다. 검증 대상은 임시 문서와 격리 프로필로 제한했다.

## 실행 결과

1. 실제 Tauri 창에서 임시 작업 디렉터리를 선택하고 첫 문서를 열었다.
2. `재실행 검토` 연결 엔티티를 만들고 첫 문서와 둘째 문서를 연결했다.
3. 저장 파일에서 엔티티 ID `f504f75a-f6e4-4dd1-a1e3-0cfd4ead3dcc`와 두 membership을 확인했다.
4. 창의 닫기 버튼으로 앱을 종료하고 첫 프로세스가 사라진 것을 확인했다.
5. 같은 bundle identifier의 앱을 다시 실행했다. 새 프로세스는 다른 PID로 실행됐고 작업 디렉터리와 문서 목록을 자동 복원했다.
6. 둘째 문서의 `재실행 검토` 칩에서 관련 문서 `첫 문서`, `둘째 문서`를 확인했다.
7. `첫 문서`를 눌러 permalink 기반 이동이 성공하고, 이동한 문서에서도 연결 칩과 관련 문서 목록이 유지되는 것을 확인했다.

재실행 뒤 앱 데이터의 `connections.json`은 다음 논리 데이터를 유지했다.

```json
{
  "version": 1,
  "entities": [
    {
      "id": "f504f75a-f6e4-4dd1-a1e3-0cfd4ead3dcc",
      "name": "재실행 검토"
    }
  ],
  "memberships": [
    {
      "connectionId": "f504f75a-f6e4-4dd1-a1e3-0cfd4ead3dcc",
      "permalink": "261014170500-11111111"
    },
    {
      "connectionId": "f504f75a-f6e4-4dd1-a1e3-0cfd4ead3dcc",
      "permalink": "261014170501-22222222"
    }
  ]
}
```

## 원본 보존 확인

두 임시 Markdown 파일의 SHA-256을 연결 생성 전과 재실행 뒤에 비교했다. 값은 각각 아래와 같았고 변하지 않았다.

| permalink | SHA-256 |
| --- | --- |
| `261014170500-11111111` | `c074fee01e948a2c36d375b2702cf4c264f92a06375e8cd1656e5331115c6f01` |
| `261014170501-22222222` | `960e400b98108696d9362d9bb39678404c28cd154e11e0101cb8d6f2510ce281` |

따라서 연결 엔티티 생성, 관계 저장, 앱 종료와 재실행, 관련 문서 이동이 문서 원본을 변경하지 않았다.

## 판정과 정리

gh-38의 실제 앱 재실행 기준을 충족한다. 같은 엔티티 ID와 두 관계, 현재 문서 칩, 관련 문서 목록, permalink 이동이 모두 복원됐다. 검증 후 격리 앱을 종료하고 app bundle, 임시 문서, `com.yoophi.box-md.gh38` 전용 데이터만 삭제했다. 사용자 앱과 문서, 설정은 유지했다.
