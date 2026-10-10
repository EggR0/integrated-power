export interface AgyModelResolution {
  model: string;
  effort: string;
  family: "gemini" | "claude";
  displayName: string;
}

/**
 * Resolves the lowest resource/cost verified model for Antigravity (AGY) 5-hour quota pre-warming.
 * - Gemini family: 'gemini-3.6-flash-low' (Flash Low tier, aligned with Antigravity IDE Quota groups)
 * - Claude family: 'claude-sonnet-5-5-low' (Sonnet Low tier, aligned with Antigravity IDE Quota groups)
 */
export function getLowestAgyModel(family: "gemini" | "claude"): AgyModelResolution {
  if (family === "gemini") {
    return {
      model: "gemini-3.6-flash-low",
      effort: "low",
      family: "gemini",
      displayName: "Gemini 3.6 Flash (Low)",
    };
  }

  return {
    model: "claude-sonnet-5-5-low",
    effort: "low",
    family: "claude",
    displayName: "Claude Sonnet 5.5 (Low)",
  };
}
