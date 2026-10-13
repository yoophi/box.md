# 네이티브 작업 디렉터리 복원 검증 (gh-28)

2026-10-13 macOS arm64에서 실제 Tauri 앱의 폴더 선택, 설정 저장, 프로세스 종료·재실행, 접근 불가 상태와 재선택 복구를 확인했다. Chromium reload나 저장소 객체 재생성을 앱 재실행 증거로 사용하지 않았다.

## 실행 환경

`f03ad40` 소스와 기존 미커밋 ACP 모델 선택 변경 두 파일을 포함한 현재 작업 트리에서 debug app bundle을 빌드했다. ACP 변경은 이번 작업에서 수정하거나 커밋하지 않았다. 별도 [QA 설정](../apps/box-desktop/tests/native/tauri.qa.conf.json)의 productName은 `box.md NativeQA`, identifier는 `com.yoophi.box-md.nativeqa`, deep link scheme은 `boxmd-nativeqa`다. 기본 앱의 식별자·설정·실행 프로세스를 변경하지 않았다.

```sh
pnpm --filter @box/desktop tauri build --debug --bundles app --config tests/native/tauri.qa.conf.json
pnpm --filter @box/desktop fixture:native-browser
```

실행한 번들은 `target/debug/bundle/macos/box.md NativeQA.app`이며 executable SHA-256은 `100acb7ee6f5ea8dba5b5f2326545e024224d66e82ceefd44558d6274e033323`이다. 동일 내용의 임시 QA 설정을 사용한 실제 build 로그는 `/tmp/box-md-native-current-build.log`이고 종료 코드 0 및 app bundling 성공을 확인했다. frontend TypeScript/build와 native compile도 이 build에서 실행됐다.

fixture PID 75134가 만든 `box-md-browser-fixture-k6xc83/workspace`의 `source.md`, `target.md`만 사용했다. 모든 macOS 창·폴더 선택기 조작과 화면 관찰은 Computer Use에서 수행했다. 현재 기본 사용자 앱 PID 59546은 검증 전후 계속 실행 중이며 해당 앱의 문서·설정·ACP 세션을 조작하지 않았다.

## 기준별 근거

| 기준 | 실제 실행·화면 결과 |
| --- | --- |
| 네이티브 폴더 선택·저장 | 최초 실행은 저장 경로와 목록이 없는 별도 프로필이었다. 설정 → 폴더 선택에서 macOS Open panel과 Go To 입력창으로 fixture workspace를 선택했다. 설정 저장 후 sidebar의 workspace 경로와 source.md/target.md 두 문서를 확인했다. |
| 종료·재실행 | 첫 실행 PID 5300에서 Cmd+Q로 정상 종료했다. `ps -p 5300`에서 프로세스 부재를 확인한 뒤 같은 bundle을 다시 실행했다. 새 PID 9231에서 경로·두 문서가 자동 복원됐고 설정 화면의 현재 저장 경로도 일치했다. |
| 접근 불가 폴더 | PID 9231도 정상 종료·부재 확인 후 fixture의 workspace만 workspace-moved로 가역 이동했다. 새 PID 11222에서 원래 저장 경로가 존재하지 않아 목록을 열지 못했다. 설정 화면은 원래 경로를 유지하고 “저장된 디렉터리를 열지 못했습니다. 다른 폴더를 선택하거나 다시 저장해주세요.”를 표시했다. |
| 재선택 복구 | 실제 Open panel에서 workspace-moved를 선택하고 설정 저장했다. sidebar 경로가 이동된 경로로 바뀌고 source.md/target.md 두 문서가 다시 표시됐다. 오류가 사라진 화면을 확인했다. |
| 문서와 사용자 상태 보존 | 문서 저장은 실행하지 않았다. 두 파일의 SHA-256은 시작·복구 후 모두 아래 값과 같았다. workspace를 원래 이름으로 되돌린 뒤 네이티브 폴더 선택·저장으로 QA 설정도 원래 fixture 경로로 복원했다. 기본 사용자 앱 PID는 동일하게 유지됐다. |

| 파일 | 검증 전후 SHA-256 |
| --- | --- |
| source.md | da3c870cf41a4d68bc9fa77165e1320c55c4747ac4a356e7aa74033602b65e2e |
| target.md | 9e99b48fa068591a345f14d4813527b6483bdc14f7e88592fb9433383f89e979 |

폴더 선택기, 재실행 뒤 설정 화면, 접근 불가 경고, 재선택 뒤 목록의 실제 native screenshot과 accessibility tree를 이 작업 실행 기록에서 관찰했다. 기존 `assets/workspace-settings-*.png`는 Chromium 검증 이미지이며 이번 native 화면으로 재분류하지 않는다.

gh-28의 전체 수용 기준은 충족했다. 상위 gh-14의 설정 흐름 전수 감사와 다른 작업의 ACP·사이트·관계 검증은 각각의 td 작업에서 판단한다. fixture 서버와 NativeQA는 후속 native 검사에 사용하므로 유지한다. 서버가 종료돼 임시 폴더가 없어지면 QA 프로필의 접근 불가 안내는 예상되는 동작이다.
