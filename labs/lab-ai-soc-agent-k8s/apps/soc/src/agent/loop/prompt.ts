import {
  AUTHORITY_RULES,
  HUNT_MODE,
  huntBrief,
  INVESTIGATE_MODE,
  METHOD,
  ROLE,
  UNTRUSTED_RULES,
} from "./prompt-text.js";

export const DEFAULT_HUNT_WINDOW_MINUTES = 120;

/**
 * Stable text first, mode next, today's date last. The date makes the cached
 * prefix change once a day, which is acceptable.
 */
export function systemPrompt(
  today: string,
  mode: "investigate" | "hunt",
  huntWindowMinutes = DEFAULT_HUNT_WINDOW_MINUTES,
): string {
  const modeText =
    mode === "hunt"
      ? `${HUNT_MODE}\n\n${huntBrief(huntWindowMinutes)}`
      : INVESTIGATE_MODE;
  return [
    ROLE,
    UNTRUSTED_RULES,
    AUTHORITY_RULES,
    METHOD,
    modeText,
    `Today's date is ${today}. Interpret relative times against it.`,
  ].join("\n\n");
}
