# Integrated Power 멀티 티어 스토리지 연동 가이드

Integrated Power는 로컬 연산 자원과 클라우드를 유기적으로 결합하여, 사용자가 원하는 저장 수단을 유연하게 선택하고 연결할 수 있는 **3계층 스토리지 아키텍처(Tiered Storage Architecture)**를 제공합니다.

---

## 1. 3대 저장 수단 개요 및 역할

| 계층 (Tier) | 지원 저장 수단 | 주요 용도 | 설정 필요 여부 |
| :--- | :--- | :--- | :--- |
| **Tier 1 (로컬)** | **로컬 암호화 원장 (SQLite / JSONL)** | 브로커 태스크 큐, 이벤트 감사 원장, Quota/토큰 상태 | **기본 탑재 (설정 불필요)** |
| **Tier 2 (클라우드)** | **Google Drive (개인 계정 / Google One)** | 모바일/웹 메모 원천 인입 (Inbox), 대용량 산출물 오프로드 (VSIX, 영상) | **선택 연동 (약 3분 소요)** |
| **Tier 3 (지식)** | **GitHub 기반 Obsidian Vault (eggr-knowledge)** | 정제된 기술 지식, 아키텍처 결정(ADR), 마크다운 링크 그래프 | **선택 연동** |

---

## 2. 사용자가 각자의 구글 드라이브를 연결하는 방법

개인 무료 Google 계정(15GB)부터 Google One(100GB, 2TB, 5TB)까지 모든 구글 계정을 브로커에 2차 클라우드 저장소로 연결할 수 있습니다.

### 초간단 3단계 연결 절차

1. **OAuth 키 발급**:
   - [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만들고, **Google Drive API** 활성화 후 **데스크톱 앱(Desktop app)** OAuth 2.0 클라이언트 ID를 생성합니다.
   - 다운로드한 JSON 파일을 `%USERPROFILE%\.config\google-drive-mcp\gcp-oauth.keys.json` (macOS/Linux: `~/.config/google-drive-mcp/gcp-oauth.keys.json`)으로 저장합니다.
2. **브라우저 1회 인증**:
   - 터미널에서 아래 명령어를 실행하면 브라우저가 열립니다:
     ```powershell
     node scripts/setup-gdrive-mcp.js --auth
     ```
   - 연동할 본인 구글 계정으로 로그인하고 권한을 허용하면 인증 토큰이 안전하게 로컬에 저장됩니다.
3. **MCP 클라이언트 등록**:
   - `%USERPROFILE%\.gemini\config\mcp_config.json`에 `gdrive` 엔트리를 등록하면 Antigravity IDE, Claude Desktop, IPCC 데스크톱 등에서 내 드라이브 파일 검색과 아티팩트 오프로드가 즉시 활성화됩니다.

> 📖 **자세한 스크린샷 및 단계별 매뉴얼**: [Google Drive MCP 연동 상세 가이드 바로가기](google-drive-mcp-setup.ko.md)

---

## 3. 다른 저장 수단과의 연동 및 확장

### A. 로컬 전용 모드 (No Cloud)
- 클라우드 계정을 연결하지 않아도 Integrated Power의 모든 코어 기능(로컬 LLM 쿼타 관리, 프리웜, GPU 모니터링, 태스크 브로커)은 **100% 로컬 오프라인**으로 완벽하게 동작합니다.
- 아티팩트와 원장은 로컬 디렉터리(`%LOCALAPPDATA%\IntegratedPower\state` / `~/.local/share/IntegratedPower/state`)에 안전하게 저장됩니다.

### B. GitHub 지식 저장소 (Obsidian Vault) 연동
- 사용자가 Obsidian 마크다운 노트를 GitHub 리포지토리(`eggr-knowledge`)로 관리하는 경우:
  - 브로커의 `DriveKnowledgeDistillationBridge`가 대용량 바이너리(빌드 파일, 녹화 영상)는 Google Drive 5TB에 보관하고,
  - 핵심 요약 지식만 가벼운 Markdown 문서로 변환하여 Obsidian Vault(`D:\obsidian\00 Inbox\`)로 자동 내보냅니다.
  - 이를 통해 Git 저장소 용량 제한(100MB)을 초과하지 않고도 영구적인 지식 그래프를 유지할 수 있습니다.

### C. 향후 확장 로드맵 (S3 / WebDAV / Nextcloud)
- 브로커의 스토리지 인터페이스는 추상화되어 있어, 차기 릴리스에서 AWS S3 / Cloudflare R2 / MinIO 호환 오브젝트 스토리지 및 WebDAV/Nextcloud 어댑터를 플러그인 형태로 추가 장착할 수 있도록 설계되었습니다.
