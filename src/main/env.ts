// Environment reading for the composition roots. Values are read but never
// logged (GR-001); a missing required variable is a startup failure, not a
// silent default, so a misconfigured deploy fails loudly rather than running
// half-wired.

/** Reads a required variable, or exits the process naming only the KEY. */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    console.error(`missing required environment variable: ${key}`);
    process.exit(2);
  }
  return value;
}

/** Optional variable, undefined when unset/empty. */
export function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

/** PORT if set to a valid port, else the given default. */
export function portFromEnv(fallback: number): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    console.error(`PORT is not a valid port number: ${raw}`);
    process.exit(2);
  }
  return port;
}
