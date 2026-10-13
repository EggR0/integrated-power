# 실제 설치 환경 적용 전 점검

점검: 2026-10-13 13:10 KST. 읽기 전용 점검이며 설치·재시작은 수행하지 않았다.

## 확인한 대상

- Windows 설치 앱: `C:\Program Files\Integrated Power Control Center\integrated-power-control-center.exe`, 파일/제품 버전 `0.8.0`.
- 해당 실행 파일 SHA-256: `3E580686789CB4EC3235DF6C5E1C186FC1A4BC5534EC93433682954C02AE2BAE`.
- 기존 설치는 HKLM에 등록된 MSI이며 Publisher는 `eggr`이다.
- Antigravity IDE 설치 경로: `C:\Users\jsp0\AppData\Local\Programs\Antigravity IDE`.
- 확장 인덱스 `C:\Users\jsp0\.antigravity-ide\extensions\extensions.json`에 등록된 대상은 `eggr0.integrated-power` 버전 `0.9.21`이다.
- 설치된 확장의 `webview/main.js`, `styles.css`, `quota-core.js`에는 새 눈금 구현의 `buildGaugeTickGradient`, `progress-ticks`, `data-segments`가 없다. `main.js`와 `styles.css`에는 기존 모델별 프리웜 컨트롤이 있다. 즉 새 눈금 패키지는 아직 설치되지 않았다.
- 이전 `eggr.integrated-power-0.9.1` 폴더도 남아 있지만, 폴더 존재만으로 두 확장이 활성화됐다고 판단하지 않는다. 삭제하지 않는다.
- 현재 `127.0.0.1:37241` LISTENING 소유 PID는 `356`, 프로세스는 `Antigravity IDE`다. 이는 점검 시각의 값이며 적용 직전에 다시 확인해야 한다.
- 현재 health는 `{ok:true,service:"integrated-power-broker"}`이며 새 schema 필드가 없는 기존 브로커다. 임의로 PID를 종료하지 않는다.
- 데스크톱 상태 루트는 `C:\Users\jsp0\AppData\Local\IntegratedPower\state`이며 기존 암호화 원장, DPAPI 키 파일 및 과거 SQLite 백업이 존재한다. 내용은 출력하지 않았다.

## 점검에서 발견한 수정 대상

실제 IDE의 `APPDATA\Antigravity IDE\User\globalStorage\eggr0.integrated-power\broker` 폴더가 존재한다. 그러나 데스크톱의 기본 이전 기록 후보는 `Antigravity`, `Code`, `Code - Insiders`만 포함했다. 데스크톱이 먼저 시작하면 실제 IDE 폴더의 원장을 놓칠 수 있어 기존 후보에 `Antigravity IDE`를 추가했다. 양쪽 데스크톱은 합성 APPDATA/키/원장으로 이전·HTTP 재기동 후 readback·MCP 시작 검사를 통과했으며, 부모도 nested 검사를 독립 실행해 통과했다. 사용자의 원장이나 키로 시험하지 않았다. 원장 폴더 내용 열거는 현재 샌드박스에서 거부돼 실제 데이터 일치 여부는 아직 확인하지 못했다.

최종 NSIS 설치 파일은 2026-10-13 13:14 KST에 재생성됐으며 크기는 35,417,227 bytes, SHA-256은 `6630893B751CF0A814A96BEBD04CC561BB98B4486D60323D5CBD7BA0ECD9F42B`다. 통합 VSIX의 SHA-256 `DC84F9A48E771B97AB88A736001FF0645F238D2369A70CB7BCEA97BFF5B8ED22`와 복원한 원본 VSIX의 SHA-256 `D736C82CD58CAE43B32469F7F1AA9AF84C7449AD10216B9B4FB45FE413974DAD`는 바뀌지 않았다.

## 승인 후 적용 순서와 중단 조건

1. 적용 직전에 포트 소유자, IDE 확장 인덱스, 설치 버전과 새 패키지 해시를 다시 확인한다.
2. 같은 사용자 보안 경계 안에서 기존 설치 파일과 상태 루트·해당 IDE 확장 상태를 복구 가능하게 보존한다. DPAPI/Credential Manager 데이터를 외부로 전송하거나 키 원문을 출력하지 않는다.
3. 기존 `EggR0.integrated-power`에 별도 통합 VSIX를 적용한다. 확장 호스트 재시작은 사용자 승인 후 수행하고 IDE 전체 프로세스를 강제 종료하지 않는다.
4. 현재 생성된 NSIS 템플릿은 기존 MSI의 제품명/Publisher를 확인한 뒤 이전 설치 제거 절차를 포함한다. 기본 새 설치 범위는 currentUser다. 적용 시 기존 MSI와의 전환 및 설치 경로를 확인한다. 설치 관리자의 대화형 승인을 자동으로 수락하지 않는다.
5. 한 호스트가 새 브로커를 소유하고 다른 호스트가 연결하는지 확인한다. schema 2, 필수 capability, 설정 revision, workspace/run/metric 상태 연속성을 실제 설치 환경에서 검증한다.
6. IDE와 Windows에서 모델별 버튼, 5시간 5등분/주간 7등분, 설정 보존과 기존 표시 동작을 확인한다. 실모델 프리웜 호출은 별도 요청이 없으면 하지 않는다.

마이그레이션 충돌·누락 키·손상 원장이 발견되면 원장을 합치거나 덮어쓰지 않고 적용 검증을 중단한다. 복구는 보존한 설치본과 상태를 기준으로 하며 새로운 실행 이후 생긴 기록을 삭제하거나 덮어쓰기 전에 차이를 확인한다.

## 남은 승인

저장소 `AGENTS.md`의 `server restart require user approval` 규칙에 따라 설치와 브로커 재시작 승인을 기다린다. 자동 goal continuation은 이 승인을 대체하지 않는다.
