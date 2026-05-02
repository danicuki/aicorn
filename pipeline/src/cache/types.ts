export type CacheEntry = {
  markdown: string;
  contributor_user_id: string;
  extracted_at: number;
  source_etag: string | null;
  hit_count: number;
  original_html_tokens: number;
  extracted_tokens: number;
};
