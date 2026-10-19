/** Production uses the configured origin or Next's URL. Development also accepts
 * the actual request Host, because Next may construct its URL with 0.0.0.0. */
export function isAllowedOrigin(
  origin: string | null,
  requestOrigin: string,
  host: string | null,
  configuredOrigin: string | undefined,
  development: boolean,
): boolean {
  if (!origin) return false;
  if (configuredOrigin) return origin === configuredOrigin;
  if (origin === requestOrigin) return true;
  if (!development || !host) return false;
  try {
    const actual = new URL(origin);
    const request = new URL(requestOrigin);
    return (
      origin === actual.origin &&
      actual.host === host &&
      actual.protocol === request.protocol
    );
  } catch {
    return false;
  }
}
