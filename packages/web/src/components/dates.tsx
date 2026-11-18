import { ORG_TIME_ZONE, todayInOrg } from "@nmbm/shared";

// Every date on screen is written one way, 2026-11-18, and set in the design
// system's "numeric" style (IBM Plex Mono): dates are read aloud digit by
// digit, down the phone to a plan or a probation officer, and ISO reads the
// same to everyone and sorts the way it looks.
//
// An instant (when a note was written, when a link was made) is shown as the
// Long Beach day it fell on, not the browser's, so a note written at 11pm is
// not dated tomorrow on a laptop set to another zone. That is the same day
// the server uses for "today", so the two never disagree.

const time = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIME_ZONE, hour: "numeric", minute: "2-digit" });

/** The Long Beach day an instant fell on, as text, for titles and sentences. */
export function formatDay(at: string | Date): string {
  return todayInOrg(new Date(at));
}

/** The Long Beach day and time an instant fell on: "2026-11-18 2:05 PM". */
export function formatDayTime(at: string | Date): string {
  return `${formatDay(at)} ${time.format(new Date(at))}`;
}

/** A date that is already a day ("2026-11-18"): a date of service, a lease end. */
// Null renders nothing, as the bare value did before, so a missing date
// leaves the sentence around it to say so.
export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <time className="ds-num" dateTime={value}>
      {value}
    </time>
  );
}

/** An instant, shown as its Long Beach day, and the time when that matters. */
export function Timestamp({ at, withTime = false }: { at: string; withTime?: boolean }) {
  return (
    <time className="ds-num" dateTime={at}>
      {withTime ? formatDayTime(at) : formatDay(at)}
    </time>
  );
}
