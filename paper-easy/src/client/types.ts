import type { AppConfigResponse } from "../shared/types";

export const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG"];

export const DEFAULT_CONFIG: AppConfigResponse = {
  categories: DEFAULT_CATEGORIES,
  authors: [],
  maxResults: 50,
  authorMaxResults: 50,
  huggingFaceMaxResults: 30,
  syncTime: "08:00",
  translationEnabled: false
};

export type LoadState = "idle" | "loading" | "ready" | "error";
export type ViewMode = "daily" | "authors" | "huggingface";
export type UiLanguage = "en" | "zh";
export type ThemeMode = "light" | "dark";
