import type { AppConfigResponse, Paper, PaperQaResponse, SyncKind } from "../../shared/types";
import { ArchiveControls } from "../components/ArchiveControls";
import { Notice } from "../components/Notice";
import { PaperFeed } from "../components/PaperFeed";
import type { UiLanguage } from "../types";

type AuthorsViewProps = {
  config: AppConfigResponse;
  papers: Paper[];
  query: string;
  isLoading: boolean;
  syncingKind: SyncKind | null;
  error: string;
  syncErrorText: string;
  copiedId: string | null;
  qaPaperId: string | null;
  qaByPaperId: Record<string, PaperQaResponse>;
  qaLoadingId: string | null;
  qaError: string;
  language: UiLanguage;
  onQueryChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onCopy: (paper: Paper) => void | Promise<void>;
  onPaperQa: (paper: Paper) => void | Promise<void>;
};

export function AuthorsView({
  config,
  papers,
  query,
  isLoading,
  syncingKind,
  error,
  syncErrorText,
  copiedId,
  qaPaperId,
  qaByPaperId,
  qaLoadingId,
  qaError,
  language,
  onQueryChange,
  onRefresh,
  onSync,
  onCopy,
  onPaperQa
}: AuthorsViewProps) {
  return (
    <>
      <ArchiveControls
        chips={config.authors}
        query={query}
        queryPlaceholder="Search authors feed"
        isLoading={isLoading}
        isSyncing={syncingKind === "authors" || syncingKind === "all"}
        onQueryChange={onQueryChange}
        onRefresh={onRefresh}
        onSync={onSync}
        syncDisabled={config.authors.length === 0}
        rssHref="/rss/arxiv-authors.xml"
      />

      {error ? <Notice kind="error" title="Load failed" message={error} /> : null}
      {syncErrorText ? <Notice kind="warning" title="Partial sync" message={syncErrorText} /> : null}

      <PaperFeed
        papers={papers}
        isLoading={isLoading}
        emptyTitle={query.trim().length > 0 ? "No matches" : config.authors.length === 0 ? "No authors" : "No papers"}
        emptyMessage={
          query.trim().length > 0
            ? "Try another keyword."
            : config.authors.length === 0
              ? "Set PAPERS_EASY_AUTHORS in .env or Docker environment."
              : "Click Sync to fetch the configured authors into the database."
        }
        copiedId={copiedId}
        qaPaperId={qaPaperId}
        qaByPaperId={qaByPaperId}
        qaLoadingId={qaLoadingId}
        qaError={qaError}
        language={language}
        onCopy={onCopy}
        onPaperQa={onPaperQa}
      />
    </>
  );
}
