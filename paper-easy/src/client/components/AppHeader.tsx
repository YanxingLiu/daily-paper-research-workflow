import { CalendarDays, Languages, Moon, Sun } from "lucide-react";
import type { AppConfigResponse, AuthorPapersResponse, HuggingFacePapersResponse, PapersResponse, SyncRun } from "../../shared/types";
import type { ThemeMode, UiLanguage, ViewMode } from "../types";
import { formatDate, formatDateOnly } from "../utils";

type AppHeaderProps = {
  viewMode: ViewMode;
  config: AppConfigResponse;
  activeData: PapersResponse | AuthorPapersResponse | HuggingFacePapersResponse | null;
  lastSync: SyncRun | null;
  theme: ThemeMode;
  language: UiLanguage;
  dailyDate: string;
  huggingFaceDate: string;
  dailyDates: string[];
  huggingFaceDates: string[];
  isLoading: boolean;
  isHuggingFaceLoading: boolean;
  onToggleTheme: () => void;
  onLanguageChange: (language: UiLanguage) => void;
  onDailyDateChange: (value: string) => void;
  onHuggingFaceDateChange: (value: string) => void;
};

export function AppHeader({
  viewMode,
  config,
  activeData,
  lastSync,
  theme,
  language,
  dailyDate,
  huggingFaceDate,
  dailyDates,
  huggingFaceDates,
  isLoading,
  isHuggingFaceLoading,
  onToggleTheme,
  onLanguageChange,
  onDailyDateChange,
  onHuggingFaceDateChange
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div>
        <a className="brand" href="/">
          <img src="/papers-easy-logo.svg" alt="" aria-hidden="true" />
          <span>Papers Easy</span>
        </a>
        <p className="subtitle">
          {viewMode === "daily"
            ? "arXiv daily archive"
            : viewMode === "authors"
              ? "arXiv author archive"
              : "Hugging Face daily papers"}
        </p>
      </div>
      <div className="header-actions">
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
          {theme === "light" ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          <span>{theme === "light" ? "Dark" : "Light"}</span>
        </button>
        {viewMode === "daily" ? (
          <label className="daily-date-picker" aria-label="arXiv daily date">
            <CalendarDays size={16} aria-hidden="true" />
            <select value={dailyDate} onChange={(event) => onDailyDateChange(event.target.value)} disabled={isLoading || dailyDates.length === 0}>
              <option value="">{isPapersResponse(activeData) && activeData.selectedDate ? `Latest ${formatDateOnly(activeData.selectedDate)}` : "Latest"}</option>
              {dailyDates.map((date) => (
                <option value={date} key={date}>
                  {formatDateOnly(date)}
                </option>
              ))}
            </select>
          </label>
        ) : viewMode === "huggingface" ? (
          <label className="daily-date-picker" aria-label="Hugging Face daily date">
            <CalendarDays size={16} aria-hidden="true" />
            <select
              value={huggingFaceDate}
              onChange={(event) => onHuggingFaceDateChange(event.target.value)}
              disabled={isHuggingFaceLoading || huggingFaceDates.length === 0}
            >
              <option value="">
                {isHuggingFaceResponse(activeData) && activeData.selectedDate ? `Latest ${formatDateOnly(activeData.selectedDate)}` : "Latest"}
              </option>
              {huggingFaceDates.map((date) => (
                <option value={date} key={date}>
                  {formatDateOnly(date)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="language-switch" aria-label="Language switch">
          <Languages size={16} aria-hidden="true" />
          <button className={language === "en" ? "active" : ""} type="button" onClick={() => onLanguageChange("en")}>
            EN
          </button>
          <button className={language === "zh" ? "active" : ""} type="button" onClick={() => onLanguageChange("zh")}>
            中
          </button>
        </div>
        <div className="status-line">
          <span>{activeData ? formatDate(activeData.updatedAt) : "Not loaded"}</span>
          <span>Unique: {activeData?.totalUnique ?? 0}</span>
          <span>Sync: {lastSync?.finishedAt ? formatDate(lastSync.finishedAt) : `daily ${config.syncTime}`}</span>
        </div>
      </div>
    </header>
  );
}

export function ViewTabs({ viewMode, onViewModeChange }: { viewMode: ViewMode; onViewModeChange: (viewMode: ViewMode) => void }) {
  return (
    <nav className="view-tabs" aria-label="Paper views">
      <button className={`tab-button${viewMode === "daily" ? " active" : ""}`} type="button" onClick={() => onViewModeChange("daily")}>
        arxiv-daily
      </button>
      <button className={`tab-button${viewMode === "authors" ? " active" : ""}`} type="button" onClick={() => onViewModeChange("authors")}>
        arxiv-authors
      </button>
      <button className={`tab-button${viewMode === "huggingface" ? " active" : ""}`} type="button" onClick={() => onViewModeChange("huggingface")}>
        huggingface-daily
      </button>
    </nav>
  );
}

function isPapersResponse(value: AppHeaderProps["activeData"]): value is PapersResponse {
  return Boolean(value && "categories" in value);
}

function isHuggingFaceResponse(value: AppHeaderProps["activeData"]): value is HuggingFacePapersResponse {
  return Boolean(value && value.source === "huggingface");
}
