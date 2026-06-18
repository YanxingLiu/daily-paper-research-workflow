import { type ReactNode } from "react";
import { Database, Loader2, RefreshCw, Rss, Search } from "lucide-react";

export function ArchiveControls({
  chips,
  query,
  queryPlaceholder,
  isLoading,
  isSyncing,
  syncDisabled,
  rssHref,
  extraAction,
  onQueryChange,
  onRefresh,
  onSync
}: {
  chips: string[];
  query: string;
  queryPlaceholder: string;
  isLoading: boolean;
  isSyncing: boolean;
  syncDisabled?: boolean;
  rssHref?: string;
  extraAction?: ReactNode;
  onQueryChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
}) {
  return (
    <section className="controls" aria-label="Archive controls">
      <div className="category-row">
        {chips.map((chip) => (
          <span className="chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>

      <div className="archive-control-grid">
        <label className="input-wrap search-input">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={queryPlaceholder} />
        </label>

        <button className="primary-button secondary-action" type="button" onClick={() => void onRefresh()} disabled={isLoading}>
          {isLoading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          <span>Refresh</span>
        </button>

        <button className="primary-button" type="button" onClick={() => void onSync()} disabled={isSyncing || syncDisabled}>
          {isSyncing ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Database size={16} aria-hidden="true" />}
          <span>Sync</span>
        </button>

        {extraAction}

        {rssHref ? (
          <a className="link-button rss-button" href={rssHref} target="_blank" rel="noreferrer" aria-label="RSS subscription">
            <Rss size={16} aria-hidden="true" />
            <span>RSS</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
