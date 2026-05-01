import type { Env } from "../env";

const SYSTEM_PROMPT = `You are an HTML-to-markdown extractor. The user gives you raw HTML.
Return ONLY the main article content as clean markdown. Strip navigation, ads,
cookie banners, footers, sidebars, scripts, and styles. Preserve headings, paragraphs,
lists, links, code blocks. Do not add commentary. Do not wrap output in code fences.`;

const MAX_HTML_CHARS = 60_000; // keep prompt under model context

export async function extractMarkdown(env: Env, html: string): Promise<string> {
  const truncated = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: truncated },
    ],
  })) as { response?: string };
  const md = result.response?.trim();
  if (!md) throw new Error("empty extraction");
  return md;
}
