export type FeatureRequest = {
  method: string;
  path: string[];
  body: Record<string, unknown>;
  query: URLSearchParams;
  signal: AbortSignal;
};
