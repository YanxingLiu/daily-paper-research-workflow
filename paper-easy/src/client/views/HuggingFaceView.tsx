import { CircleHelp, Loader2 } from "lucide-react";
import type { HuggingFacePapersResponse, Paper, PaperQaBatchResponse, PaperQaResponse, SyncKind } from "../../shared/types";
import { ArchiveControls } from "../components/ArchiveControls";
import { Notice } from "../components/Notice";
import { PaperFeed } from "../components/PaperFeed";
import type { UiLanguage } from "../types";
import { formatDateOnly } from "../utils";

type HuggingFaceViewProps = {
  data: HuggingFacePapersResponse | null;
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
  qaRunning: boolean;
  qaResult: PaperQaBatchResponse | null;
  qaBatchError: string;
  language: UiLanguage;
  onQueryChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onCopy: (paper: Paper) => void | Promise<void>;
  onPaperQa: (paper: Paper) => void | Promise<void>;
  onRunDailyQa: () => void | Promise<void>;
};

export function HuggingFaceView({
  data,
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
  qaRunning,
  qaResult,
  qaBatchError,
  language,
  onQueryChange,
  onRefresh,
  onSync,
  onCopy,
  onPaperQa,
  onRunDailyQa
}: HuggingFaceViewProps) {
  return (
    <>
      <ArchiveControls
        chips={["HF Daily"]}
        query={query}
        queryPlaceholder="Search Hugging Face daily"
        isLoading={isLoading}
        isSyncing={syncingKind === "huggingface" || syncingKind === "all"}
        onQueryChange={onQueryChange}
        onRefresh={onRefresh}
        onSync={onSync}
        extraAction={
          <button
            className="primary-button secondary-action"
            type="button"
            onClick={() => void onRunDailyQa()}
            disabled={qaRunning || isLoading || (data?.papers.length ?? 0) === 0}
          >
            {qaRunning ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
            <span>QA All</span>
          </button>
        }
      />

      {error ? <Notice kind="error" title="Load failed" message={error} /> : null}
      {syncErrorText ? <Notice kind="warning" title="Partial sync" message={syncErrorText} /> : null}
      {qaRunning ? <Notice title="Paper QA running" message="Running QA for all Hugging Face daily papers on the selected date." /> : null}
      {qaBatchError ? <Notice kind="error" title="Paper QA failed" message={qaBatchError} /> : null}
      {qaResult ? (
        <Notice
          kind={qaResult.status === "complete" ? undefined : "warning"}
          title={qaResult.status === "complete" ? "Paper QA complete" : "Paper QA partial"}
          message={`${qaResult.completedPapers}/${qaResult.totalPapers} papers, ${qaResult.completedQuestions}/${qaResult.totalQuestions} answers for ${formatDateOnly(qaResult.selectedDate)}.`}
        />
      ) : null}

      <PaperFeed
        papers={papers}
        isLoading={isLoading}
        emptyTitle={query.trim().length > 0 ? "No matches" : "No papers"}
        emptyMessage={query.trim().length > 0 ? "Try another keyword." : "Click Sync to fetch Hugging Face daily papers into the database."}
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
