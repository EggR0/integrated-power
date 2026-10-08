# Open VSX 자동 배포 가이드

이 문서는 Open VSX Registry에 `EggR0.integrated-power` 확장 프로그램을 자동으로 빌드 및 배포(Publish)하기 위한 설정과 실행 방법을 안내합니다.

---

## 1. 기본 정보 및 인증

* **네임스페이스 / 퍼블리셔**: `EggR0`
* **확장 ID**: `EggR0.integrated-power`
* **공식 레지스트리 URL**: https://open-vsx.org/extension/EggR0/integrated-power
* **인증 토큰 (OVSX PAT)**:
  * Open VSX 설정(`open-vsx.org/user-settings/tokens`)에서 발급받은 개인 액세스 토큰을 사용합니다.
  * 환경 변수 이름: `OVSX_PAT`

---

## 2. 로컬 터미널에서 자동 배포

### 2.1 토큰 환경 변수 등록 (Windows PowerShell)

터미널 세션 또는 사용자 환경 변수에 토큰을 설정합니다:

```powershell
# 현재 PowerShell 세션에 설정
$env:OVSX_PAT = "<YOUR_OPEN_VSX_PAT>"

# 또는 사용자 전역 환경 변수로 영구 등록
[Environment]::SetEnvironmentVariable("OVSX_PAT", "<YOUR_OPEN_VSX_PAT>", "User")
```

### 2.2 배포 명령어

VSIX 빌드 후 `npx ovsx publish`를 실행합니다:

```powershell
# 1. 최신 VSIX 패키징
cd "d:\Workspace\Integrated POWER\vscode-extension"
.\node_modules\.bin\vsce.cmd package --no-dependencies

# 2. Open VSX로 배포 (.ovsx-token 파일 사용 시)
$pat = (Get-Content "..\.ovsx-token").Trim()
npx ovsx publish (Get-Item .\*.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -p $pat --skip-duplicate
```

---

## 3. GitHub Actions CI를 통한 완전 자동 배포

GitHub에 Release가 생성/발행(`published`)될 때마다 Open VSX에 자동으로 업로드되는 CI 워크플로우가 구성되어 있습니다.

### 3.1 GitHub Secret 등록 완료
* **Secret 이름**: `OVSX_PAT` (저장소 `EggR0/integrated-power`의 GitHub Actions Secret에 등록 완료)
* 이제 `gh release create` 또는 웹에서 Release를 발행하면 자동으로 VSIX를 감지/빌드하여 Open VSX로 배포합니다.

### 3.2 워크플로우 연동 예시 (`.github/workflows/publish-openvsx.yml`)
```yaml
name: Publish to Open VSX

on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies & Build VSIX
        run: |
          cd vscode-extension
          npm install
          npx vsce package --no-dependencies

      - name: Publish to Open VSX
        run: |
          npx ovsx publish ./vscode-extension/*.vsix -p ${{ secrets.OVSX_PAT }} --skip-duplicate
```

---

## 4. 배포 상태 확인 명령어

배포가 정상 완료되었는지 CLI로 즉시 확인할 수 있습니다:

```powershell
# 토큰 권한 검증
npx ovsx verify-pat EggR0 -p $env:OVSX_PAT

# 현재 배포된 최신 버전 및 메타데이터 확인
npx ovsx show EggR0.integrated-power
```
