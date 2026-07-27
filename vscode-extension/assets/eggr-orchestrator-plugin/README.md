# EggR Orchestrator Plugin

Antigravity IDE에서 현재 에이전트 직접 처리, Codex 위임, 하드웨어에 맞는
로컬 LLM 전처리 경로를 선택하는 EggR 플러그인입니다.

## 설치

1. 권장: Antigravity IDE의 `EggR: Open Configuration Center`에서
   Orchestrator 설정을 저장하고 플러그인을 설치합니다.
2. 수동 설치: 이 폴더를
   `~/.gemini/config/plugins/eggr-orchestrator-plugin/`에 복사합니다.
3. 독립 설정: `install/Install-Plugin.ps1`을 실행합니다.

설정은 기본적으로 `~/.config/eggr/orchestrator.json`에 저장됩니다.
`EGGR_ORCHESTRATOR_SETTINGS` 환경변수로 다른 절대 경로를 지정할 수 있습니다.
이전 `~/.gemini/config/codex_plugin_settings.json`은 새 설정이 없을 때만
마이그레이션 입력으로 읽습니다.

## 전역 규칙 경계

이 플러그인은 `~/.gemini/GEMINI.md`를 생성하거나 수정하지 않습니다.
Antigravity IDE는 `plugin.json`과
`skills/eggr-orchestrator/SKILL.md`를 플러그인 경로에서 발견합니다. 라우팅
힌트는 플러그인 내부 `rules/`에 포함되므로 사용자의 전역 규칙과 분리됩니다.

## 안전한 갱신

- 새 플러그인은 임시 디렉터리에서 준비한 뒤 원자적으로 교체합니다.
- 기존 `eggr-orchestrator-plugin`과 이전 `codex-orchestrator-plugin`은
  `.eggr-backups/`로 이동한 후 새 버전을 설치합니다.
- URL에 API 키나 비밀번호를 넣지 않습니다. 비밀 값은 환경변수를 사용합니다.
- Dashboard 활성화만으로 플러그인이나 설정을 갱신하지 않습니다.
