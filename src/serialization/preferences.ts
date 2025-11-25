import type { UserPreferences } from "@/types";
import { basePreferences } from "@/util/constant";

export function loadPreferences(): UserPreferences {
  const preferences = localStorage.getItem("llm-ui-preferences");
  if (preferences === null) return basePreferences;

  try {
    return Object.assign({}, basePreferences, JSON.parse(preferences));
  } catch {
    return basePreferences;
  }
}

export function savePreferences(preferences: UserPreferences): void {
  localStorage.setItem("llm-ui-preferences", JSON.stringify(preferences));
}
