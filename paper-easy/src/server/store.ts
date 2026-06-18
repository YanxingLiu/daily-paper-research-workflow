import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Paper, PaperQaAnswer, PaperTranslation, SyncKind, SyncRun } from "../shared/types";

type DatabaseSyncConstructor = new (databasePath: string) => DatabaseSyncType;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };

export type SourceType = "daily" | "author" | "huggingface";

export type PaperSource = {
  paperId: string;
  sourceType: SourceType;
  sourceKey: string;
  snapshotDate?: string;
};

type StoredPaperRow = {
  id: string;
  versioned_id: string;
  title: string;
  summary: string;
  authors_json: string;
  affiliations_json: string;
  published_at: string;
  updated_at: string;
  primary_category: string;
  categories_json: string;
  arxiv_url: string;
  pdf_url: string;
  extra_json: string;
};

type SyncRunRow = {
  id: number;
  kind: SyncKind;
  status: "running" | "success" | "failed";
  started_at: string;
  finished_at: string | null;
  config_json: string;
  stats_json: string;
  error_message: string | null;
};

type TranslationRow = {
  paper_id: string;
  language: string;
  title: string;
  summary: string;
  affiliations_json: string;
  updated_at: string;
};

type PaperQaAnswerRow = {
  paper_id: string;
  question_index: number;
  question: string;
  answer: string;
  updated_at: string;
};

type PaperQaRunRow = {
  paper_id: string;
  status: PaperQaRunStatus;
  completed_count: number;
  total_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
};

type PaperFullTextCacheRow = {
  paper_id: string;
  versioned_id: string;
  source_url: string;
  full_text_source_url: string;
  text: string;
  content_hash: string;
  updated_at: string;
};

export type TranslationFreshness = {
  sourceContentHash: string;
  provider: string;
  model: string;
  promptVersion: string;
};

export type PaperQaFreshness = {
  sourceContentHash: string;
  questionHash: string;
  provider: string;
  model: string;
  promptVersion: string;
};

export type PaperQaRunStatus = "running" | "complete" | "partial" | "failed";

export type PaperQaRunRecord = {
  paperId: string;
  status: PaperQaRunStatus;
  completedCount: number;
  totalCount: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
};

export type CachedPaperFullText = {
  text: string;
  sourceUrl: string;
  contentHash: string;
  updatedAt?: string;
};

export class PaperStore {
  private readonly db: DatabaseSyncType;

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsertPaper(paper: Paper, sources: Array<{ sourceType: SourceType; sourceKey: string; snapshotDate?: string }>, seenAt = new Date().toISOString()): void {
    const insertPaper = this.db.prepare(`
      INSERT INTO papers (
        id, versioned_id, title, summary, authors_json, affiliations_json, published_at, updated_at,
        primary_category, categories_json, arxiv_url, pdf_url, extra_json, first_seen_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        versioned_id = excluded.versioned_id,
        title = excluded.title,
        summary = excluded.summary,
        authors_json = excluded.authors_json,
        affiliations_json = excluded.affiliations_json,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at,
        primary_category = excluded.primary_category,
        categories_json = excluded.categories_json,
        arxiv_url = excluded.arxiv_url,
        pdf_url = excluded.pdf_url,
        extra_json = excluded.extra_json,
        last_seen_at = excluded.last_seen_at
    `);

    insertPaper.run(
      paper.id,
      paper.versionedId,
      paper.title,
      paper.summary,
      JSON.stringify(paper.authors),
      JSON.stringify(paper.affiliations),
      paper.published,
      paper.updated,
      paper.primaryCategory,
      JSON.stringify(paper.categories),
      paper.arxivUrl,
      paper.pdfUrl,
      JSON.stringify(paperExtraJson(paper)),
      seenAt,
      seenAt
    );

    const insertSource = this.db.prepare(`
      INSERT INTO paper_sources (paper_id, source_type, source_key, first_seen_at, last_seen_at, extra_json)
      VALUES (?, ?, ?, ?, ?, '{}')
      ON CONFLICT(paper_id, source_type, source_key) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `);

    for (const source of sources) {
      insertSource.run(paper.id, source.sourceType, source.sourceKey, seenAt, seenAt);

      if (source.sourceType === "daily" || source.sourceType === "huggingface") {
        this.db
          .prepare(
            `
            INSERT INTO daily_snapshots (snapshot_date, paper_id, source_key, seen_at, extra_json)
            VALUES (?, ?, ?, ?, '{}')
            ON CONFLICT(snapshot_date, paper_id, source_key) DO UPDATE SET
              seen_at = excluded.seen_at
          `
          )
          .run(source.snapshotDate ?? toDateKey(seenAt), paper.id, source.sourceKey, seenAt);
      }
    }
  }

  listDailyPapers(categories: string[], limit: number, date?: string): Paper[] {
    if (categories.length === 0) {
      return [];
    }

    const placeholders = categories.map(() => "?").join(",");
    if (date) {
      const rows = this.db
        .prepare(
          `
          SELECT DISTINCT p.*
          FROM papers p
          INNER JOIN daily_snapshots d ON d.paper_id = p.id
          WHERE d.snapshot_date = ? AND d.source_key IN (${placeholders})
          ORDER BY datetime(p.published_at) DESC, p.id DESC
          LIMIT ?
        `
        )
        .all(date, ...categories, limit) as StoredPaperRow[];

      return this.withTranslations(rows.map(rowToPaper));
    }

    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT p.*
        FROM papers p
        INNER JOIN paper_sources s ON s.paper_id = p.id
        WHERE s.source_type = 'daily' AND s.source_key IN (${placeholders})
        ORDER BY datetime(p.published_at) DESC, p.id DESC
        LIMIT ?
      `
      )
      .all(...categories, limit) as StoredPaperRow[];

    return this.withTranslations(rows.map(rowToPaper));
  }

  listDailyDates(categories: string[], limit: number): string[] {
    if (categories.length === 0) {
      return [];
    }

    const placeholders = categories.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `
        SELECT snapshot_date
        FROM daily_snapshots
        WHERE source_key IN (${placeholders})
        GROUP BY snapshot_date
        ORDER BY snapshot_date DESC
        LIMIT ?
      `
      )
      .all(...categories, limit) as Array<{ snapshot_date: string }>;

    return rows.map((row) => row.snapshot_date);
  }

  listHuggingFaceDailyPapers(sourceKey: string, limit: number, date?: string): Paper[] {
    if (!date) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT p.*
        FROM papers p
        INNER JOIN daily_snapshots d ON d.paper_id = p.id
        WHERE d.snapshot_date = ? AND d.source_key = ?
        ORDER BY datetime(p.updated_at) DESC, p.id DESC
        LIMIT ?
      `
      )
      .all(date, sourceKey, limit) as StoredPaperRow[];

    return this.withTranslations(rows.map(rowToPaper));
  }

  listHuggingFaceDailyDates(sourceKey: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT snapshot_date
        FROM daily_snapshots
        WHERE source_key = ?
        GROUP BY snapshot_date
        ORDER BY snapshot_date DESC
        LIMIT ?
      `
      )
      .all(sourceKey, limit) as Array<{ snapshot_date: string }>;

    return rows.map((row) => row.snapshot_date);
  }

  listAuthorPapers(authors: string[], limit: number): Paper[] {
    if (authors.length === 0) {
      return [];
    }

    const placeholders = authors.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT p.*
        FROM papers p
        INNER JOIN paper_sources s ON s.paper_id = p.id
        WHERE s.source_type = 'author' AND s.source_key IN (${placeholders})
        ORDER BY datetime(p.published_at) DESC, p.id DESC
        LIMIT ?
      `
      )
      .all(...authors, limit) as StoredPaperRow[];

    return this.withTranslations(rows.map(rowToPaper));
  }

  getPaper(paperId: string): Paper | null {
    const row = this.db.prepare("SELECT * FROM papers WHERE id = ? LIMIT 1").get(paperId) as StoredPaperRow | undefined;
    if (!row) {
      return null;
    }

    return this.withTranslations([rowToPaper(row)])[0] ?? null;
  }

  hasFreshTranslation(paperId: string, language: string, freshness: TranslationFreshness): boolean {
    const row = this.db
      .prepare("SELECT provider, model, extra_json FROM paper_translations WHERE paper_id = ? AND language = ? LIMIT 1")
      .get(paperId, language) as { provider: string; model: string; extra_json: string } | undefined;
    if (!row || row.provider !== freshness.provider || row.model !== freshness.model) {
      return false;
    }

    const extra = parseJsonObject(row.extra_json);
    return (
      extra.sourceContentHash === freshness.sourceContentHash &&
      extra.promptVersion === freshness.promptVersion &&
      extra.provider === freshness.provider &&
      extra.model === freshness.model
    );
  }

  upsertTranslation(
    paperId: string,
    translation: PaperTranslation,
    provider: string,
    model: string,
    freshness: TranslationFreshness
  ): void {
    const now = translation.updatedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO paper_translations (
          paper_id, language, title, summary, affiliations_json, provider, model, extra_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(paper_id, language) DO UPDATE SET
          title = excluded.title,
          summary = excluded.summary,
          affiliations_json = excluded.affiliations_json,
          provider = excluded.provider,
          model = excluded.model,
          extra_json = excluded.extra_json,
          updated_at = excluded.updated_at
      `
      )
      .run(
        paperId,
        translation.language,
        translation.title,
        translation.summary,
        JSON.stringify(translation.affiliations ?? []),
        provider,
        model,
        JSON.stringify(freshness),
        now,
        now
      );
  }

  listPaperQaAnswers(paperId: string): PaperQaAnswer[] {
    const rows = this.db
      .prepare(
        `
        SELECT paper_id, question_index, question, answer, updated_at
        FROM paper_qa_answers
        WHERE paper_id = ?
        ORDER BY question_index ASC
      `
      )
      .all(paperId) as PaperQaAnswerRow[];

    return rows.map(rowToPaperQaAnswer);
  }

  hasFreshPaperQaAnswer(paperId: string, questionIndex: number, freshness: PaperQaFreshness): boolean {
    const row = this.db
      .prepare("SELECT provider, model, extra_json FROM paper_qa_answers WHERE paper_id = ? AND question_index = ? LIMIT 1")
      .get(paperId, questionIndex) as { provider: string; model: string; extra_json: string } | undefined;
    if (!row || row.provider !== freshness.provider || row.model !== freshness.model) {
      return false;
    }

    const extra = parseJsonObject(row.extra_json);
    return (
      extra.sourceContentHash === freshness.sourceContentHash &&
      extra.questionHash === freshness.questionHash &&
      extra.promptVersion === freshness.promptVersion &&
      extra.provider === freshness.provider &&
      extra.model === freshness.model
    );
  }

  upsertPaperQaAnswer(
    paperId: string,
    questionIndex: number,
    question: string,
    answer: string,
    provider: string,
    model: string,
    freshness: PaperQaFreshness
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO paper_qa_answers (
          paper_id, question_index, question, answer, provider, model, extra_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(paper_id, question_index) DO UPDATE SET
          question = excluded.question,
          answer = excluded.answer,
          provider = excluded.provider,
          model = excluded.model,
          extra_json = excluded.extra_json,
          updated_at = excluded.updated_at
      `
      )
      .run(paperId, questionIndex, question, answer, provider, model, JSON.stringify(freshness), now, now);
  }

  startPaperQaRun(paperId: string, totalCount: number): PaperQaRunRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO paper_qa_runs (
          paper_id, status, completed_count, total_count, error_message, started_at, finished_at, updated_at, extra_json
        )
        VALUES (?, 'running', 0, ?, NULL, ?, NULL, ?, '{}')
        ON CONFLICT(paper_id) DO UPDATE SET
          status = 'running',
          completed_count = 0,
          total_count = excluded.total_count,
          error_message = NULL,
          started_at = excluded.started_at,
          finished_at = NULL,
          updated_at = excluded.updated_at
      `
      )
      .run(paperId, totalCount, now, now);

    const run = this.getPaperQaRun(paperId);
    if (!run) {
      throw new Error(`Paper QA run for ${paperId} was not found`);
    }
    return run;
  }

  updatePaperQaRunProgress(paperId: string, completedCount: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE paper_qa_runs
        SET completed_count = ?, updated_at = ?
        WHERE paper_id = ?
      `
      )
      .run(completedCount, now, paperId);
  }

  finishPaperQaRun(paperId: string, status: PaperQaRunStatus, completedCount: number, error?: string): PaperQaRunRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE paper_qa_runs
        SET status = ?, completed_count = ?, error_message = ?, finished_at = ?, updated_at = ?
        WHERE paper_id = ?
      `
      )
      .run(status, completedCount, error ?? null, now, now, paperId);

    const run = this.getPaperQaRun(paperId);
    if (!run) {
      throw new Error(`Paper QA run for ${paperId} was not found`);
    }
    return run;
  }

  getPaperQaRun(paperId: string): PaperQaRunRecord | null {
    const row = this.db.prepare("SELECT * FROM paper_qa_runs WHERE paper_id = ? LIMIT 1").get(paperId) as PaperQaRunRow | undefined;
    return row ? rowToPaperQaRun(row) : null;
  }

  getCachedPaperFullText(paper: Pick<Paper, "id" | "versionedId" | "pdfUrl">): CachedPaperFullText | null {
    const row = this.db
      .prepare("SELECT * FROM paper_full_text_cache WHERE paper_id = ? LIMIT 1")
      .get(paper.id) as PaperFullTextCacheRow | undefined;
    if (!row || row.versioned_id !== paper.versionedId || row.source_url !== paper.pdfUrl) {
      return null;
    }

    return {
      text: row.text,
      sourceUrl: row.full_text_source_url,
      contentHash: row.content_hash,
      updatedAt: row.updated_at
    };
  }

  upsertPaperFullTextCache(paper: Pick<Paper, "id" | "versionedId" | "pdfUrl">, fullText: CachedPaperFullText): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO paper_full_text_cache (
          paper_id, versioned_id, source_url, full_text_source_url, text, content_hash, created_at, updated_at, extra_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
        ON CONFLICT(paper_id) DO UPDATE SET
          versioned_id = excluded.versioned_id,
          source_url = excluded.source_url,
          full_text_source_url = excluded.full_text_source_url,
          text = excluded.text,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `
      )
      .run(paper.id, paper.versionedId, paper.pdfUrl, fullText.sourceUrl, fullText.text, fullText.contentHash, now, now);
  }

  createSyncRun(kind: SyncKind, config: Record<string, unknown>): SyncRun {
    const startedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `
        INSERT INTO sync_runs (kind, status, started_at, config_json, stats_json)
        VALUES (?, 'running', ?, ?, '{}')
      `
      )
      .run(kind, startedAt, JSON.stringify(config));

    return {
      id: Number(result.lastInsertRowid),
      kind,
      status: "running",
      startedAt,
      config,
      stats: {}
    };
  }

  finishSyncRun(id: number, status: "success" | "failed", stats: Record<string, unknown>, errorMessage?: string): SyncRun {
    const finishedAt = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE sync_runs
        SET status = ?, finished_at = ?, stats_json = ?, error_message = ?
        WHERE id = ?
      `
      )
      .run(status, finishedAt, JSON.stringify(stats), errorMessage ?? null, id);

    const run = this.getSyncRun(id);
    if (!run) {
      throw new Error(`Sync run ${id} was not found`);
    }
    return run;
  }

  getLatestSyncRun(kind?: SyncKind): SyncRun | null {
    const row = kind
      ? (this.db
          .prepare("SELECT * FROM sync_runs WHERE kind = ? ORDER BY id DESC LIMIT 1")
          .get(kind) as SyncRunRow | undefined)
      : (this.db.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").get() as SyncRunRow | undefined);

    return row ? rowToSyncRun(row) : null;
  }

  private getSyncRun(id: number): SyncRun | null {
    const row = this.db.prepare("SELECT * FROM sync_runs WHERE id = ?").get(id) as SyncRunRow | undefined;
    return row ? rowToSyncRun(row) : null;
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        versioned_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        affiliations_json TEXT NOT NULL DEFAULT '[]',
        published_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        primary_category TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        arxiv_url TEXT NOT NULL,
        pdf_url TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_sources (
        paper_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (paper_id, source_type, source_key),
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        config_json TEXT NOT NULL,
        stats_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS paper_translations (
        paper_id TEXT NOT NULL,
        language TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        affiliations_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (paper_id, language),
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS daily_snapshots (
        snapshot_date TEXT NOT NULL,
        paper_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (snapshot_date, paper_id, source_key),
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS paper_qa_answers (
        paper_id TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (paper_id, question_index),
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS paper_qa_runs (
        paper_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        completed_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS paper_full_text_cache (
        paper_id TEXT PRIMARY KEY,
        versioned_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        full_text_source_url TEXT NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_papers_published_at ON papers(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_paper_sources_lookup ON paper_sources(source_type, source_key, paper_id);
      CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_paper_translations_language ON paper_translations(language, paper_id);
      CREATE INDEX IF NOT EXISTS idx_daily_snapshots_lookup ON daily_snapshots(snapshot_date DESC, source_key, paper_id);
      CREATE INDEX IF NOT EXISTS idx_paper_qa_answers_lookup ON paper_qa_answers(paper_id, question_index);
      CREATE INDEX IF NOT EXISTS idx_paper_qa_runs_status ON paper_qa_runs(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_paper_full_text_cache_updated_at ON paper_full_text_cache(updated_at DESC);

      INSERT OR IGNORE INTO daily_snapshots (snapshot_date, paper_id, source_key, seen_at, extra_json)
      SELECT substr(last_seen_at, 1, 10), paper_id, source_key, last_seen_at, '{}'
      FROM paper_sources
      WHERE source_type = 'daily';
    `);

    this.addColumnIfMissing("papers", "affiliations_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("paper_translations", "affiliations_json", "TEXT NOT NULL DEFAULT '[]'");
  }

  private withTranslations(papers: Paper[]): Paper[] {
    if (papers.length === 0) {
      return papers;
    }

    const placeholders = papers.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `
        SELECT paper_id, language, title, summary, affiliations_json, updated_at
        FROM paper_translations
        WHERE paper_id IN (${placeholders})
      `
      )
      .all(...papers.map((paper) => paper.id)) as TranslationRow[];
    const translationsByPaper = new Map<string, Record<string, PaperTranslation>>();

    for (const row of rows) {
      const current = translationsByPaper.get(row.paper_id) ?? {};
      current[row.language] = {
        language: row.language,
        title: row.title,
        summary: row.summary,
        affiliations: parseJsonArray(row.affiliations_json),
        updatedAt: row.updated_at
      };
      translationsByPaper.set(row.paper_id, current);
    }

    return papers.map((paper) => ({
      ...paper,
      ...(translationsByPaper.has(paper.id) ? { translations: translationsByPaper.get(paper.id) } : {})
    }));
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
}

function rowToPaper(row: StoredPaperRow): Paper {
  const extra = parseJsonObject(row.extra_json);
  const huggingFaceUrl = typeof extra.huggingFaceUrl === "string" ? extra.huggingFaceUrl : undefined;
  const upvotes = typeof extra.upvotes === "number" ? extra.upvotes : undefined;
  const submittedBy = typeof extra.submittedBy === "string" ? extra.submittedBy : undefined;

  return {
    id: row.id,
    versionedId: row.versioned_id,
    title: row.title,
    summary: row.summary,
    authors: parseJsonArray(row.authors_json),
    affiliations: parseJsonArray(row.affiliations_json),
    published: row.published_at,
    updated: row.updated_at,
    primaryCategory: row.primary_category,
    categories: parseJsonArray(row.categories_json),
    arxivUrl: row.arxiv_url,
    pdfUrl: row.pdf_url,
    ...(huggingFaceUrl ? { huggingFaceUrl } : {}),
    ...(upvotes !== undefined ? { upvotes } : {}),
    ...(submittedBy ? { submittedBy } : {})
  };
}

function paperExtraJson(paper: Paper): Record<string, unknown> {
  return {
    ...(paper.huggingFaceUrl ? { huggingFaceUrl: paper.huggingFaceUrl } : {}),
    ...(paper.upvotes !== undefined ? { upvotes: paper.upvotes } : {}),
    ...(paper.submittedBy ? { submittedBy: paper.submittedBy } : {})
  };
}

function rowToPaperQaAnswer(row: PaperQaAnswerRow): PaperQaAnswer {
  return {
    questionIndex: row.question_index,
    question: row.question,
    answer: row.answer,
    updatedAt: row.updated_at
  };
}

function rowToPaperQaRun(row: PaperQaRunRow): PaperQaRunRecord {
  return {
    paperId: row.paper_id,
    status: row.status,
    completedCount: row.completed_count,
    totalCount: row.total_count,
    ...(row.error_message ? { error: row.error_message } : {}),
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    updatedAt: row.updated_at
  };
}

function rowToSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    config: parseJsonObject(row.config_json),
    stats: parseJsonObject(row.stats_json),
    ...(row.error_message ? { errorMessage: row.error_message } : {})
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toDateKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}
