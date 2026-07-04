# Google Calendar Integration Setup (gcalcli)

이 워크스페이스는 `gcalcli` (Google Calendar Command Line Interface)를 사용하여 사용자의 캘린더 일정을 읽어오고, 빈 시간에 맞춰 AI 작업을 예약합니다. 최초 1회, 사용자의 구글 계정에 접근하기 위한 OAuth 인증 설정이 필요합니다.

## 1. 구글 클라우드 콘솔 프로젝트 생성 및 API 활성화
1. [Google Cloud Console](https://console.cloud.google.com/)에 접속합니다.
2. 새 프로젝트를 생성합니다 (예: `Antigravity-Calendar`).
3. 왼쪽 메뉴에서 **API 및 서비스(APIs & Services) > 라이브러리(Library)**로 이동합니다.
4. `Google Calendar API`를 검색하고 **사용(Enable)** 버튼을 클릭합니다.

## 2. OAuth 동의 화면 구성
1. **API 및 서비스 > OAuth 동의 화면(OAuth consent screen)**으로 이동합니다.
2. 사용자 유형을 **외부(External)**로 선택하고 만들기를 클릭합니다. (Google Workspace 사용자라면 내부(Internal) 선택 가능)
3. 필수 항목(앱 이름, 사용자 지원 이메일, 개발자 연락처 정보)을 입력하고 저장 후 계속합니다.
4. **테스트 사용자(Test users)** 단계에서 본인의 구글 이메일 주소를 추가합니다.

## 3. 사용자 인증 정보(Credentials) 생성
1. **API 및 서비스 > 사용자 인증 정보(Credentials)**로 이동합니다.
2. **사용자 인증 정보 만들기(Create Credentials) > OAuth 클라이언트 ID(OAuth client ID)**를 클릭합니다.
3. 애플리케이션 유형을 **데스크톱 앱(Desktop app)**으로 선택합니다.
4. 이름을 입력하고 **만들기(Create)**를 클릭합니다.
5. 생성된 클라이언트 ID 화면에서 **JSON 다운로드** 버튼을 눌러 파일을 다운로드하고, 파일명을 `client_secret.json`으로 변경합니다.

## 4. gcalcli 설치 및 최초 인증
1. 터미널에서 `gcalcli`를 설치합니다:
   ```powershell
   pip install gcalcli
   ```
2. 다운로드 받은 `client_secret.json` 파일을 열어 `client_id`와 `client_secret` 값을 복사합니다.
3. 터미널에서 다음 명령어를 실행하여 최초 브라우저 인증을 수행합니다. (실행 시 웹 브라우저가 열리며 구글 로그인 화면이 나타납니다)
   ```powershell
   gcalcli --client-id="당신의_client_id" --client-secret="당신의_client_secret" agenda
   ```
4. 브라우저에서 '계속'을 눌러 권한을 허용하면 인증이 완료됩니다. 이후부터는 인증 없이 자동으로 연동됩니다.
