# 사이드바 UI 바깥 튀어나감(Horizontal Overflow) 방지 지침

이 문서는 Antigravity IDE 및 VS Code 사이드바 환경에서 발생하는 UI 요소의 화면 바깥 튀어나감(Horizontal Overflow), 텍스트 줄바꿈 깨짐, 비대상 섹션 오표시 문제를 원천 방지하기 위한 강제 규칙입니다.

---

## 1. 문제 배경 및 발생 원인

IDE의 사이드바/웹뷰 패널은 사용자의 에디터 레이아웃에 따라 **160px 미만의 극단적인 좁은 폭**으로 축소될 수 있습니다.

### 대표적인 장애 패턴
1. **헤더 내 중복 고정 텍스트 라벨 배치**:
   - `<h3>Gemini</h3>` 옆에 `<span class="prewarm-inline-label">⚡ Pre-warm:</span>`과 3개 모드 버튼(`[ Click | Once | Always ]`)을 함께 배치하면 전체 필요 너비가 250px를 초과함.
   - 폭이 좁은 사이드바에서 `⚡ Pre-warm:`이 강제로 3줄(`⚡\nPre-\nwarm:`)로 분할 줄바꿈되어 심각한 시각적 훼손 발생.
   - 나머지 버튼 그룹이 패널 오른쪽 테두리를 뚫고 바깥으로 튀어나가 잘림 (`Al|`).
2. **느슨한 그룹명 매칭 (`getPrewarmTargetForGroup`)**:
   - `title.includes("claude")`와 같은 단순 조건문으로 인해 5시간 롤링 대상이 아닌 `Claude (API & CLI)` 섹션에도 불필요한 프리웜 컨트롤이 강제 렌더링되어 공간 낭비 및 레이아웃 붕괴 유발.
3. **컨테이너 쿼리 미적용 / 버튼 고정 패딩**:
   - 버튼에 고정 `padding: 2px 7px`, `font-size: 11px` 등이 적용되어 초소형 너비에서 flex 아이템들이 컨테이너를 강제 확장함.

---

## 2. UI 개발 및 수정 시 절대 준수 규칙 (Directives)

### 원칙 1: 초소형 사이드바 폭 (< 160px) 기준 오버플로우 Zero 보장
- 웹뷰의 모든 최상위 및 중첩 컨테이너는 `min-width: 0; max-width: 100%; box-sizing: border-box;`를 기본으로 유지해야 합니다.
- 가로 스크롤바가 생기거나 요소가 오른쪽 경계선 밖으로 잘려 나가는 현상은 절대 허용되지 않습니다.

### 원칙 2: 3단계 반응형 텍스트 구조 (.text-full / .text-medium / .text-short) 필수 적용
모든 버튼 라벨, 제목, 상태 배지에는 컨테이너 너비에 따라 반응하는 3단계 축약 클래스를 필수 적용합니다:
```html
<button class="prewarm-mode-btn">
  <span class="text-full">Click</span>
  <span class="text-medium">Click</span>
  <span class="text-short">Clk</span>
</button>
<button class="prewarm-mode-btn">
  <span class="text-full">Once</span>
  <span class="text-medium">Once</span>
  <span class="text-short">1x</span>
</button>
<button class="prewarm-mode-btn">
  <span class="text-full">Always</span>
  <span class="text-medium">Always</span>
  <span class="text-short">Alw</span>
</button>
```

### 원칙 3: 헤더 행 고정 텍스트 라벨 금지 (미니 아이콘 + 툴팁 기반)
- 그룹 헤더 행에는 긴 텍스트 라벨(`⚡ Pre-warm:`)을 두지 마십시오.
- 기능 명시는 직관적인 1자 기호(예: `⚡`)와 상위 컨테이너의 `title`, `aria-label` 툴팁으로 완전하게 대체합니다.
- 버튼 자체의 툴팁에 상세 동작(예: `Click: 수동 실행만 허용`, `Once: 1회 자동`, `Always: 상시 자동`)을 기술합니다.

### 원칙 4: 모델 그룹 타겟 매핑의 엄격한 화이트리스트 검증
- 기능 제어 컨트롤(예: 프리웜)은 실제 지원 대상 그룹에만 한정 렌더링되어야 합니다.
- `api`, `cli`, `gpu`, `hardware` 등 롤링 윈도우가 아닌 대상은 반드시 선제 제외(`return undefined`)합니다:
```javascript
function getPrewarmTargetForGroup(title) {
  const t = (title || "").toLowerCase().trim();
  if (t.includes("api") || t.includes("cli")) return undefined;
  if (t.includes("gemini") || t === "antigravity") return "antigravity";
  if (t === "claude" || t.includes("opus")) return "opus";
  if (t.includes("chatgpt") || t.includes("codex") || t === "openai") return "codex";
  return undefined;
}
```

### 원칙 5: CSS Container Queries를 통한 초소형 모드 최적화
- `@container (max-width: 290px)` 및 `@container (max-width: 215px)` 브레이크포인트에서 폰트 크기, 버튼 내부 여백, 그리드 간격을 단계적으로 감축합니다:
```css
@container (max-width: 215px) {
  .capacity-group-header {
    gap: 3px;
    margin-bottom: 4px;
  }
  .prewarm-inline-control {
    gap: 2px;
  }
  .prewarm-icon {
    font-size: 9px;
  }
  .prewarm-mode-options {
    gap: 1px;
    padding: 1px;
  }
  .prewarm-mode-btn {
    font-size: 9.5px;
    padding: 1px 3px;
    letter-spacing: -0.2px;
  }
  .prewarm-btn {
    font-size: 9.5px;
    padding: 1px 4px;
  }
}
```

---

## 3. 검증 및 배포 게이트 (Verification Gate)

UI 관련 코드를 수정하거나 기능을 추가한 뒤에는 반드시 다음 절차를 통과해야 합니다:

1. **자동화 회귀 테스트 실행**:
   ```bash
   node ./vscode-extension/scripts/test-compact-ui.js
   ```
   - 비대상 그룹(Claude API & CLI 등)에 잘못된 컨트롤이 붙지 않는지 검증.
   - 오버플로우를 유발하는 고정 라벨이 제거되었는지 검증.
   - 초소형 모드용 텍스트 토큰(`Clk`, `1x`, `Alw`)이 정상 포함되어 있는지 검증.
2. **사이드바 최소 폭 시각 검증**:
   - Antigravity IDE에서 사이드바를 잡고 좌측으로 끝까지 밀어 최소 너비(~160px)로 설정했을 때, 모든 카드가 잘림 없이 깔끔하게 한눈에 보이는지 확인할 것.
