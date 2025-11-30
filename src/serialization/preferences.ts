import { database } from "@/indexeddb";
import type { UserPreferences } from "@/types";
import { basePreferences } from "@/util/constant";

export interface PreferenceEntry {
  name: string;
  value: any;
}

export async function loadPreferences(): Promise<UserPreferences> {
  const preferences: Record<string, any> = basePreferences;
  const saved = await database.queryAll<PreferenceEntry>("preferences");

  for (const entry of saved) {
    preferences[entry.name] = entry.value;
  }

  return preferences as UserPreferences;
}

export async function savePreferences(preferences: UserPreferences): Promise<void> {
  for (const name in preferences) {
    await database.put("preferences", {
      name: name,
      value: preferences[name as keyof UserPreferences] as any,
    });
  }
}
