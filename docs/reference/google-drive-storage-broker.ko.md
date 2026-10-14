# Integrated Power Google Drive 스토리지 브로커 연동 규약

## 1. 개요 및 설계 목적

본 문서는 Integrated Power 브로커가 사용자의 5TB Google Drive 클라우드 저장소(사용자 Google 계정)를 로컬 연산 및 지식 파이프라인의 2차 스토리지 티어(Secondary Storage Tier)로 연동하는 아키텍처 및 구현 규약을 정의합니다.

- **Option B: Google Drive Inbox 인입 서비스 (`DriveIngestionService`)**: 모바일 및 웹 Gemini에서 작성되어 구글 드라이브로 내보내진 문서를 브로커 태스크(`TaskEnvelope`)로 무손실 자동 인입.
- **Option C: Google Drive 아티팩트 오프로더 (`DriveArtifactOffloader`)**: 로컬 SSD 용량을 절약하기 위해 대용량 산출물(VSIX, 브라우저 녹화 영상, 로그 등)을 Google Drive의 전용 아티팩트 폴더로 비동기 오프로딩.

---

## 2. 클라우드 디렉터리 구조

Google Drive 루트에 `IntegratedPower` 디렉터리가 생성되며, 아래 하위 구조로 격리 관리됩니다:

```text
Google Drive (5TB, User Account)
└── IntegratedPower/
    ├── Inbox/                  # 모바일/웹 Gemini 내보내기 문서 대기열
    │   └── processed/          # 브로커에 인입 완료된 문서 아카이브 (중복 방지)
    └── Artifacts/              # 태스크별 대용량 산출물 클라우드 보관소
        ├── task_001/
        │   ├── recording.webp
        │   └── build.vsix
        └── task_002/
```

---

## 3. Option B: 드라이브 인입 서비스 (`DriveIngestionService`)

### 3-1. 동작 메커니즘
1. **스캔**: `IntegratedPower/Inbox/` 폴더를 주기적으로 폴링하여 새 문서를 탐색합니다.
2. **변환**: 파일 제목과 텍스트 내용을 추출하여 표준 `CreateTaskInput` 규격으로 직렬화합니다:
   - `title`: `[Mobile/Drive Ingest] {fileName}`
   - `goal`: 문서 본문
   - `originProvider`: `google.antigravity.app`
   - `idempotencyKey`: `gdrive_inbox_{fileId}` (동일 파일 중복 생성 방지)
3. **태스크 등록**: `IntegratedPowerBroker.createTask()`를 호출하여 브로커 작업 큐에 등록합니다.
4. **아카이빙**: 등록이 완료된 문서는 `IntegratedPower/Inbox/processed/`로 원자적(Atomic) 이동하여 멱등성을 보장합니다.

---

## 4. Option C: 아티팩트 오프로더 (`DriveArtifactOffloader`)

### 4-1. 동작 메커니즘
1. **대상 식별**: 빌드 산출물(`.vsix`), 브라우저 녹화(`.webp`, `.mp4`), 대용량 실행 로그(`.log`)가 생성되면 오프로더를 호출합니다.
2. **원격 폴더 확보**: `IntegratedPower/Artifacts/{taskId}/` 폴더를 확인하거나 생성합니다.
3. **멀티파트 업로드**: 로컬 파일을 읽어 구글 드라이브 API v3의 멀티파트 업로드(`/upload/drive/v3/files?uploadType=multipart`)로 전송합니다.
4. **원장 메타데이터 갱신**: 업로드 완료 후 반환된 `fileId`, `webViewLink`, `sizeBytes`를 브로커 이벤트 원장(`EventLedger`)의 아티팩트 증거로 기록합니다.

---

## 5. 보안 및 토큰 관리 규약

1. **토큰 경로 격리**:
   - OAuth 키: `%USERPROFILE%\.config\google-drive-mcp\gcp-oauth.keys.json`
   - 크레덴셜 토큰: `%USERPROFILE%\.config\google-drive-mcp\.gdrive-server-credentials.json`
   - 워크스페이스 외부의 사용자 프로필 디렉터리에 머물며, Git 커밋에 절대 포함되지 않습니다.
2. **자동 토큰 갱신 (Auto Refresh)**:
   - `GoogleDriveAuth` 클래스가 토큰 만료 60초 전을 감지하여 `refresh_token`으로 Google OAuth2 토큰 엔드포인트를 호출, 무중단 통신을 유지합니다.
