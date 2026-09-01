export const ARCHIVE_NOTICE_STATES = ["ACTIVE", "ENDED"] as const;

export type ArchiveNoticeState = (typeof ARCHIVE_NOTICE_STATES)[number];

export function parseArchiveNoticeState(
  value: unknown,
): ArchiveNoticeState | null {
  return typeof value === "string" &&
    (ARCHIVE_NOTICE_STATES as readonly string[]).includes(value)
    ? (value as ArchiveNoticeState)
    : null;
}
