import type { Paper } from "../../shared/types";
import type { UiLanguage } from "../types";
import { formatList } from "../utils";

export function TranslatedPaperContent({ paper, language }: { paper: Paper; language: UiLanguage }) {
  const zh = paper.translations?.zh;
  const affiliationsText = formatList(paper.affiliations ?? []);
  const translatedAffiliationsText = formatList(zh?.affiliations ?? []);

  if (language === "zh") {
    return (
      <>
        <h2>
          <a href={paper.arxivUrl} target="_blank" rel="noreferrer">
            {paper.title}
          </a>
        </h2>
        {zh ? <h3 className="translated-title">{zh.title}</h3> : <p className="translation-missing">中文翻译等待同步生成</p>}
        <p className="authors">Authors: {paper.authors.join(", ") || "Unknown"}</p>
        {affiliationsText ? <p className="affiliations">Affiliations: {affiliationsText}</p> : null}
        <p className="authors">作者: {paper.authors.join(", ") || "Unknown"}</p>
        {affiliationsText ? (
          <p className="affiliations">作者单位: {translatedAffiliationsText || affiliationsText}</p>
        ) : null}
        <p className="summary">{paper.summary}</p>
        {zh ? <p className="summary translated-summary">{zh.summary}</p> : null}
      </>
    );
  }

  return (
    <>
      <h2>
        <a href={paper.arxivUrl} target="_blank" rel="noreferrer">
          {paper.title}
        </a>
      </h2>
      <p className="authors">Authors: {paper.authors.join(", ") || "Unknown"}</p>
      {affiliationsText ? <p className="affiliations">Affiliations: {affiliationsText}</p> : null}
      <p className="summary">{paper.summary}</p>
    </>
  );
}
