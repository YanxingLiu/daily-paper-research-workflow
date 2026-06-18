import type { AppConfigResponse, Paper, SyncKind } from "../../shared/types";
import { ArchiveControls } from "../components/ArchiveControls";
import { Notice } from "../components/Notice";
import { PaperFeed } from "../components/PaperFeed";
import type { UiLanguage } from "../types";

type DailyViewProps = {
  config: AppConfigResponse;
  papers: Paper[];
  query: string;
  isLoading: boolean;
  syncingKind: SyncKind | null;
  error: string;
  syncErrorText: string;
  copiedId: string | null;
  language: UiLanguage;
  onQueryChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onCopy: (paper: Paper) => void | Promise<void>;
};

export function DailyView({
  config,
  papers,
  query,
  isLoading,
  syncingKind,
  error,
  syncErrorText,
  copiedId,
  language,
  onQueryChange,
  onRefresh,
  onSync,
  onCopy
}: DailyViewProps) {
  return (
    <>
      <ArchiveControls
        chips={config.categories}
        query={query}
        queryPlaceholder="Search"
        isLoading={isLoading}
        isSyncing={syncingKind === "daily" || syncingKind === "all"}
        onQueryChange={onQueryChange}
        onRefresh={onRefresh}
        onSync={onSync}
      />

      {error ? <Notice kind="error" title="Load failed" message={error} /> : null}
      {syncErrorText ? <Notice kind="warning" title="Partial sync" message={syncErrorText} /> : null}

      <PaperFeed
        papers={papers}
        isLoading={isLoading}
        emptyTitle={query.trim().length > 0 ? "No matches" : "No papers"}
        emptyMessage={query.trim().length > 0 ? "Try another keyword." : "Click Sync to fetch the configured fields into the database."}
        copiedId={copiedId}
        language={language}
        onCopy={onCopy}
      />
    </>
  );
}
