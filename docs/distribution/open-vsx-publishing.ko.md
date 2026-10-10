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

GitHub에 Release가 생성/발행(`published`)될 때마다 Open VSX에 자동으로 업로드되는 CI 워크플로우(`.github/workflows/publish-openvsx.yml`)가 구성되어 있습니다.

### 3.1 GitHub Secret 및 Trusted Publishing 설정
* **Secret 이름**: `OVSX_PAT` (저장소 `EggR0/integrated-power`의 GitHub Actions Secret에 등록 완료)
* **OIDC Trusted Publishing**: 워크플로우에 `id-token: write` 권한이 부여되어 있어 Trusted Publishing을 우선 시도하며, 설정되지 않았거나 미지원 시 `OVSX_PAT`로 자동 폴백합니다.

### 3.2 배포 워크플로우 핵심 구조 (`.github/workflows/publish-openvsx.yml`)
1. **Release Asset 우선 다운로드**:
   `gh release download`를 통해 Release에 첨부된 `.vsix` 파일을 즉시 다운로드하여 소스 재빌드로 인한 바이너리 해시 차이를 방지합니다 (약 20초 만에 완료).
2. **Fallback 빌드 (Node 24 + pnpm 11.9.0)**:
   Release에 바이너리가 첨부되지 않은 경우에만 Node 24 환경에서 소스로부터 즉시 패키징합니다.
3. **중복 배포 안전 처리 (`publish_target` 래퍼)**:
   로컬이나 이전 단계에서 이미 배포된 경우, `ovsx CLI`의 비정상 종료(Exit Code 1)를 감지하여 성공으로 정상 처리합니다.

```bash
publish_target() {
  local flags="$1"
  local output
  local code=0
  output=$(npx ovsx publish "$VSIX_FILE" $flags 2>&1) || code=$?
  echo "$output"
  if [ $code -eq 0 ]; then
    return 0
  fi
  # 이미 배포되었거나 인덱싱 중인 경우 성공(0)으로 수렴
  if echo "$output" | grep -qiE "already published|already exists"; then
    echo "Note: Extension version is already published on Open VSX. Treating as success."
    return 0
  fi
  return $code
}
```

---

## 4. 중복 배포 실패 알림 메일 방지 원리 (Duplicate Publish Guard)

### 4.1 문제 배경
- 로컬 스크립트로 `npx ovsx publish`를 선행 실행한 뒤 GitHub Release를 발행하면, GitHub Actions CI가 자동으로 구동됩니다.
- 이때 Open VSX 서버는 패키지가 이미 존재할 경우 다음 메시지를 반환합니다:
  ```text
  ❌ Extension EggR0.integrated-power 0.9.8 is already published, but currently isn't active and therefore not visible.
  ```
- 기본 `ovsx` CLI는 `--skip-duplicate` 옵션을 주더라도 이 상태를 **Exit Code 1**로 반환합니다.
- Bash 환경(`set -e`)에서는 명령어 종료 코드가 1이면 전체 워크플로우를 즉시 실패(Failure)로 처리하여, **실제 배포가 잘 되었음에도 사용자에게 'Run failed' 이메일이 발송되는 문제**가 있었습니다.

### 4.2 방지 조치
- CI 스크립트에 `publish_target` 래퍼를 적용하여, 메시지에 `already published` 또는 `already exists`가 포함되면 이를 **정상적인 멱등성(Idempotency) 성공(Exit Code 0)** 으로 해석합니다.
- 실제 네트워크 단절, 토큰 만료, 패키지 파일 손상 등 진짜 장애 시에만 실패하도록 분리되어 있습니다.

---

## 5. 배포 상태 확인 명령어

배포가 정상 완료되었는지 CLI로 즉시 확인할 수 있습니다:

```powershell
# 토큰 권한 검증
npx ovsx verify-pat EggR0 -p $env:OVSX_PAT

# 현재 배포된 최신 버전 및 메타데이터 확인
npx ovsx show EggR0.integrated-power

# 최근 CI 실행 상태 확인
gh run list --workflow=publish-openvsx.yml --limit 3
```

---

## 6. 관련 문서

* [Integrated Power 통합 배포 및 릴리스 가이드](release-and-deployment-guide.ko.md)
* [사이드바 UI 바깥 튀어나감 방지 지침](../reference/compact-ui-overflow-prevention.ko.md)
* [변경 이력 (CHANGELOG.md)](../../CHANGELOG.md)


