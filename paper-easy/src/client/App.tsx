import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppConfigResponse,
  AuthorPapersResponse,
  HuggingFacePapersResponse,
  Paper,
  PaperQaBatchResponse,
  PaperQaResponse,
  PapersResponse,
  SyncKind,
  SyncRun
} from "../shared/types";
import { requestHuggingFacePaperQa, requestPaperQa, requestSync } from "./api";
import { AppHeader, ViewTabs } from "./components/AppHeader";
import { DEFAULT_CONFIG, type LoadState, type ThemeMode, type UiLanguage, type ViewMode } from "./types";
import { filterPapers, getInitialTheme, toMessage } from "./utils";
import { AuthorsView } from "./views/AuthorsView";
import { DailyView } from "./views/DailyView";
import { HuggingFaceView } from "./views/HuggingFaceView";

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [config, setConfig] = useState<AppConfigResponse>(DEFAULT_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [language, setLanguage] = useState<UiLanguage>("en");
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [dailyDate, setDailyDate] = useState("");
  const [huggingFaceDate, setHuggingFaceDate] = useState("");
  const [query, setQuery] = useState("");
  const [authorQuery, setAuthorQuery] = useState("");
  const [huggingFaceQuery, setHuggingFaceQuery] = useState("");
  const [data, setData] = useState<PapersResponse | null>(null);
  const [authorData, setAuthorData] = useState<AuthorPapersResponse | null>(null);
  const [huggingFaceData, setHuggingFaceData] = useState<HuggingFacePapersResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [authorLoadState, setAuthorLoadState] = useState<LoadState>("idle");
  const [huggingFaceLoadState, setHuggingFaceLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [authorError, setAuthorError] = useState("");
  const [huggingFaceError, setHuggingFaceError] = useState("");
  const [syncingKind, setSyncingKind] = useState<SyncKind | null>(null);
  const [lastSync, setLastSync] = useState<SyncRun | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qaPaperId, setQaPaperId] = useState<string | null>(null);
  const [qaByPaperId, setQaByPaperId] = useState<Record<string, PaperQaResponse>>({});
  const [qaLoadingId, setQaLoadingId] = useState<string | null>(null);
  const [qaError, setQaError] = useState("");
  const [huggingFaceQaRunning, setHuggingFaceQaRunning] = useState(false);
  const [huggingFaceQaResult, setHuggingFaceQaResult] = useState<PaperQaBatchResponse | null>(null);
  const [huggingFaceQaError, setHuggingFaceQaError] = useState("");

  const loadConfig = useCallback(async () => {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error(`Config request failed with ${response.status}`);
    }
    setConfig((await response.json()) as AppConfigResponse);
    setConfigReady(true);
  }, []);

  const loadPapers = useCallback(async (dateOverride = dailyDate) => {
    setLoadState((current) => (current === "ready" ? "ready" : "loading"));
    setError("");

    try {
      const params = new URLSearchParams({
        categories: config.categories.join(","),
        maxResults: String(config.maxResults)
      });
      if (dateOverride) {
        params.set("date", dateOverride);
      }
      const response = await fetch(`/api/papers?${params.toString()}`);

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }

      setData((await response.json()) as PapersResponse);
      setLoadState("ready");
    } catch (requestError) {
      setError(toMessage(requestError, "Unable to load papers"));
      setLoadState("error");
    }
  }, [config.categories, config.maxResults, dailyDate]);

  const loadAuthorPapers = useCallback(async () => {
    if (config.authors.length === 0) {
      setAuthorData(null);
      setAuthorError("");
      setAuthorLoadState("idle");
      return;
    }

    setAuthorLoadState((current) => (current === "ready" ? "ready" : "loading"));
    setAuthorError("");

    try {
      const params = new URLSearchParams({
        authors: config.authors.join(","),
        maxResults: String(config.authorMaxResults)
      });
      const response = await fetch(`/api/author-papers?${params.toString()}`);

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }

      setAuthorData((await response.json()) as AuthorPapersResponse);
      setAuthorLoadState("ready");
    } catch (requestError) {
      setAuthorError(toMessage(requestError, "Unable to load author papers"));
      setAuthorLoadState("error");
    }
  }, [config.authors, config.authorMaxResults]);

  const loadHuggingFacePapers = useCallback(async (dateOverride = huggingFaceDate) => {
    setHuggingFaceLoadState((current) => (current === "ready" ? "ready" : "loading"));
    setHuggingFaceError("");

    try {
      const params = new URLSearchParams({
        maxResults: String(config.huggingFaceMaxResults)
      });
      if (dateOverride) {
        params.set("date", dateOverride);
      }
      const response = await fetch(`/api/huggingface-papers?${params.toString()}`);

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }

      setHuggingFaceData((await response.json()) as HuggingFacePapersResponse);
      setHuggingFaceLoadState("ready");
    } catch (requestError) {
      setHuggingFaceError(toMessage(requestError, "Unable to load Hugging Face papers"));
      setHuggingFaceLoadState("error");
    }
  }, [config.huggingFaceMaxResults, huggingFaceDate]);

  useEffect(() => {
    void loadConfig().catch((requestError) => {
      setError(toMessage(requestError, "Unable to load config"));
      setLoadState("error");
    });
  }, [loadConfig]);

  useEffect(() => {
    if (configReady) {
      void loadPapers();
    }
  }, [configReady, loadPapers]);

  useEffect(() => {
    if (viewMode === "authors") {
      void loadAuthorPapers();
    }
  }, [loadAuthorPapers, viewMode]);

  useEffect(() => {
    if (viewMode === "huggingface") {
      void loadHuggingFacePapers();
    }
  }, [loadHuggingFacePapers, viewMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("papers-easy-theme", theme);
  }, [theme]);

  const filteredPapers = useMemo(() => filterPapers(data?.papers ?? [], query), [data, query]);
  const filteredAuthorPapers = useMemo(
    () => filterPapers(authorData?.papers ?? [], authorQuery),
    [authorData, authorQuery]
  );
  const filteredHuggingFacePapers = useMemo(
    () => filterPapers(huggingFaceData?.papers ?? [], huggingFaceQuery),
    [huggingFaceData, huggingFaceQuery]
  );

  async function syncPapers(kind: SyncKind, date?: string) {
    setSyncingKind(kind);
    setError("");
    setAuthorError("");
    setHuggingFaceError("");

    try {
      let response = await requestSync(kind, undefined, date);
      if (response.status === 401 || response.status === 403) {
        const adminToken = window.prompt("Admin token");
        if (adminToken?.trim()) {
          window.localStorage.setItem("papers-easy-admin-token", adminToken.trim());
          response = await requestSync(kind, adminToken.trim(), date);
        }
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Sync failed with ${response.status}`);
      }

      const body = (await response.json()) as { run: SyncRun };
      setLastSync(body.run);
      if (kind === "daily" || kind === "all") {
        setDailyDate("");
        await loadPapers("");
      }
      if ((kind === "authors" || kind === "all") && config.authors.length > 0) {
        await loadAuthorPapers();
      }
      if (kind === "huggingface" || kind === "all") {
        await loadHuggingFacePapers(date ?? huggingFaceDate);
      }
    } catch (requestError) {
      const message = toMessage(requestError, "Unable to sync papers");
      if (viewMode === "authors") {
        setAuthorError(message);
      } else if (viewMode === "huggingface") {
        setHuggingFaceError(message);
      } else {
        setError(message);
      }
    } finally {
      setSyncingKind(null);
    }
  }

  async function copyTitle(paper: Paper) {
    const text = `${paper.title}\n${paper.huggingFaceUrl ?? paper.arxivUrl}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(paper.id);
    window.setTimeout(() => setCopiedId(null), 1400);
  }

  async function runPaperQa(paper: Paper) {
    setQaPaperId(paper.id);
    setQaLoadingId(paper.id);
    setQaError("");

    try {
      const cachedResponse = await fetch(`/api/paper-qa?paperId=${encodeURIComponent(paper.id)}`);
      if (cachedResponse.ok) {
        const cached = (await cachedResponse.json()) as PaperQaResponse;
        setQaByPaperId((current) => ({ ...current, [paper.id]: cached }));
        if (cached.status === "complete") {
          return;
        }
      }

      let response = await requestPaperQa(paper.id);
      if (response.status === 401 || response.status === 403) {
        const adminToken = window.prompt("Admin token");
        if (adminToken?.trim()) {
          window.localStorage.setItem("papers-easy-admin-token", adminToken.trim());
          response = await requestPaperQa(paper.id, adminToken.trim());
        }
      }

      const body = (await response.json().catch(() => null)) as (Partial<PaperQaResponse> & { error?: string }) | null;
      if (body?.paperId) {
        setQaByPaperId((current) => ({ ...current, [paper.id]: body as PaperQaResponse }));
      }
      if (!response.ok) {
        throw new Error(body?.error ?? `Paper QA failed with ${response.status}`);
      }
    } catch (requestError) {
      setQaError(toMessage(requestError, "Unable to run paper QA"));
    } finally {
      setQaLoadingId(null);
    }
  }

  async function runHuggingFaceDailyQa() {
    const selectedDate = huggingFaceDate || huggingFaceData?.selectedDate;
    setHuggingFaceQaRunning(true);
    setHuggingFaceQaError("");
    setHuggingFaceQaResult(null);
    setQaError("");

    try {
      let response = await requestHuggingFacePaperQa(selectedDate);
      if (response.status === 401 || response.status === 403) {
        const adminToken = window.prompt("Admin token");
        if (adminToken?.trim()) {
          window.localStorage.setItem("papers-easy-admin-token", adminToken.trim());
          response = await requestHuggingFacePaperQa(selectedDate, adminToken.trim());
        }
      }

      const body = (await response.json().catch(() => null)) as (Partial<PaperQaBatchResponse> & { error?: string }) | null;
      if (body?.results) {
        setQaByPaperId((current) => {
          const next = { ...current };
          for (const result of body.results ?? []) {
            next[result.paperId] = result;
          }
          return next;
        });
      }

      if (!response.ok) {
        throw new Error(body?.error ?? `Hugging Face paper QA failed with ${response.status}`);
      }

      const result = body as PaperQaBatchResponse;
      setHuggingFaceQaResult(result);
      const focusedResult = result.results.find((item) => item.error || item.status !== "complete") ?? result.results[0];
      if (focusedResult) {
        setQaPaperId(focusedResult.paperId);
      }
    } catch (requestError) {
      setHuggingFaceQaError(toMessage(requestError, "Unable to run Hugging Face paper QA"));
    } finally {
      setHuggingFaceQaRunning(false);
    }
  }

  const activeData = viewMode === "daily" ? data : viewMode === "authors" ? authorData : huggingFaceData;
  const isLoading = loadState === "loading" || (loadState === "ready" && !data);
  const isAuthorLoading = authorLoadState === "loading" || (authorLoadState === "ready" && !authorData && config.authors.length > 0);
  const isHuggingFaceLoading = huggingFaceLoadState === "loading" || (huggingFaceLoadState === "ready" && !huggingFaceData);
  const activeSyncErrors = lastSync?.stats.errors;
  const syncErrorText = Array.isArray(activeSyncErrors)
    ? activeSyncErrors
        .map((item) => {
          const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return `${String(source.sourceKey ?? "source")}: ${String(source.message ?? "Unknown error")}`;
        })
        .join("; ")
    : "";
  const dailyDates = data?.availableDates ?? [];
  const huggingFaceDates = huggingFaceData?.availableDates ?? [];

  function handleDailyDateChange(value: string) {
    setDailyDate(value);
    void loadPapers(value);
  }

  function handleHuggingFaceDateChange(value: string) {
    setHuggingFaceDate(value);
    setHuggingFaceQaResult(null);
    setHuggingFaceQaError("");
    void loadHuggingFacePapers(value);
  }

  return (
    <main className="page-shell">
      <AppHeader
        viewMode={viewMode}
        config={config}
        activeData={activeData}
        lastSync={lastSync}
        theme={theme}
        language={language}
        dailyDate={dailyDate}
        huggingFaceDate={huggingFaceDate}
        dailyDates={dailyDates}
        huggingFaceDates={huggingFaceDates}
        isLoading={isLoading}
        isHuggingFaceLoading={isHuggingFaceLoading}
        onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onLanguageChange={setLanguage}
        onDailyDateChange={handleDailyDateChange}
        onHuggingFaceDateChange={handleHuggingFaceDateChange}
      />

      <ViewTabs viewMode={viewMode} onViewModeChange={setViewMode} />

      {viewMode === "daily" ? (
        <DailyView
          config={config}
          papers={filteredPapers}
          query={query}
          isLoading={isLoading}
          syncingKind={syncingKind}
          error={error}
          syncErrorText={syncErrorText}
          copiedId={copiedId}
          language={language}
          onQueryChange={setQuery}
          onRefresh={loadPapers}
          onSync={() => void syncPapers("daily")}
          onCopy={copyTitle}
        />
      ) : viewMode === "authors" ? (
        <AuthorsView
          config={config}
          papers={filteredAuthorPapers}
          query={authorQuery}
          isLoading={isAuthorLoading}
          syncingKind={syncingKind}
          error={authorError}
          syncErrorText={syncErrorText}
          copiedId={copiedId}
          qaPaperId={qaPaperId}
          qaByPaperId={qaByPaperId}
          qaLoadingId={qaLoadingId}
          qaError={qaError}
          language={language}
          onQueryChange={setAuthorQuery}
          onRefresh={loadAuthorPapers}
          onSync={() => void syncPapers("authors")}
          onCopy={copyTitle}
          onPaperQa={runPaperQa}
        />
      ) : (
        <HuggingFaceView
          data={huggingFaceData}
          papers={filteredHuggingFacePapers}
          query={huggingFaceQuery}
          isLoading={isHuggingFaceLoading}
          syncingKind={syncingKind}
          error={huggingFaceError}
          syncErrorText={syncErrorText}
          copiedId={copiedId}
          qaPaperId={qaPaperId}
          qaByPaperId={qaByPaperId}
          qaLoadingId={qaLoadingId}
          qaError={qaError}
          qaRunning={huggingFaceQaRunning}
          qaResult={huggingFaceQaResult}
          qaBatchError={huggingFaceQaError}
          language={language}
          onQueryChange={setHuggingFaceQuery}
          onRefresh={loadHuggingFacePapers}
          onSync={() => void syncPapers("huggingface", huggingFaceDate || huggingFaceData?.selectedDate)}
          onCopy={copyTitle}
          onPaperQa={runPaperQa}
          onRunDailyQa={runHuggingFaceDailyQa}
        />
      )}
    </main>
  );
}
