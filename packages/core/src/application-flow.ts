import type { ApplicationStatus } from "./types";

export type ApplicationStage =
  | "to-review"
  | "to-prepare"
  | "to-apply"
  | "waiting"
  | "action-needed"
  | "closed";

export interface ApplicationProgress {
  stage: ApplicationStage;
  nextAction: string;
}

// The eight stored statuses answer "where is this job", but the question worth sorting by is
// "whose move is it" — mine, theirs, or nobody's. That is a projection of the status, not a
// second thing to keep in sync, so it is derived rather than stored.
const PROGRESS: Record<ApplicationStatus, ApplicationProgress> = {
  shortlisted: { stage: "to-prepare", nextAction: "tailor resume and cover letter" },
  tailored: { stage: "to-apply", nextAction: "submit the application" },
  applied: { stage: "waiting", nextAction: "awaiting employer response" },
  response: { stage: "action-needed", nextAction: "reply and schedule" },
  interview: { stage: "action-needed", nextAction: "prepare for interview" },
  offer: { stage: "action-needed", nextAction: "decide on offer" },
  rejected: { stage: "closed", nextAction: "rejected" },
  dismissed: { stage: "closed", nextAction: "dismissed" },
};

export function applicationProgress(status: ApplicationStatus | null): ApplicationProgress {
  return status === null ? { stage: "to-review", nextAction: "review the posting" } : PROGRESS[status];
}
