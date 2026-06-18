import type { Paper } from "../shared/types";
import type { ThemeMode } from "./types";

export function filterPapers(papers: Paper[], query: string): Paper[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return papers;
  }

  return papers.filter((paper) => {
    const translations = Object.values(paper.translations ?? {})
      .map((translation) => `${translation.title} ${(translation.affiliations ?? []).join(" ")} ${translation.summary}`)
      .join(" ");
    const haystack =
      `${paper.title} ${paper.summary} ${translations} ${paper.authors.join(" ")} ${(paper.affiliations ?? []).join(" ")} ${paper.categories.join(" ")}`;
    return haystack.toLowerCase().includes(normalized);
  });
}

export function formatList(values: string[]): string {
  return values.filter(Boolean).join(", ");
}

export function formatDate(value: string): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatDateOnly(value: string): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

export function getInitialTheme(): ThemeMode {
  const stored = window.localStorage.getItem("papers-easy-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
