import * as vscode from "vscode";
import { TokenStatus } from "./types";

export interface QuotaNotificationTarget {
  id: string;
  configKey: string;
  model: string;
  window: "5Hours" | "Weekly";
  title: string;
  message: string;
  getPercentage: (status: TokenStatus) => number | undefined;
}

export const QUOTA_NOTIFICATION_TARGETS: QuotaNotificationTarget[] = [
  // 1 & 2: Antigravity IDE Gemini (5h, Weekly)
  {
    id: "antigravity-gemini-5h",
    configKey: "notifications.antigravityGemini5h",
    model: "Antigravity Gemini",
    window: "5Hours",
    title: "Antigravity IDE Gemini (5시간)",
    message: "Antigravity IDE Gemini 5시간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.antigravityPercentage === "number") return s.antigravityPercentage;
      if (s.antigravityMax > 0 && typeof s.antigravityTokensLeft === "number") {
        return (s.antigravityTokensLeft / s.antigravityMax) * 100;
      }
      return undefined;
    },
  },
  {
    id: "antigravity-gemini-weekly",
    configKey: "notifications.antigravityGeminiWeekly",
    model: "Antigravity Gemini",
    window: "Weekly",
    title: "Antigravity IDE Gemini (주간)",
    message: "Antigravity IDE Gemini 주간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.antigravityWeeklyPercentage === "number") return s.antigravityWeeklyPercentage;
      if (s.antigravityWeeklyMax > 0 && typeof s.antigravityWeeklyTokensLeft === "number") {
        return (s.antigravityWeeklyTokensLeft / s.antigravityWeeklyMax) * 100;
      }
      return undefined;
    },
  },

  // 3 & 4: Antigravity IDE Claude (5h, Weekly)
  {
    id: "antigravity-claude-5h",
    configKey: "notifications.antigravityClaude5h",
    model: "Antigravity Claude",
    window: "5Hours",
    title: "Antigravity IDE Claude (5시간)",
    message: "Antigravity IDE Claude 5시간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.opusPercentage === "number") return s.opusPercentage;
      if (s.opusMax > 0 && typeof s.opusTokensLeft === "number") {
        return (s.opusTokensLeft / s.opusMax) * 100;
      }
      return undefined;
    },
  },
  {
    id: "antigravity-claude-weekly",
    configKey: "notifications.antigravityClaudeWeekly",
    model: "Antigravity Claude",
    window: "Weekly",
    title: "Antigravity IDE Claude (주간)",
    message: "Antigravity IDE Claude 주간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.opusWeeklyPercentage === "number") return s.opusWeeklyPercentage;
      if (s.opusWeeklyMax > 0 && typeof s.opusWeeklyTokensLeft === "number") {
        return (s.opusWeeklyTokensLeft / s.opusWeeklyMax) * 100;
      }
      return undefined;
    },
  },

  // 5 & 6: ChatGPT (OpenAI / Codex) (5h, Weekly)
  {
    id: "chatgpt-5h",
    configKey: "notifications.chatgpt5h",
    model: "ChatGPT",
    window: "5Hours",
    title: "ChatGPT (5시간)",
    message: "ChatGPT 5시간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.codexPercentage === "number") return s.codexPercentage;
      if (s.codexMax > 0 && typeof s.codexTokensLeft === "number") {
        return (s.codexTokensLeft / s.codexMax) * 100;
      }
      return undefined;
    },
  },
  {
    id: "chatgpt-weekly",
    configKey: "notifications.chatgptWeekly",
    model: "ChatGPT",
    window: "Weekly",
    title: "ChatGPT (주간)",
    message: "ChatGPT 주간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      if (typeof s.codexWeeklyPercentage === "number") return s.codexWeeklyPercentage;
      if (s.codexWeeklyMax > 0 && typeof s.codexWeeklyTokensLeft === "number") {
        return (s.codexWeeklyTokensLeft / s.codexWeeklyMax) * 100;
      }
      return undefined;
    },
  },

  // 7 & 8: Claude (Anthropic Direct API / CLI / Cowork) (5h, Weekly)
  {
    id: "claude-5h",
    configKey: "notifications.claude5h",
    model: "Claude",
    window: "5Hours",
    title: "Claude (5시간)",
    message: "Claude 5시간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      const anyStatus = s as any;
      if (typeof anyStatus.claudePercentage === "number") return anyStatus.claudePercentage;
      if (typeof anyStatus.claudeTokensLeft === "number" && anyStatus.claudeMax > 0) {
        return (anyStatus.claudeTokensLeft / anyStatus.claudeMax) * 100;
      }
      return undefined;
    },
  },
  {
    id: "claude-weekly",
    configKey: "notifications.claudeWeekly",
    model: "Claude",
    window: "Weekly",
    title: "Claude (주간)",
    message: "Claude 주간 쿼터가 100%로 완충되었습니다!",
    getPercentage: (s) => {
      if (!s) return undefined;
      const anyStatus = s as any;
      if (typeof anyStatus.claudeWeeklyPercentage === "number") return anyStatus.claudeWeeklyPercentage;
      if (typeof anyStatus.claudeWeeklyTokensLeft === "number" && anyStatus.claudeWeeklyMax > 0) {
        return (anyStatus.claudeWeeklyTokensLeft / anyStatus.claudeWeeklyMax) * 100;
      }
      return undefined;
    },
  },
];

export interface RefilledWindowNotification {
  target: QuotaNotificationTarget;
  previousPercent: number;
  currentPercent: number;
}

export function detectRefilledQuotaWindows(
  previous: TokenStatus | undefined,
  current: TokenStatus | undefined,
  alreadyNotifiedSet: Set<string>,
): {
  notifications: RefilledWindowNotification[];
  updatedNotifiedSet: Set<string>;
} {
  const updatedSet = new Set(alreadyNotifiedSet);
  const notifications: RefilledWindowNotification[] = [];

  if (!current) {
    return { notifications, updatedNotifiedSet: updatedSet };
  }

  for (const target of QUOTA_NOTIFICATION_TARGETS) {
    const currPct = target.getPercentage(current);
    const prevPct = previous ? target.getPercentage(previous) : undefined;

    if (typeof currPct !== "number" || !Number.isFinite(currPct)) {
      continue;
    }

    if (currPct < 100) {
      // Quota dropped below 100%, reset notification flag so it can alert again on next refill
      updatedSet.delete(target.id);
    } else if (currPct >= 100) {
      // Full! Alert if previously recorded as below 100% and not yet alerted
      const wasDepleted = typeof prevPct === "number" && prevPct < 100;
      if (wasDepleted && !updatedSet.has(target.id)) {
        updatedSet.add(target.id);
        notifications.push({
          target,
          previousPercent: prevPct,
          currentPercent: currPct,
        });
      }
    }
  }

  return { notifications, updatedNotifiedSet: updatedSet };
}
