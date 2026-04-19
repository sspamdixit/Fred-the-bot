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

// --- wttr.in weather ---
async function getWeather(location: string): Promise<SearchResult | null> {
  try {
    const encoded = encodeURIComponent(location);
    const url = `https://wttr.in/${encoded}?format=j1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`wttr.in returned ${res.status}`);
    const data = await res.json() as any;

    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!current) return null;

    const areaName = area?.areaName?.[0]?.value ?? location;
    const country = area?.country?.[0]?.value ?? "";
    const displayLoc = country ? `${areaName}, ${country}` : areaName;

    const tempC = current.temp_C;
    const tempF = current.temp_F;
    const feelsC = current.FeelsLikeC;
    const feelsF = current.FeelsLikeF;
    const desc = current.weatherDesc?.[0]?.value ?? "unknown";
    const humidity = current.humidity;
    const windKph = current.windspeedKmph;
    const windDir = current.winddir16Point;
    const visibility = current.visibility;
    const uvIndex = current.uvIndex;

    const todayForecast = data.weather?.[0];
    const maxC = todayForecast?.maxtempC;
    const minC = todayForecast?.mintempC;
    const maxF = todayForecast?.maxtempF;
    const minF = todayForecast?.mintempF;

    const summary = [
      `current weather in ${displayLoc}:`,
      `condition: ${desc}`,
      `temperature: ${tempC}°C / ${tempF}°F (feels like ${feelsC}°C / ${feelsF}°F)`,
      maxC != null ? `today's range: ${minC}°C–${maxC}°C / ${minF}°F–${maxF}°F` : null,
      `humidity: ${humidity}%`,
      `wind: ${windKph} km/h ${windDir}`,
      `visibility: ${visibility} km`,
      `uv index: ${uvIndex}`,
    ].filter(Boolean).join("\n");

    return {
      query: `weather in ${location}`,
      answer: summary,
      abstract: summary,
      abstractSource: "wttr.in",
      abstractUrl: `https://wttr.in/${encoded}`,
      topics: [],
      results: [],
    };
  } catch (err: any) {
    log(`[Search] wttr.in failed for "${location}": ${err.message}`, "search");
    return null;
  }
}

// --- DuckDuckGo Instant Answer ---
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

// --- Brave Search ---
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

  const abstract = results[0]?.snippet;

  return { query, abstract, topics: [], results };
}

// --- Detect weather query and extract location ---
function detectWeatherQuery(message: string): string | null {
  const lower = message.toLowerCase().trim();

  const patterns = [
    /\b(?:weather|temperature|temp|forecast|rain(?:ing)?|snow(?:ing)?|humid(?:ity)?|wind|hot|cold|freezing|sunny|cloudy|storm(?:y)?|thunder(?:storm)?|degrees?|celsius|fahrenheit|feels? like)\b/,
  ];

  if (!patterns[0].test(lower)) return null;

  // Try to extract a location
  const locationPatterns = [
    /(?:weather|temperature|temp|forecast|rain(?:ing)?|hot|cold)\s+(?:in|at|for|near)\s+([a-z ,]+?)(?:\?|$|now|today|right now|currently)/i,
    /(?:in|at|for|near)\s+([a-z ,]+?)\s+(?:weather|temperature|temp|forecast|right now|currently|today)/i,
    /(?:what(?:'s| is)(?: the)?) (?:weather|temperature|temp|forecast|it like) (?:in|at|for)\s+([a-z ,]+?)(?:\?|$)/i,
    /(?:how (?:hot|cold|warm|cool) is it)(?: in| at| near)?\s+([a-z ,]+?)(?:\?|$)/i,
    /(?:is it (?:raining|snowing|sunny|cloudy|warm|hot|cold)) (?:in|at|near)\s+([a-z ,]+?)(?:\?|$)/i,
  ];

  for (const pat of locationPatterns) {
    const m = message.match(pat);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // If weather keywords found but no extractable location, return full message as query
  return message.trim();
}

export async function searchWeb(query: string): Promise<SearchResult | null> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  // Route weather queries to wttr.in first
  const weatherLocation = detectWeatherQuery(query);
  if (weatherLocation) {
    const location = weatherLocation === query.trim() ? query.trim() : weatherLocation;
    const weatherResult = await getWeather(location);
    if (weatherResult) return weatherResult;
    // fall through to general search if wttr.in fails
  }

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

  if (result.abstract && result.abstract !== result.answer) {
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

// Returns the search query to use if the message needs a web lookup, or null if AI can answer from knowledge
export function detectSearchIntent(message: string): string | null {
  const lower = message.toLowerCase().trim();
  // Strip common filler at the start
  const cleaned = lower
    .replace(/^(hey |hi |ok |okay |yo |uh |um )?(fred[,!]?\s*)?/, "")
    .replace(/^(can you |could you |please |pls )/, "")
    .trim();

  // --- Explicit search requests ---
  const explicitPatterns = [
    /^(?:search|google|bing)\s+(?:for\s+)?(.+)/i,
    /^(?:look up|lookup|find|look for)\s+(.+)/i,
    /^(?:search|find|look up|look for|look this up|check)\s+(?:me\s+)?(.+)/i,
  ];
  for (const pat of explicitPatterns) {
    const m = message.match(pat);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // --- Weather ---
  if (/\b(weather|temperature|temp\b|forecast|rain(?:ing)?|snow(?:ing)?|humid(?:ity)?|wind\s*speed|hot|cold|freezing|sunny|cloudy|thunder|storm|degrees?\s*(celsius|fahrenheit|c\b|f\b)|feels?\s*like|heat\s*index|uv\s*index)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- Prices / markets ---
  if (/\b(price|prices|cost|costs|how much (?:is|does|do|are)|worth|value|rate|rates|exchange rate)\b/.test(cleaned)) {
    return message.trim();
  }
  if (/\b(gold|silver|platinum|oil|crude|bitcoin|btc|ethereum|eth|crypto|cryptocurrency|stock|stocks|shares?|market cap|nasdaq|dow jones|s&p|nifty|sensex|forex|rupee|dollar|euro|pound|yen|currency)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- Sports scores / results ---
  if (/\b(score|scores|result|results|who won|who lost|match\s*(result|score)?|game\s*(score|result|today|tonight)?|standings|leaderboard|fixtures?|playing\s*(today|tonight|now)|vs\.?|versus|ipl|nba|nfl|nhl|mlb|premier\s*league|la\s*liga|bundesliga|serie\s*a|champions\s*league|world\s*cup|olympics?|cricket|football|soccer|basketball|tennis|formula\s*1|f1\b)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- News / current events ---
  if (/\b(news|latest\s*(news|update|info)?|what(?:'s| is) happening|current\s*(events?|situation|status)|breaking|today(?:'s)?\s*(news|update)?|this\s*(week|month|year)(?:'s)?\s*(news|update)?|recently|just\s*(happened|announced|released|launched)|new\s+release|just\s+came\s+out)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- "Right now / currently / today" + info ---
  if (/\bright\s*now\b|\bcurrently\b|\bas\s+of\s+(today|now)\b|\btoday\b|\bat\s+the\s+moment\b|\bthis\s+moment\b/.test(cleaned)) {
    return message.trim();
  }

  // --- Live / real-time data signals ---
  if (/\b(live\s*(score|update|feed|data|stream)?|real[\s-]?time|up[\s-]?to[\s-]?date|updated|latest)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- "What is X in [location]" / "X in [location]" patterns for data that varies by place ---
  if (/\b(what(?:'s| is)(?: the)?) .+\bin\b .+/i.test(cleaned) && /\b(time|date|temperature|temp|price|rate|cost|population|capital|president|prime\s*minister|leader|flag|currency|language|religion|gdp|inflation)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- Specific factual lookups that change over time ---
  if (/\b(who is(?: the(?: current)?)?) (president|prime\s*minister|ceo|owner|leader|head|chancellor|king|queen|emperor|governor|mayor)\b/.test(cleaned)) {
    return message.trim();
  }
  if (/\b(current|latest)\s+(version|update|release|patch|build)\b/.test(cleaned)) {
    return message.trim();
  }
  if (/\b(population of|gdp of|inflation in|interest rate in|unemployment in)\b/.test(cleaned)) {
    return message.trim();
  }

  // --- "How much does X cost" / "what does X cost" ---
  if (/\bhow much\b.+\bcost\b|\bwhat does\b.+\bcost\b|\bwhat(?:'s| is) the price\b/.test(cleaned)) {
    return message.trim();
  }

  return null;
}
