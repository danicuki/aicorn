import type { Env } from "../env";

const SYSTEM_PROMPT = `You are an HTML-to-markdown extractor. The user gives you raw HTML.
Return ONLY the main article content as clean markdown. Strip navigation, ads,
cookie banners, footers, sidebars, scripts, and styles. Preserve headings, paragraphs,
lists, links, code blocks.

Output rules — follow exactly:
- Start IMMEDIATELY with the first markdown heading or paragraph.
- Do NOT prefix output with phrases like "Here is", "Here's", "Sure,", or "The markdown is".
- Do NOT add any commentary before or after the content.
- Do NOT wrap output in triple-backtick code fences.`;

// Llama 3.2 3b on Workers AI has a ~128k-token context. Reserve room for
// system prompt + max_tokens output; 200k chars (~50k tokens) leaves
// plenty of headroom for almost any single page.
const MAX_HTML_CHARS = 200_000;
const MAX_OUTPUT_TOKENS = 4096;

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

// Some models prefix output with meta-commentary like "Here is the extracted
// markdown content:" despite the system prompt forbidding it. Drop a leading
// line that looks like meta-commentary, plus any leading ``` fence.
function stripPreamble(md: string): string {
  let out = md.trimStart();
  out = out.replace(/^(here(?:'s| is)[^\n]*:?\s*\n+)/i, "");
  out = out.replace(/^(sure[,!][^\n]*\n+)/i, "");
  out = out.replace(/^```[a-z]*\s*\n/i, "").replace(/\n```\s*$/i, "");
  return out.trimStart();
}

export async function extractMarkdown(env: Env, html: string): Promise<string> {
  const cleaned = stripNoise(html);
  const truncated = cleaned.length > MAX_HTML_CHARS ? cleaned.slice(0, MAX_HTML_CHARS) : cleaned;
  const result = (await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: truncated },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  })) as { response?: string };
  const raw = result.response?.trim();
  if (!raw) throw new Error("empty extraction");
  return stripPreamble(raw);
}
