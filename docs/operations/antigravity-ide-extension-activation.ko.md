# Antigravity IDE 확장 활성화 장애 진단

## 대상 구분

현재 개발·설치 대상은 다음 실행 파일에서 동작하는 VS Code 계열 확장이다.

```text
%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe
```

별도의 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe`나 Codex 자체 확장을
개발하는 단계가 아니다. Codex는 EggR Orchestrator가 선택적으로 호출할 수 있는
실행 경로일 뿐이다.

확장 조회·설치에는 다음 CLI wrapper만 사용한다.

```text
%LOCALAPPDATA%\Programs\Antigravity IDE\bin\antigravity-ide.cmd
```

특히 별도 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe`는
Antigravity IDE 확장 관리에 절대 사용하지 않는다. GUI `Antigravity IDE.exe`에도
`--list-extensions`, `--install-extension` 같은 CLI 옵션을 직접 전달하지 않는다.
Electron GUI가 명령을 처리하지 않고 창을 시작할 수 있기 때문이다.

## 증상

- 확장 목록에는 `Antigravity IDE Dashboard`가 설치됐다고 표시된다.
- 명령 팔레트에서 `EggR:` 명령을 실행하면 찾을 수 없거나 동작하지 않는다.
- 확장 호스트 로그에는 다음과 같은 오류가 남는다.

```text
Activating extension EggR.integrated-power failed
SyntaxError: Unexpected token '﻿'
```

## 0.4.0의 직접 원인

Windows PowerShell 5.1의 `Set-Content -Encoding UTF8`은 UTF-8 BOM을 쓴다.
`set-eggr-roots.ps1`가 만든 `%USERPROFILE%\.config\eggr\roots.json`의 첫 세
바이트가 `EF BB BF`였고, Dashboard 0.4.0이 이를 제거하지 않은 채
`JSON.parse`하여 활성화 초기에 실패했다.

명령은 `package.json`에 정상 등록되어 있어도, 실행 시점의 확장 활성화가
실패하면 사용자는 명령이 동작하지 않는 것으로 보게 된다.

## 0.4.1의 재발 방지

- Dashboard는 UTF-8 JSON을 읽을 때 선행 BOM을 제거한다.
- 전역 `roots.json`뿐 아니라 프로젝트별 `.eggr/workspace.json`과 설정
  마법사가 읽는 JSON에도 같은 처리를 적용한다.
- Windows `set-eggr-roots.ps1`은 `UTF8Encoding(false)`로 BOM 없는 JSON을
  원자적으로 저장한다.
- headless와 extension-host 테스트가 BOM이 포함된 `roots.json`을 실제로
  만들어 경로 해석을 검증한다.
- Windows Knowledge 기능 테스트가 저장된 JSON의 첫 바이트와 유효성을 확인한다.

0.4.2에서는 확장에 표시되는 README를 전면 교체해 Antigravity IDE 전용 대상,
별도 Antigravity 실행 금지, Codex 확장이 아님, 올바른 CLI wrapper와 세 갈래
설정 범위를 첫 문서에서 확인할 수 있게 했다.

## 확인 절차

1. `roots.json`의 첫 바이트가 `{`인 `7B`인지 확인한다.
2. Antigravity IDE 확장 카탈로그가 Dashboard 0.4.1인지 확인한다.
3. Antigravity IDE 창을 다시 불러와 새 확장 호스트를 시작한다.
4. 최신 `exthost.log`에서 Dashboard 활성화 오류가 없는지 확인한다.
5. 명령 팔레트에서 다음 명령이 보이는지 확인한다.
   - `EggR: Run First-Run Setup`
   - `EggR: Configure Dashboard`
   - `EggR: Configure Orchestrator`
   - `EggR: Configure Private Git Knowledge`
   - `EggR: Install or Update Orchestrator`

## 세 사건의 구분

2026-07-27 사례에서 Antigravity IDE 인증 로그는 먼저 quota 오류와 내부
`BigInt` 직렬화 오류를 기록했으나 이후 OAuth `signedIn`까지 진행했다. 이는
Dashboard BOM 활성화 오류와 별개의 Antigravity IDE 인증 흐름이다.

별도 Antigravity 2.3.1은 잘못된 실행 파일 조회로 20:40:27에 시작되어
20:43:21에 종료됐다. 이 앱의 로그상 직접 시작한 것은 `language_server.exe`와
번들 `agy-node`이며 Java를 새로 시작한 기록은 없다.

기존 Minecraft NeoForge Java 서버는 전날부터 실행 중이었지만, 별도 Antigravity가
떠 있던 20:41:05~20:41:47에 모드 오류·이동 경고와 다음 과부하 경고를 기록했다.

```text
Can't keep up! Is the server overloaded? Running 3380ms or 67 ticks behind
```

JVM crash나 Windows crash 이벤트는 없었다. 그러므로 별도 Antigravity가 Java를
직접 실행하거나 crash시켰다고 단정할 수는 없지만, 두 사건은 시간상 실제로
겹쳤고 자원 경합 가능성도 배제할 수 없다. 이를 “무관하다”라고 단정하지 않는다.
