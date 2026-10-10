# Integrated Power 통합 배포 및 릴리스 가이드

이 문서는 `Integrated Power`의 모든 구성 요소(VS Code / Antigravity IDE 확장 프로그램, GitHub Releases, Open VSX 마켓플레이스, 독립형 Tauri 관제 센터)를 안전하고 일관되게 빌드, 검증, 배포하기 위한 표준 절차와 자동화 파이프라인 명세입니다.

---

## 1. 배포 아키텍처 및 채널 개요

| 채널 | 대상 패키지 | 배포 방식 | 최신 식별자 / 위치 |
|---|---|---|---|
| **GitHub Releases** | `integrated-power-<version>.vsix` | GitHub CLI (`gh release create`) 수동/스크립트 배포 | [GitHub Releases](https://github.com/EggR0/integrated-power/releases) |
| **Open VSX Registry** | `EggR0.integrated-power` | GitHub Actions CI/CD (`.github/workflows/publish-openvsx.yml`) 완전 자동 | [open-vsx.org/extension/EggR0/integrated-power](https://open-vsx.org/extension/EggR0/integrated-power) |
| **Control Center** | Tauri GUI / Web Client | 메인 리포지토리 및 `integrated-power-control-center` 동기화 | [EggR0/integrated-power-control-center](https://github.com/EggR0/integrated-power-control-center) |

---

## 2. 배포 사전 검증 게이트 (Pre-Deployment Gates)

새 버전을 배포하기 전, 워크스페이스 루트(`d:\Workspace\Integrated POWER`)에서 아래 모든 검증이 **100% 무결점으로 통과**해야 합니다:

### 2.1 빌드 및 컴파일 검증
```powershell
# 1. 확장 런타임 번들 빌드
node ./vscode-extension/scripts/build-extension.js

# 2. TypeScript 컴파일 무결성 검사
npx tsc -p ./vscode-extension
```

### 2.2 테스트 스위트 실행
```powershell
# 코어 계산, 프리웜, 컴팩트 UI, 재사용 게이트 검증
node ./vscode-extension/scripts/test-quota-core.js
node ./vscode-extension/scripts/test-prewarm.js
node ./vscode-extension/scripts/test-compact-ui.js
node ./vscode-extension/scripts/run-reuse-gate.js

# 런타임 토큰, 안전 가드, 헤드리스 및 브로커 회귀 테스트
node ./vscode-extension/scripts/test-runtime-background-token.js
node ./vscode-extension/scripts/test-visual-graph-safety-guard.js
node ./vscode-extension/scripts/run-headless-tests.js
node ./vscode-extension/scripts/run-broker-tests.js
```

> ⚠️ **규칙**: 단 하나의 테스트라도 실패하거나 에러가 발생할 경우 릴리스를 중단하고 원인을 수정해야 합니다.

---

## 3. 버전 동기화 프로토콜 (Version Alignment Protocol)

새 버전(예: `0.9.5`)으로 업데이트 시, 프로젝트 전반의 버전 표기를 누락 없이 동기화해야 합니다.

### 동기화 대상 6대 핵심 영역
1. **확장 프로그램 매니페스트**:
   - `vscode-extension/package.json` → `"version": "0.9.5"`
2. **변경 이력 (CHANGELOG)**:
   - `vscode-extension/CHANGELOG.md` 및 `CHANGELOG.md` 상단에 새 버전 릴리스 노트를 동일하게 기재
3. **사용자 설명서 (README)**:
   - `README.md` 및 `vscode-extension/README.md`
     - 상단 GitHub Release 배지 URL
     - 빠른 시작의 VSIX 다운로드 링크 및 CLI 설치 명령어
     - 하단 메타데이터 사양표의 `현재 버전` 및 공개 마켓 링크
4. **Control Center (관제 센터)**:
   - `control-center/package.json` → `"version": "0.9.5"`
   - `control-center/src-tauri/tauri.conf.json` → `"version": "0.9.5"`
   - `control-center/index.html` → 사이드바 푸터(`broker-footer`) 및 하단 상태바(`statusbar`)의 버전 표기
   - `control-center/src/main.js` → 동적 푸터 렌더링 버전 문자열
5. **독립 관제 센터 저장소 동기화**:
   - 변경된 `control-center` 파일들을 `d:\Workspace\integrated-power-control-center`에 복사하고 커밋/푸시
6. **지원 문서 메타데이터**:
   - `SUPPORT.md` (기준 소스 manifest 및 검증된 VSIX 버전)
   - `docs/marketing/launch-plan.ko.md` (기준 버전 표기)

---

## 4. VSIX 패키징 절차 (VSIX Packaging)

패키징 시 가벼운 배포 크기(1MB 미만)를 유지하기 위해 `--no-dependencies` 플래그를 사용합니다:

```powershell
# vscode-extension 디렉터리로 이동하여 패키징
cd "d:\Workspace\Integrated POWER\vscode-extension"
npx @vscode/vsce package --no-dependencies

# 생성된 패키지를 루트 디렉터리로 복사 (설치 편의용)
Copy-Item ".\integrated-power-0.9.5.vsix" -Destination "..\integrated-power-0.9.5.vsix" -Force
```

---

## 5. Git 커밋 및 GitHub Release 배포

### 5.1 Git 커밋 및 원격 푸시
```powershell
cd "d:\Workspace\Integrated POWER"
git add .
git commit -m "feat: release v0.9.5 with 3-mode pre-warm, ui controls, and auth-guarded lowest capacity"
git push origin main
```

### 5.2 GitHub Release 생성 및 VSIX 첨부
GitHub CLI(`gh`)를 사용하여 릴리스 노트와 VSIX 파일을 첨부한 Release를 발행합니다:

```powershell
gh release create v0.9.5 .\vscode-extension\integrated-power-0.9.5.vsix `
  --title "Integrated Power 0.9.5" `
  --notes-file ".\reports\release-notes-v0.9.5.md"
```

---

## 6. Open VSX CI/CD 완전 자동 배포 파이프라인

GitHub Release가 생성되면, **GitHub Actions가 이를 자동으로 감지하여 Open VSX Registry로 패키지를 배포**합니다.

### 6.1 동작 구조 (`.github/workflows/publish-openvsx.yml`)
* **트리거**: `release: types: [published]` 및 `workflow_dispatch`
* **배포 단계**:
  1. `actions/checkout@v4`로 리포지토리 체크아웃.
  2. `gh release download`를 통해 Release에 첨부된 VSIX 에셋을 직접 확보 (재빌드로 인한 해시 불일치 방지 및 CI 실행 시간을 20초대로 단축).
  3. 에셋이 없는 경우 fallback으로 Node 24 + pnpm 11.9.0 환경에서 패키지를 즉시 소스로부터 빌드.
  4. **Trusted Publishing (OIDC) 및 PAT 2단계 인증**:
     - `npx ovsx publish --trusted-publishing --skip-duplicate` 우선 시도
     - 미지원 또는 실패 시 `OVSX_PAT` 시크릿을 통한 PAT 배포로 자동 폴백.
  5. **중복 배포 멱등성 보호 (`publish_target` 래퍼)**:
     - 이미 로컬에서 선행 배포되었거나 Open VSX 인덱싱 대기 중인 경우(`is already published`), ovsx CLI의 비정상 종료(Exit Code 1)를 감지하여 성공(Exit Code 0)으로 정상 수렴 처리.

### 6.2 수동 재실행 방법 (필요 시)
CLI 또는 GitHub Actions 웹 인터페이스에서 수동으로 워크플로우를 트리거할 수 있습니다:

```powershell
# 특정 태그의 VSIX를 Open VSX로 배포
gh workflow run publish-openvsx.yml -f tag=v0.9.8
```

---

## 7. 배포 후 상태 검증 및 모니터링 (Post-Deployment Verification)

배포 직후 다음 명령어를 통해 배포 상태를 점검합니다:

```powershell
# 1. GitHub Release 상태 및 첨부 파일 확인
gh release view v0.9.8

# 2. CI/CD 워크플로우 실행 로그 실시간 확인
gh run list --workflow=publish-openvsx.yml --limit 3
gh run view <RUN_ID>

# 3. Open VSX Registry 메타데이터 조회
npx ovsx show EggR0.integrated-power
```

---

## 8. 트러블슈팅 및 주의사항 (Known Gotchas)

1. **Open VSX 비동기 인덱싱 지연**:
   - `npx ovsx publish` 완료 직후에는 Open VSX 서버 내부에서 패키지 바이러스 검사, 매니페스트 파싱, CDN 캐시 무효화를 비동기로 처리하므로 **약 5~10분 후 정상 노출**됩니다.
2. **pnpm 11.9.0 + Node.js 24 환경 요구**:
   - 프로젝트에서 사용 중인 `pnpm 11.9.0`은 Node 22.13 이상(`node:sqlite` 내장 모듈)을 요구합니다.
   - GitHub Actions CI 러너 설정 시 반드시 `node-version: 24`를 지정해야 합니다 (Node 20 사용 시 모듈 로딩 에러 발생).
3. **PowerShell 인코딩 및 토큰 취급**:
   - `.ovsx-token`과 같은 민감 정보는 터미널에 평문으로 출력하지 않으며, Git 커밋에 포함되지 않도록 `.gitignore`에 등록되어 있습니다.
   - PowerShell 환경에서 파일 입출력 시 인코딩 손상을 방지하기 위해 네이티브 도구 또는 UTF-8 규격을 엄수합니다.
4. **이미 배포된 확장에 대한 ovsx CLI Exit Code 1 및 CI 실패 메일 방지**:
   - 로컬에서 수동 배포 후 GitHub Release를 만들면, Open VSX 서버가 `Extension ... is already published, but currently isn't active`를 반환하며 `ovsx`가 비정상 종료(Exit Code 1)를 반환할 수 있습니다.
   - 워크플로우 내 `publish_target` 래퍼가 이 상태를 정상적인 중복 회피로 감지하여 Exit Code 0으로 처리하므로, 배포가 잘 되었음에도 불필요한 'Run failed' 실패 알림 이메일이 발송되지 않습니다.
5. **GitHub Release 생성 시 VSIX 애셋 첨부 권장**:
   - `gh release create <tag> .\vscode-extension\integrated-power-<version>.vsix` 명령을 통해 VSIX 바이너리를 Release 애셋으로 첨부하십시오.
   - 애셋이 첨부되어 있으면 CI가 pnpm 의존성 다운로드와 TypeScript 컴파일 과정을 거치지 않고 검증된 VSIX를 20초 만에 바로 다운로드하여 Open VSX로 전송합니다.
