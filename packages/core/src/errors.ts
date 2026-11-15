/** What went wrong, as text for a log line or a stored error. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
