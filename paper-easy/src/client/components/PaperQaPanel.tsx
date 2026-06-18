import type { PaperQaResponse } from "../../shared/types";
import { Notice } from "./Notice";

export function PaperQaPanel({ qa, isLoading, error }: { qa?: PaperQaResponse; isLoading: boolean; error: string }) {
  const answersByIndex = new Map((qa?.answers ?? []).map((answer) => [answer.questionIndex, answer]));

  return (
    <section className="paper-qa-panel" aria-label="Paper QA results">
      <div className="paper-qa-header">
        <strong>Paper QA</strong>
        <span>
          {qa ? `${qa.completedCount}/${qa.totalCount}` : isLoading ? "Running" : "Ready"}
        </span>
      </div>
      {error ? <Notice kind="error" title="Paper QA failed" message={error} /> : null}
      {isLoading && !qa ? <div className="paper-qa-pending">Running...</div> : null}
      {qa?.questions.map((question, questionIndex) => {
        const answer = answersByIndex.get(questionIndex);
        return (
          <div className="paper-qa-item" key={`${questionIndex}-${question}`}>
            <h3>{`Q${questionIndex + 1}: ${question}`}</h3>
            <p>{answer?.answer ?? "Waiting"}</p>
          </div>
        );
      })}
    </section>
  );
}
