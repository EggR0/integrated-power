# Google Drive MCP 연동 및 배포 가이드 (5TB 클라우드 스토리지 활용)

> 이 문서는 Antigravity IDE, Codex, Claude Desktop 등 MCP(Model Context Protocol) 클라이언트에서 개인 구글 드라이브(5TB Google One 계정 등)를 지식 및 저장소 원격지로 연결하기 위한 재현 가능한 단계별 설정 매뉴얼입니다.

---

## 1. 개요 및 준비 사항

- **목적**: 사용자의 Google Drive 계정을 MCP 서버(`@modelcontextprotocol/server-gdrive`)로 연결하여, 로컬 에이전트가 5TB 대용량 저장소의 파일 검색, 문서 인출, 지식 참조를 수행할 수 있도록 구성합니다.
- **필수 환경**:
  - Node.js 18+ 및 `npx` (설치 확인: `node -v`, `npx -v`)
  - Google Cloud Console에 접근 가능한 Google 계정

---

## 2. 1단계: Google Cloud Console에서 OAuth 클라이언트 생성 (소요시간: 약 3분)

개인 Google Drive 데이터에 안전하게 접근하기 위해 본인 소유의 데스크톱 앱용 OAuth 2.0 클라이언트 ID를 발급받아야 합니다.

1. **Google Cloud Console 접속**:
   - [Google Cloud Console](https://console.cloud.google.com/)에 로그인합니다.
2. **새 프로젝트 생성**:
   - 상단 프로젝트 선택 드롭다운 클릭 -> **[새 프로젝트]** 클릭 -> 프로젝트 이름(예: `IntegratedPower-Drive`) 입력 후 **[만들기]**.
3. **Google Drive API 활성화**:
   - 좌측 메뉴 -> **[API 및 서비스]** -> **[라이브러리]**로 이동합니다.
   - 검색창에 `Google Drive API` 검색 -> **Google Drive API** 선택 -> **[사용]** 버튼 클릭.
4. **OAuth 동의 화면 구성**:
   - 좌측 메뉴 -> **[API 및 서비스]** -> **[OAuth 동의 화면]**.
   - User Type: **외부(External)** 선택 후 **[만들기]** 클릭.
   - 앱 정보:
     - 앱 이름: `Integrated Power Drive MCP`
     - 사용자 지원 이메일: 본인 이메일 (예: `your-email@gmail.com`)
     - 개발자 연락처 정보: 본인 이메일 입력 후 **[저장 후 계속]**.
   - 범위(Scopes):
     - **[범위 추가 또는 삭제]** 클릭 -> `.../auth/drive.readonly` (또는 필요시 Drive 전체) 선택 후 **[업데이트]** -> **[저장 후 계속]**.
   - 테스트 사용자(Test Users):
     - **[+ ADD USERS]** 클릭 -> 연동할 본인 이메일(예: `your-email@gmail.com`)을 반드시 추가합니다. -> **[저장 후 계속]**.
5. **OAuth 2.0 클라이언트 ID 생성 및 다운로드**:
   - 좌측 메뉴 -> **[사용자 인증 정보]** -> 상단 **[+ 사용자 인증 정보 만들기]** -> **[OAuth 클라이언트 ID]** 선택.
   - 애플리케이션 유형: **데스크톱 앱(Desktop app)** 선택.
   - 이름: `Drive MCP Desktop Client` 입력 후 **[만들기]**.
   - 생성 완료 창에서 **[JSON 다운로드]**를 클릭하여 키 파일을 PC에 저장합니다.

---

## 3. 2단계: 키 파일 배치 및 디렉터리 준비

다운로드한 JSON 파일의 이름을 **`gcp-oauth.keys.json`**으로 변경하고, 아래 경로에 배치합니다.

- **설정 디렉터리**:
  ```text
  Windows: C:\Users\<사용자명>\.config\google-drive-mcp\
  macOS/Linux: ~/.config/google-drive-mcp/
  ```
- **최종 키 파일 경로**:
  ```text
  Windows: C:\Users\<사용자명>\.config\google-drive-mcp\gcp-oauth.keys.json
  macOS/Linux: ~/.config/google-drive-mcp/gcp-oauth.keys.json
  ```

> **상태 점검 명령어**:
> ```powershell
> node scripts/setup-gdrive-mcp.js
> ```
> 정상 배치 시 `OAuth Key File: [OK]` 상태로 표시됩니다.

---

## 4. 3단계: 브라우저 인증 실행 및 토큰 발급

1. 터미널(또는 PowerShell)에서 다음 명령어를 실행합니다:
   ```powershell
   node scripts/setup-gdrive-mcp.js --auth
   ```
2. 자동으로 시스템 기본 브라우저가 열리고 Google 로그인 화면이 나타납니다.
3. 연동할 본인 계정을 선택하고 로그인합니다.
4. *"Google에서 확인하지 않은 앱"* 경고 화면이 나타나면:
   - 좌측 하단의 **[고급(Advanced)]** 클릭 -> **`...으로 이동(안전하지 않음)`** 클릭 (본인이 만든 개인 테스트용 앱이므로 정상입니다).
5. 권한 요청 화면에서 **[계속]** 또는 **[허용]**을 클릭합니다.
6. 완료되면 브라우저에 인증 성공 메시지가 뜨고, 로컬에 토큰 파일이 저장됩니다:
   ```text
   Windows: C:\Users\<사용자명>\.config\google-drive-mcp\.gdrive-server-credentials.json
   macOS/Linux: ~/.config/google-drive-mcp/.gdrive-server-credentials.json
   ```

---

## 5. 4단계: Antigravity IDE (또는 MCP 클라이언트) 등록

### Antigravity IDE 전역 등록
설정 파일: `%USERPROFILE%\.gemini\config\mcp_config.json` (macOS/Linux: `~/.gemini/config/mcp_config.json`)

`mcpServers` 객체 내부에 아래 설정을 추가합니다:

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-gdrive"
      ],
      "env": {
        "GDRIVE_OAUTH_PATH": "C:\\Users\\<사용자명>\\.config\\google-drive-mcp\\gcp-oauth.keys.json",
        "GDRIVE_CREDENTIALS_PATH": "C:\\Users\\<사용자명>\\.config\\google-drive-mcp\\.gdrive-server-credentials.json"
      }
    }
  }
}
```

> **중요 (Windows 경로 주의점)**:
> `@modelcontextprotocol/server-gdrive`는 기본 경로 결합 시 Windows에서 `D:\C:\...` 형태의 경로 오류를 일으키는 버그가 있습니다. 위와 같이 `GDRIVE_OAUTH_PATH`와 `GDRIVE_CREDENTIALS_PATH` 환경변수를 반드시 명시적으로 설정해야 오류 없이 안정적으로 구동됩니다.

---

## 6. 5단계: 연결 검증 및 사용법

1. Antigravity IDE(또는 지원 클라이언트)를 재시작합니다.
2. 에이전트 채팅창에서 구글 드라이브 검색을 요청합니다:
   > *"내 구글 드라이브에서 'Integrated Power' 관련 문서를 찾아줘"*
3. 에이전트가 `gdrive.search` 툴을 호출하여 5TB 저장소 내의 파일 목록(`name`, `mimeType` 등)을 반환합니다.

---

## 7. 문제 해결 (Troubleshooting)

| 현상 | 원인 | 해결 방법 |
| :--- | :--- | :--- |
| `Cannot find module 'D:\C:\...'` | Windows 드라이브 문자 결합 결함 | `mcp_config.json`의 `env`에 `GDRIVE_OAUTH_PATH`, `GDRIVE_CREDENTIALS_PATH` 절대 경로를 명시 |
| `Access blocked: app has not completed verification` | OAuth 동의 화면 테스트 사용자 누락 | Cloud Console의 **OAuth 동의 화면** -> **Test users**에 본인 Google 계정 추가 |
| `Credentials not found. Please run with 'auth'` | 최초 로그인 토큰 미발급 | `node scripts/setup-gdrive-mcp.js --auth` 실행하여 브라우저 로그인 완료 |
