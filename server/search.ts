import { log } from "./index";

export interface SearchResult {
  query: string;
  answer?: string;
  abstract?: string;
  abstractSource?: string;
  abstractUrl?: string;
  topics: { text: string; url?: string }[];
  results: { title: string; snippet: string; url: string }[];
}

async function duckduckgoSearch(query: string): Promise<SearchResult> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FredBot/1.0)" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`DuckDuckGo API returned ${res.status}`);

  const data = await res.json() as any;

  const answer = data.Answer?.trim() || undefined;
  const abstract = data.Abstract?.trim() || undefined;
  const abstractSource = data.AbstractSource?.trim() || undefined;
  const abstractUrl = data.AbstractURL?.trim() || undefined;

  const topics: { text: string; url?: string }[] = [];
  if (Array.isArray(data.RelatedTopics)) {
    for (const t of data.RelatedTopics.slice(0, 6)) {
      if (t.Text && typeof t.Text === "string") {
        topics.push({ text: t.Text.slice(0, 200), url: t.FirstURL });
      } else if (t.Topics && Array.isArray(t.Topics)) {
        for (const sub of t.Topics.slice(0, 3)) {
          if (sub.Text) topics.push({ text: sub.Text.slice(0, 200), url: sub.FirstURL });
        }
      }
    }
  }

  const results: { title: string; snippet: string; url: string }[] = [];
  if (Array.isArray(data.Results)) {
    for (const r of data.Results.slice(0, 5)) {
      if (r.Text && r.FirstURL) {
        results.push({ title: r.Text.slice(0, 100), snippet: r.Text.slice(0, 300), url: r.FirstURL });
      }
    }
  }

  return { query, answer, abstract, abstractSource, abstractUrl, topics, results };
}

async function braveSearch(query: string, apiKey: string): Promise<SearchResult> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=5`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Brave Search API returned ${res.status}`);

  const data = await res.json() as any;

  const results: { title: string; snippet: string; url: string }[] = [];
  if (data.web?.results) {
    for (const r of data.web.results.slice(0, 5)) {
      results.push({
        title: (r.title ?? "").slice(0, 100),
        snippet: (r.description ?? "").slice(0, 300),
        url: r.url ?? "",
      });
    }
  }

  const answer = data.query?.spellcheck_off ? undefined : data.query?.original;
  const abstract = results[0]?.snippet;

  return { query, answer, abstract, topics: [], results };
}

export async function searchWeb(query: string): Promise<SearchResult | null> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  try {
    if (braveKey) {
      log(`[Search] Using Brave Search for: ${query.slice(0, 60)}`, "search");
      return await braveSearch(query, braveKey);
    }

    log(`[Search] Using DuckDuckGo for: ${query.slice(0, 60)}`, "search");
    return await duckduckgoSearch(query);
  } catch (err: any) {
    log(`[Search] Search failed: ${err.message}`, "search");
    if (braveKey) {
      try {
        log(`[Search] Brave failed — falling back to DuckDuckGo.`, "search");
        return await duckduckgoSearch(query);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function formatSearchResultsForAI(result: SearchResult): string {
  const lines: string[] = [`[web search results for: "${result.query}"]`];

  if (result.answer) {
    lines.push(`direct answer: ${result.answer}`);
  }

  if (result.abstract) {
    const src = result.abstractSource ? ` (via ${result.abstractSource})` : "";
    lines.push(`summary${src}: ${result.abstract}`);
    if (result.abstractUrl) lines.push(`source: ${result.abstractUrl}`);
  }

  if (result.results.length > 0) {
    lines.push("search results:");
    for (const r of result.results) {
      lines.push(`- ${r.title}: ${r.snippet}`);
      lines.push(`  url: ${r.url}`);
    }
  }

  if (result.topics.length > 0 && result.results.length === 0) {
    lines.push("related info:");
    for (const t of result.topics.slice(0, 4)) {
      lines.push(`- ${t.text}`);
      if (t.url) lines.push(`  url: ${t.url}`);
    }
  }

  if (lines.length === 1) {
    lines.push("no results found.");
  }

  return lines.join("\n");
}

export function detectSearchIntent(message: string): string | null {
  const lower = message.toLowerCase().trim();

  const explicitPatterns = [
    /^search(?:\s+for)?\s+(.+)/i,
    /^(?:google|look up|lookup|find)\s+(.+)/i,
    /^(?:what(?:'s| is) (?:the latest|happening|going on)(?: with)?(?: in)?)(.+)/i,
    /^(?:search|find|look up) me\s+(.+)/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = lower.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  const searchKeywords = [
    /\b(?:search for|google|look up|look this up|find info(?:rmation)? (?:on|about)|find out about)\b/i,
    /\b(?:what(?:'s| is) (?:the )?(?:latest|current|recent|newest|updated?) (?:news|info|update|status))\b/i,
    /\b(?:any (?:news|updates?) (?:on|about))\b/i,
    /\b(?:check (?:the )?(?:web|internet|online) for)\b/i,
  ];

  for (const kw of searchKeywords) {
    if (kw.test(lower)) {
      return message.trim();
    }
  }

  return null;
}
