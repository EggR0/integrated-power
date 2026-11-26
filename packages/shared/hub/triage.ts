/**
 * Shared triage logic for Hub Todos, Privacy, Categorization, and Ambiguity Evaluation.
 *
 * Pure TypeScript with zero external dependencies.
 */

import {
  LifeDomain,
  PrivacyTier,
  ClarificationQuestion,
  CategoryPlaybook,
  HubTodoStatus,
  HubTodoItem,
  TodoOriginChannel,
} from "./types";

export interface DomainPrivacyClassification {
  domain: LifeDomain;
  privacyTier: PrivacyTier;
}

export interface AmbiguityEvaluationResult {
  ambiguityScore: number;
  needsClarification: boolean;
  questions: ClarificationQuestion[];
}

/**
 * Classifies a task's life domain and assigned privacy tier.
 * Strict privacy safety: Personal health/tax/finance always defaults to strictly_local.
 */
export function classifyDomainAndPrivacy(text: string): DomainPrivacyClassification {
  const lower = text.toLowerCase();

  // 1. Private Domain: Medical, health, tax, banking, finance, personal credentials
  const privateKeywords = [
    "병원", "검진", "증상", "건강", "세금", "계좌", "급여", "대출",
    "연말정산", "보험", "의사", "진료", "처방", "약국", "통장", "예금",
    "medical", "tax", "bank", "salary", "health", "doctor", "clinic",
    "#private", "[private]",
  ];
  if (privateKeywords.some((k) => lower.includes(k))) {
    return { domain: "private", privacyTier: "strictly_local" };
  }

  // 2. Relations Domain: Family, friends, gifts, birthdays, weddings, personal appointments
  const relationsKeywords = [
    "가족", "부모님", "친구", "선물", "약속", "생일", "결혼", "기념일",
    "청첩장", "부모", "조카", "형제", "자매", "동창", "지인",
    "family", "friend", "gift", "birthday", "wedding", "anniversary",
    "#relations", "[relations]",
  ];
  if (relationsKeywords.some((k) => lower.includes(k))) {
    return { domain: "relations", privacyTier: "redacted_cloud" };
  }

  // 3. Incubate Domain: Side-projects, indie monetization, ideas, launch, youtube, mvp
  const incubateKeywords = [
    "수익", "사이드", "아이디어", "출시", "취미", "유튜브", "앱 출시", "mvp",
    "monetize", "indie", "side-project", "sideproject", "startup", "창업",
    "애드센스", "스폰서", "#incubate", "[incubate]",
  ];
  if (incubateKeywords.some((k) => lower.includes(k))) {
    return { domain: "incubate", privacyTier: "private_cloud" };
  }

  // 4. Collab Domain: Collaboration, team sharing, code reviews, clients, outsourcing, PRs
  const collabKeywords = [
    "협업", "팀", "공유", "리뷰 요청", "클라이언트", "외주", "pr", "pull request",
    "team", "client", "collab", "회의", "미팅", "고객사", "파트너",
    "#collab", "[collab]",
  ];
  if (collabKeywords.some((k) => lower.includes(k))) {
    return { domain: "collab", privacyTier: "workspace_scoped" };
  }

  // 5. Core Domain: Default system & daily execution
  return { domain: "core", privacyTier: "private_cloud" };
}

/**
 * Infers category from raw task text.
 */
export function inferCategory(text: string): string {
  const lower = text.toLowerCase();

  // Purchasing: groceries, buying, shopping, coupons, discounts
  if (/(장보기|구매|사기|살 것|쇼핑|쿠폰|할인|마트|식료품|주문|결제|buy|purchase|shop)/i.test(lower)) {
    return "purchasing";
  }

  // Hardware trade: used items, parts, gpu, dragonball assembly, sale/disposal
  if (/(중고|부품|그래픽카드|드래곤볼|처분|당근|중고나라|번개장터|cpu|gpu|ram|ssd|메인보드|하드웨어)/i.test(lower)) {
    return "hardware-trade";
  }

  // Home ops: organizing, cleaning, storage, recycling, maintenance
  if (/(집 정리|정리|청소|수납|분리수거|빨래|세탁|청소기|가구|청소용품|환기)/i.test(lower)) {
    return "home-ops";
  }

  // Coding: code, dev, bug, refactor, build, implementation
  if (/(code|dev|bug|refactor|build|test|git|구현|개발|버그|수정|빌드|배포|컴포넌트|엔진|서버)/i.test(lower)) {
    return "coding";
  }

  // Research: study, comparison, paper, analysis, research
  if (/(조사|비교|논문|분석|리서치|동향|검토|벤치마크|research|study|benchmark|analysis)/i.test(lower)) {
    return "research";
  }

  return "general";
}

/**
 * Checks if the task explicitly includes `#agya` or `[agya]` to opt-in to manual credit.
 */
export function hasExplicitManualCreditOptIn(text: string): boolean {
  return /#agya\b/i.test(text) || /\[agya\]/i.test(text);
}

/**
 * Calculates a basic urgency score (0.0 to 1.0).
 */
export function calculateUrgency(text: string): number {
  const lower = text.toLowerCase();
  if (/(급함|긴급|당장|asap|urgent|즉시|오늘 중|빨리)/i.test(lower)) {
    return 0.9;
  }
  if (/(오늘|today|금일)/i.test(lower)) {
    return 0.75;
  }
  if (/(내일|주말|이번주|tomorrow)/i.test(lower)) {
    return 0.55;
  }
  return 0.35;
}

/**
 * Generates initial clarification questions tailored to category and playbook hints.
 */
function generateCategoryQuestions(
  category: string,
  rawText: string,
  playbook?: CategoryPlaybook
): ClarificationQuestion[] {
  const semanticHint = playbook?.semantic && playbook.semantic.length > 0
    ? ` (기록된 선호: ${playbook.semantic.map((s) => s.preference).slice(0, 2).join(", ")})`
    : "";

  const proceduralHint = playbook?.procedural && playbook.procedural.length > 0
    ? ` (플레이북 규칙: ${playbook.procedural.map((p) => p.rule).slice(0, 2).join(", ")})`
    : "";

  switch (category) {
    case "purchasing":
      return [
        {
          id: "q-purchasing-target",
          question: `구입하고자 하는 주요 품목군과 필수 품목은 무엇인가요?${semanticHint}`,
          options: ["식료품·생필품", "철물·공구·전자", "패션·잡화", "도서·학습", "기타"],
        },
        {
          id: "q-purchasing-budget",
          question: `선호 사양, 수량 및 예산/할인 쿠폰 기준이 있으신가요?${proceduralHint}`,
          options: ["최저가 우선", "빠른 배송 우선", "품질/브랜드 우선", "예산 내 자유 선택"],
        },
      ];

    case "hardware-trade":
      return [
        {
          id: "q-hardware-spec",
          question: `거래 대상 부품/기기의 상세 모델명과 상태(신품, 중고, 미개봉 등)는 무엇인가요?${semanticHint}`,
          options: ["미개봉 신품", "정상 중고", "단순 개봉", "하자/부품용"],
        },
        {
          id: "q-hardware-trade-method",
          question: `희망 목표 가격 및 거래 방식(직거래 지역, 택배 거래)을 알려주세요.${proceduralHint}`,
          options: ["직거래 우선", "택배 거래 안전결제", "상관없음"],
        },
      ];

    case "home-ops":
      return [
        {
          id: "q-home-target",
          question: `정리 또는 청소를 진행할 구체적인 공간과 작업 범위는 어디인가요?${semanticHint}`,
          options: ["주방/식기", "침실/옷방", "거실/수납장", "베란다/창고", "전체"],
        },
        {
          id: "q-home-priority",
          question: `단순 정리, 수납 재배치, 분리수거/폐기 중 우선 처리할 작업은 무엇인가요?${proceduralHint}`,
          options: ["불필요 물품 폐기/배출", "수납함 재배치", "바닥 및 표면 청소"],
        },
      ];

    case "coding":
      return [
        {
          id: "q-coding-target",
          question: `수정 또는 구현할 대상 파일, 컴포넌트, 혹은 이슈는 무엇인가요?${semanticHint}`,
        },
        {
          id: "q-coding-criteria",
          question: `기대하는 최종 동작이나 테스트 검증 기준(통과 조건)은 무엇인가요?${proceduralHint}`,
        },
      ];

    case "research":
      return [
        {
          id: "q-research-topic",
          question: `조사하고자 하는 핵심 주제나 비교 대상 후보군은 무엇인가요?${semanticHint}`,
        },
        {
          id: "q-research-criteria",
          question: `조사 결과에 반드시 포함되어야 할 평가 기준(비용, 성능, 신뢰성 등)은 무엇인가요?${proceduralHint}`,
        },
      ];

    default:
      return [
        {
          id: "q-general-goal",
          question: `해당 작업의 구체적인 목표와 완료 기준은 무엇인가요?${semanticHint}`,
        },
        {
          id: "q-general-constraints",
          question: `작업 진행 시 참고해야 할 제약 사항이나 기한이 있나요?${proceduralHint}`,
        },
      ];
  }
}

/**
 * Evaluates the ambiguity of a task, generating or updating clarification questions.
 *
 * Scoring logic:
 * - Ultra-short (<12 chars without concrete target) -> ambiguityScore >= 0.70 (needsClarification: true)
 * - Questions generated tailored to Korean context and category playbook.
 * - Answers reduce ambiguityScore; if answer is ultra-terse (<= 2 chars), asks 1 follow-up question.
 * - When sufficient detail is provided, ambiguity drops < 0.40 (needsClarification: false).
 */
export function evaluateAmbiguity(
  text: string,
  answers: ClarificationQuestion[] = [],
  playbook?: CategoryPlaybook
): AmbiguityEvaluationResult {
  const trimmed = text.trim();
  const category = inferCategory(trimmed);

  // 1. Calculate Base Ambiguity Score
  let baseScore = 0.5;

  // Ultra-short or underspecified commands
  const isUltraShort = trimmed.length < 12;
  const isVagueActionOnly = /^(장보기|부품 구매|집 정리|청소|쇼핑|할일|정리|공부|개발|조사)$/i.test(trimmed);

  if (isVagueActionOnly || (isUltraShort && !/\d/.test(trimmed))) {
    baseScore = 0.85;
  } else if (trimmed.length < 20) {
    baseScore = 0.75;
  } else if (trimmed.length < 40) {
    // Check if it has specific criteria like numbers, dates, urls, or brackets
    const hasSpec = /\d+|https?:\/\/|\[.+\]|#|\b(원|만원|개|대|월|일)\b/.test(trimmed);
    baseScore = hasSpec ? 0.45 : 0.65;
  } else {
    // Lengthy description (> 40 chars)
    const hasSpec = /\d+|https?:\/\/|\[.+\]|#/.test(trimmed);
    baseScore = hasSpec ? 0.25 : 0.38;
  }

  // 2. Prepare or merge questions
  let questions: ClarificationQuestion[] = [];

  if (answers && answers.length > 0) {
    // Use existing questions list as base
    questions = answers.map((q) => ({ ...q }));
  } else if (baseScore >= 0.7) {
    // Generate fresh questions for vague items
    questions = generateCategoryQuestions(category, trimmed, playbook);
  }

  // 3. Evaluate provided answers
  let reduction = 0;
  let hasUltraTerseAnswer = false;

  for (const q of questions) {
    if (q.answer && q.answer.trim().length > 0) {
      const ansTrimmed = q.answer.trim();
      if (ansTrimmed.length <= 2) {
        // Ultra-terse answer (e.g. "ㅇㅇ", "응", "마트", "쿠팡")
        reduction += 0.12;
        hasUltraTerseAnswer = true;
      } else if (ansTrimmed.length <= 8) {
        reduction += 0.25;
      } else {
        // Substantive answer
        reduction += 0.38;
      }
    }
  }

  let finalScore = Math.max(0, Math.min(1, baseScore - reduction));

  // If ultra-terse answer was given and ambiguity is still high, append 1 follow-up question if not present
  if (hasUltraTerseAnswer && finalScore >= 0.4) {
    const hasFollowUp = questions.some((q) => q.id.startsWith("q-followup"));
    if (!hasFollowUp) {
      questions.push({
        id: "q-followup-terse",
        question: "답변이 매우 간결합니다. 원활한 대행을 위해 세부 규격, 선호 브랜드, 또는 최대 예산을 조금만 더 보충해 주시겠어요?",
      });
      // Slightly raise ambiguity since clarification is still needed
      finalScore = Math.min(1, finalScore + 0.1);
    }
  }

  const needsClarification = finalScore >= 0.4;

  return {
    ambiguityScore: Number(finalScore.toFixed(2)),
    needsClarification,
    questions,
  };
}

/**
 * Creates or triages a complete HubTodoItem from raw text and optional answers/playbook.
 */
export function triageTodoItem(
  id: string,
  blockId: string,
  rawText: string,
  options?: {
    originChannel?: TodoOriginChannel;
    answers?: ClarificationQuestion[];
    playbook?: CategoryPlaybook;
    existingStatus?: HubTodoStatus;
  }
): HubTodoItem {
  const { domain, privacyTier } = classifyDomainAndPrivacy(rawText);
  const category = inferCategory(rawText);
  const urgencyScore = calculateUrgency(rawText);
  const allowManualCredit = hasExplicitManualCreditOptIn(rawText);
  const ambiguityResult = evaluateAmbiguity(rawText, options?.answers, options?.playbook);

  let status: HubTodoStatus = options?.existingStatus || "ready";
  if (status !== "done" && status !== "in_progress" && status !== "awaiting_approval") {
    status = ambiguityResult.needsClarification ? "needs_clarification" : "ready";
  }

  const now = new Date().toISOString();

  // Extract a clean title (first line or up to 60 characters)
  const title = rawText.split("\n")[0].trim().substring(0, 80);

  return {
    id,
    blockId,
    title,
    rawText,
    status,
    domain,
    privacyTier,
    category,
    urgencyScore,
    ambiguityScore: ambiguityResult.ambiguityScore,
    clarificationQuestions: ambiguityResult.questions,
    contextNotes: [],
    allowManualCredit,
    originChannel: options?.originChannel || "dashboard",
    createdAt: now,
    updatedAt: now,
  };
}
