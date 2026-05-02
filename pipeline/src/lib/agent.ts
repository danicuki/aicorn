const AGENT_UA_PATTERNS = [
  /ClaudeBot/i,
  /GPTBot/i,
  /PerplexityBot/i,
  /Anthropic/i,
  /OpenAI/i,
  /CCBot/i,
  /Google-Extended/i,
];

export function detectAgent(headers: Headers): boolean {
  if (headers.get("X-Agent")?.toLowerCase() === "true") return true;
  const ua = headers.get("User-Agent") ?? "";
  return AGENT_UA_PATTERNS.some((re) => re.test(ua));
}
