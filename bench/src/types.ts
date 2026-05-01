export type Pipe = "aicorn" | "raw_html" | "turndown";

export type Sample = {
  pipe: Pipe;
  ok: boolean;
  status: number;
  bytes: number;
  tokens: number;          // chars/4 heuristic — same denominator across pipes for fairness
  cost_usd: number;        // priced as Claude API input
  duration_ms: number;
  error?: string;
};

export type UrlResult = {
  url: string;
  samples: Record<Pipe, Sample>;
};

export type Report = {
  started_at: string;
  finished_at: string;
  worker_url: string;
  username: string;
  input_price_per_million_usd: number;
  results: UrlResult[];
};
