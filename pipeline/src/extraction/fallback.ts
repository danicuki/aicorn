// Canned markdown for the on-stage demo URL. If Workers AI fails, we serve this
// so the demo doesn't fall over. Pre-warmed by scripts/prewarm.sh anyway.

const FALLBACK_MARKDOWN = `# Article Title Goes Here

PASTE THE REAL HAND-CLEANED MARKDOWN HERE BEFORE THE DEMO.

This text is what judges will see if Workers AI is flaky. Make it look like a real article body.`;

export function fallbackForDemoUrl(url: string, demoUrl: string): string | null {
  if (url === demoUrl) return FALLBACK_MARKDOWN;
  return null;
}
