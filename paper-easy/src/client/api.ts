import type { SyncKind } from "../shared/types";

export function requestSync(
  kind: SyncKind,
  token = window.localStorage.getItem("papers-easy-admin-token")?.trim() ?? "",
  date?: string
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch("/api/sync", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind, ...(date ? { date } : {}) })
  });
}

export function requestPaperQa(
  paperId: string,
  token = window.localStorage.getItem("papers-easy-admin-token")?.trim() ?? ""
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch("/api/paper-qa", {
    method: "POST",
    headers,
    body: JSON.stringify({ paperId })
  });
}

export function requestHuggingFacePaperQa(
  date?: string,
  token = window.localStorage.getItem("papers-easy-admin-token")?.trim() ?? ""
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch("/api/huggingface-paper-qa", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...(date ? { date } : {}) })
  });
}
