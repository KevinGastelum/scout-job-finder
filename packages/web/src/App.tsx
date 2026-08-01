import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APPLICATION_STATUSES,
  applicationProgress,
  type ApplicationStage,
  type ApplicationStatus,
  type RunRecord,
} from "@scout/core";
import {
  fetchDrafts,
  fetchLatestRun,
  fetchShortlist,
  saveNotes,
  setStatus,
  tailorJob,
  triggerRun,
  type Draft,
  type ShortlistEntry,
} from "./api";
import { dimensionRows, formatPostedAt, formatSalary, formatScore, hostOf, scoreTone } from "./format";

const STAGE_ORDER: ApplicationStage[] = [
  "to-review",
  "to-prepare",
  "to-apply",
  "waiting",
  "action-needed",
  "closed",
];

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

function daysAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

function Card({
  entry,
  onStatus,
  onNotes,
  onReload,
}: {
  entry: ShortlistEntry;
  onStatus: (jobId: number, status: ApplicationStatus) => void;
  onNotes: (jobId: number, notes: string) => void;
  onReload: () => void;
}) {
  const { job, score } = entry;
  const now = new Date();
  const progress = applicationProgress(entry.applicationStatus);

  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);

  const toggleDrafts = () => {
    const next = !showDrafts;
    setShowDrafts(next);
    if (next && drafts === null) {
      fetchDrafts(job.id)
        .then(setDrafts)
        .catch((cause) => setDraftsError(cause instanceof Error ? cause.message : String(cause)));
    }
  };

  const onTailor = (force: boolean) => {
    setTailoring(true);
    setDraftsError(null);
    tailorJob(job.id, force)
      .then((fresh) => {
        setDrafts(fresh);
        onReload();
      })
      .catch((cause) => setDraftsError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setTailoring(false));
  };

  return (
    <article className={`card tone-${scoreTone(score.rubricScore)}`}>
      <header className="card-head">
        <div className="score">{formatScore(score.rubricScore)}</div>
        <div className="headline">
          <h2>{job.title}</h2>
          <p className="meta">
            {job.company} · {job.location ?? (job.remote ? "Remote" : "location unstated")}
            {entry.alsoPostedIn > 0 ? ` (+${entry.alsoPostedIn} more)` : ""} ·{" "}
            {formatSalary(job.salaryText)} · {formatPostedAt(job.postedAt, now)} ·{" "}
            <a href={job.url} target="_blank" rel="noreferrer noopener">
              {hostOf(job.url)}
            </a>
          </p>
          <p className="tags">
            <span className="badge source">{job.source}</span>
            {job.remote ? <span className="badge">remote</span> : null}
            {job.titleFamily === null ? null : <span className="badge">{job.titleFamily}</span>}
            {job.seniority === null ? null : <span className="badge">{job.seniority}</span>}
            {entry.appliedAt !== null &&
            (progress.stage === "waiting" || progress.stage === "action-needed") ? (
              <span className="badge aging">applied {daysAgo(entry.appliedAt, now)}d ago</span>
            ) : null}
          </p>
        </div>
        <div className="actions">
          <span className={`stage stage-${progress.stage}`}>{progress.stage}</span>
          <span className="next-action">{progress.nextAction}</span>
          <select
            aria-label={`status for ${job.title} at ${job.company}`}
            value={entry.applicationStatus ?? ""}
            onChange={(event) => {
              if (isApplicationStatus(event.target.value)) onStatus(job.id, event.target.value);
            }}
          >
            {/* Disabled because there is no endpoint that clears a status — offering the choice
                would look like it worked and silently revert on the next reload. */}
            <option value="" disabled>
              not tracked
            </option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button type="button" className="drafts-toggle" onClick={toggleDrafts}>
            {showDrafts ? "hide drafts" : "drafts"}
          </button>
        </div>
      </header>

      <p className="rationale">{score.rationale}</p>
      <p className="uncertainty">uncertainty: {score.uncertainty ?? "unknown"}</p>

      {showDrafts ? (
        <div className="drafts">
          {draftsError === null ? null : <p className="error">{draftsError}</p>}
          {drafts === null ? (
            <p className="drafts-empty">loading…</p>
          ) : drafts.length === 0 ? (
            <p className="drafts-empty">no drafts yet — tailor this job to write them.</p>
          ) : (
            drafts.map((draft) => (
              <details key={draft.name} open={draft.name === "cover-letter.md"}>
                <summary>{draft.name}</summary>
                <pre className="draft-body">{draft.content}</pre>
              </details>
            ))
          )}
          {drafts === null ? null : (
            <button type="button" disabled={tailoring} onClick={() => onTailor(drafts.length > 0)}>
              {tailoring
                ? "tailoring…"
                : drafts.length > 0
                  ? "Re-tailor (overwrites the draft)"
                  : "Tailor now"}
            </button>
          )}
        </div>
      ) : null}

      <textarea
        className="notes"
        placeholder="notes — contacts, follow-ups, next steps"
        defaultValue={entry.notes ?? ""}
        onBlur={(event) => {
          if (event.target.value !== (entry.notes ?? "")) onNotes(job.id, event.target.value);
        }}
      />

      <table className="dimensions">
        <tbody>
          {dimensionRows(score.dimensions).map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td className="dim-score">{row.score}/10</td>
              <td>
                <span className="note">{row.note}</span>
                <ul className="evidence">
                  {row.evidence.map((quote) => (
                    <li key={quote}>“{quote}”</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export default function App() {
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<ApplicationStage | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    try {
      setEntries(await fetchShortlist(includeDismissed));
      setRun(await fetchLatestRun());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [includeDismissed]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A scan runs detached for the better part of an hour; polling while one is live keeps
  // the run line and the button honest without hammering an idle server.
  const scanRunning = run?.status === "running";
  useEffect(() => {
    if (!scanRunning) return;
    const timer = setInterval(() => void reload(), 30_000);
    return () => clearInterval(timer);
  }, [scanRunning, reload]);

  const onStatus = useCallback(
    (jobId: number, status: ApplicationStatus) => {
      void (async () => {
        try {
          await setStatus(jobId, status);
          await reload();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [reload],
  );

  const onNotes = useCallback((jobId: number, notes: string) => {
    void saveNotes(jobId, notes).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const onScan = useCallback(() => {
    void (async () => {
      setBusy(true);
      try {
        await triggerRun();
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, [reload]);

  const stageCounts = useMemo(() => {
    const counts = new Map<ApplicationStage, number>();
    for (const entry of entries) {
      const stage = applicationProgress(entry.applicationStatus).stage;
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const sources = useMemo(
    () => [...new Set(entries.map((entry) => entry.job.source))].sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (stageFilter !== null && applicationProgress(entry.applicationStatus).stage !== stageFilter)
        return false;
      if (sourceFilter !== "" && entry.job.source !== sourceFilter) return false;
      if (
        needle !== "" &&
        !entry.job.company.toLowerCase().includes(needle) &&
        !entry.job.title.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [entries, stageFilter, sourceFilter, query]);

  return (
    <main>
      <header className="top">
        <h1>Today</h1>
        <div className="controls">
          <label>
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(event) => setIncludeDismissed(event.target.checked)}
            />{" "}
            show dismissed
          </label>
          <button type="button" onClick={onScan} disabled={busy || scanRunning}>
            {scanRunning ? "scanning…" : busy ? "starting…" : "Run scan"}
          </button>
        </div>
      </header>

      <div className="pipeline">
        {STAGE_ORDER.map((stage) => (
          <button
            key={stage}
            type="button"
            className={`chip stage-${stage}${stageFilter === stage ? " active" : ""}`}
            onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
          >
            {stage} <strong>{stageCounts.get(stage) ?? 0}</strong>
          </button>
        ))}
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="search company or title"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="">all sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <span className="visible-count">
          {visible.length} of {entries.length}
        </span>
      </div>

      {run === null ? null : (
        <p className="run">
          last run #{run.id} · {run.status} · {run.stats.length} sources
        </p>
      )}
      {error === null ? null : <p className="error">{error}</p>}
      {entries.length === 0 ? <p className="empty">No scored jobs yet. Run a scan.</p> : null}

      {visible.map((entry) => (
        <Card
          key={entry.job.id}
          entry={entry}
          onStatus={onStatus}
          onNotes={onNotes}
          onReload={() => void reload()}
        />
      ))}
    </main>
  );
}
