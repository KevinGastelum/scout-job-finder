import { useCallback, useEffect, useState } from "react";
import { APPLICATION_STATUSES, applicationProgress, type ApplicationStatus, type RunRecord } from "@scout/core";
import { fetchLatestRun, fetchShortlist, setStatus, triggerRun, type ShortlistEntry } from "./api";
import { dimensionRows, formatPostedAt, formatSalary, formatScore, hostOf, scoreTone } from "./format";

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

function Card({
  entry,
  onStatus,
}: {
  entry: ShortlistEntry;
  onStatus: (jobId: number, status: ApplicationStatus) => void;
}) {
  const { job, score } = entry;
  const now = new Date();
  const progress = applicationProgress(entry.applicationStatus);

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
        </div>
      </header>

      <p className="rationale">{score.rationale}</p>
      <p className="uncertainty">uncertainty: {score.uncertainty ?? "unknown"}</p>

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
          <button type="button" onClick={onScan} disabled={busy}>
            {busy ? "scanning…" : "Run scan"}
          </button>
        </div>
      </header>

      {run === null ? null : (
        <p className="run">
          last run #{run.id} · {run.status} · {run.stats.length} sources
        </p>
      )}
      {error === null ? null : <p className="error">{error}</p>}
      {entries.length === 0 ? <p className="empty">No scored jobs yet. Run a scan.</p> : null}

      {entries.map((entry) => (
        <Card key={entry.job.id} entry={entry} onStatus={onStatus} />
      ))}
    </main>
  );
}
