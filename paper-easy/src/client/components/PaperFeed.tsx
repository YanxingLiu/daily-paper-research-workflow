import { Check, CircleHelp, Copy, ExternalLink, FileText, Loader2 } from "lucide-react";
import type { Paper, PaperQaResponse } from "../../shared/types";
import type { UiLanguage } from "../types";
import { formatDate } from "../utils";
import { LoadingRows } from "./LoadingRows";
import { Notice } from "./Notice";
import { PaperQaPanel } from "./PaperQaPanel";
import { TranslatedPaperContent } from "./TranslatedPaperContent";

export function PaperFeed({
  papers,
  isLoading,
  emptyTitle,
  emptyMessage,
  copiedId,
  qaPaperId,
  qaByPaperId,
  qaLoadingId,
  qaError,
  language,
  onCopy,
  onPaperQa
}: {
  papers: Paper[];
  isLoading: boolean;
  emptyTitle: string;
  emptyMessage: string;
  copiedId: string | null;
  qaPaperId?: string | null;
  qaByPaperId?: Record<string, PaperQaResponse>;
  qaLoadingId?: string | null;
  qaError?: string;
  language: UiLanguage;
  onCopy: (paper: Paper) => void | Promise<void>;
  onPaperQa?: (paper: Paper) => void | Promise<void>;
}) {
  return (
    <section className="feed" aria-live="polite">
      {isLoading ? <LoadingRows /> : null}
      {!isLoading && papers.length === 0 ? <Notice title={emptyTitle} message={emptyMessage} /> : null}
      {!isLoading &&
        papers.map((paper, index) => (
          <article className="paper-row" key={paper.id}>
            <div className="paper-index">#{index + 1}</div>
            <div className="paper-body">
              <TranslatedPaperContent paper={paper} language={language} />
              <div className="paper-meta">
                <span>Publish: {formatDate(paper.published)}</span>
                <span>Primary: {paper.primaryCategory}</span>
                {paper.upvotes !== undefined ? <span>Upvotes: {paper.upvotes}</span> : null}
                {paper.submittedBy ? <span>Submitted: {paper.submittedBy}</span> : null}
              </div>
              <div className="paper-footer">
                <div className="subject-list">
                  {paper.categories.map((category) => (
                    <span className="chip" key={category}>
                      {category}
                    </span>
                  ))}
                </div>
                <div className="paper-actions">
                  <a className="link-button" href={paper.arxivUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden="true" />
                    <span>arXiv</span>
                  </a>
                  {paper.huggingFaceUrl ? (
                    <a className="link-button" href={paper.huggingFaceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} aria-hidden="true" />
                      <span>HF</span>
                    </a>
                  ) : null}
                  <a className="link-button" href={paper.pdfUrl} target="_blank" rel="noreferrer">
                    <FileText size={15} aria-hidden="true" />
                    <span>PDF</span>
                  </a>
                  <button className="link-button" type="button" onClick={() => void onCopy(paper)}>
                    {copiedId === paper.id ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    <span>{copiedId === paper.id ? "Copied" : "Copy"}</span>
                  </button>
                  {onPaperQa ? (
                    <button className="link-button" type="button" onClick={() => void onPaperQa(paper)} disabled={qaLoadingId === paper.id}>
                      {qaLoadingId === paper.id ? (
                        <Loader2 className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <CircleHelp size={15} aria-hidden="true" />
                      )}
                      <span>Paper QA</span>
                    </button>
                  ) : null}
                </div>
              </div>
              {qaPaperId === paper.id ? (
                <PaperQaPanel qa={qaByPaperId?.[paper.id]} isLoading={qaLoadingId === paper.id} error={qaError ?? ""} />
              ) : null}
            </div>
          </article>
        ))}
    </section>
  );
}
