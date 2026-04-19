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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 1. Weather — wttr.in (real-time, no key)
// ---------------------------------------------------------------------------

function detectWeatherLocation(query: string): string | null {
  const lower = query.toLowerCase().trim();
  if (!/\b(weather|temperature|temp\b|forecast|rain(?:ing)?|snow(?:ing)?|humid(?:ity)?|wind\s*speed|hot|cold|freezing|sunny|cloudy|thunder|storm|degrees?\s*(celsius|fahrenheit|c\b|f\b)|feels?\s*like|heat\s*index|uv\s*index)\b/.test(lower)) {
    return null;
  }
  const locPatterns = [
    /(?:weather|temperature|temp|forecast|rain(?:ing)?|hot|cold)\s+(?:in|at|for|near)\s+([a-z][a-z ,\-]+?)(?:\?|$|\s+(?:now|today|right now|currently))/i,
    /(?:in|at|for|near)\s+([a-z][a-z ,\-]+?)\s+(?:weather|temperature|temp|forecast|right now|currently|today)/i,
    /(?:what(?:'s| is)(?: the)?)\s+(?:weather|temperature|temp|forecast|it like)\s+(?:in|at|for)\s+([a-z][a-z ,\-]+?)(?:\?|$)/i,
    /(?:how (?:hot|cold|warm|cool) is it)\s+(?:in|at|near)\s+([a-z][a-z ,\-]+?)(?:\?|$)/i,
    /(?:is it (?:raining|snowing|sunny|cloudy|warm|hot|cold))\s+(?:in|at|near)\s+([a-z][a-z ,\-]+?)(?:\?|$)/i,
  ];
  for (const pat of locPatterns) {
    const m = query.match(pat);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return query.trim();
}

async function getWeather(location: string): Promise<SearchResult | null> {
  try {
    const encoded = encodeURIComponent(location);
    const res = await fetch(`https://wttr.in/${encoded}?format=j1`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`wttr.in ${res.status}`);
    const data = await res.json() as any;

    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!cur) return null;

    const areaName = area?.areaName?.[0]?.value ?? location;
    const country = area?.country?.[0]?.value ?? "";
    const displayLoc = country ? `${areaName}, ${country}` : areaName;

    const summary = [
      `current weather in ${displayLoc}:`,
      `condition: ${cur.weatherDesc?.[0]?.value ?? "unknown"}`,
      `temperature: ${cur.temp_C}°C / ${cur.temp_F}°F (feels like ${cur.FeelsLikeC}°C / ${cur.FeelsLikeF}°F)`,
      data.weather?.[0]?.maxtempC != null
        ? `today's range: ${data.weather[0].mintempC}°C–${data.weather[0].maxtempC}°C / ${data.weather[0].mintempF}°F–${data.weather[0].maxtempF}°F`
        : null,
      `humidity: ${cur.humidity}%`,
      `wind: ${cur.windspeedKmph} km/h ${cur.winddir16Point}`,
      `visibility: ${cur.visibility} km`,
      `uv index: ${cur.uvIndex}`,
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

// ---------------------------------------------------------------------------
// 2. Crypto prices — CoinGecko (real-time, no key)
// ---------------------------------------------------------------------------

const COIN_MAP: Record<string, string> = {
  bitcoin: "bitcoin", btc: "bitcoin",
  ethereum: "ethereum", eth: "ethereum",
  solana: "solana", sol: "solana",
  dogecoin: "dogecoin", doge: "dogecoin",
  ripple: "ripple", xrp: "ripple",
  cardano: "cardano", ada: "cardano",
  polkadot: "polkadot", dot: "polkadot",
  litecoin: "litecoin", ltc: "litecoin",
  "binance coin": "binancecoin", bnb: "binancecoin",
  tether: "tether", usdt: "tether",
  "shiba inu": "shiba-inu", shib: "shiba-inu",
  avalanche: "avalanche-2", avax: "avalanche-2",
  chainlink: "chainlink", link: "chainlink",
  matic: "matic-network", polygon: "matic-network",
  uniswap: "uniswap", uni: "uniswap",
};

function detectCryptoIds(query: string): string[] {
  const lower = query.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, id] of Object.entries(COIN_MAP)) {
    if (new RegExp(`\\b${keyword.replace(/[-]/g, "\\-")}\\b`).test(lower)) {
      found.add(id);
    }
  }
  return [...found];
}

function detectCurrencies(query: string): string[] {
  const lower = query.toLowerCase();
  const currencies: string[] = ["usd"];
  if (/\b(inr|rupee|india)\b/.test(lower)) currencies.push("inr");
  if (/\b(eur|euro)\b/.test(lower)) currencies.push("eur");
  if (/\b(gbp|pound|sterling)\b/.test(lower)) currencies.push("gbp");
  if (/\b(jpy|yen|japan)\b/.test(lower)) currencies.push("jpy");
  if (/\b(aud|australian)\b/.test(lower)) currencies.push("aud");
  if (/\b(cad|canadian)\b/.test(lower)) currencies.push("cad");
  return currencies;
}

async function getCryptoPrices(coinIds: string[], currencies: string[]): Promise<SearchResult | null> {
  try {
    const ids = coinIds.join(",");
    const vs = currencies.join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${vs}&include_24hr_change=true`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredBot/1.0)", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json() as Record<string, Record<string, number>>;

    const lines: string[] = [];
    for (const id of coinIds) {
      const prices = data[id];
      if (!prices) continue;
      const label = Object.keys(COIN_MAP).find(k => COIN_MAP[k] === id) ?? id;
      const parts = currencies
        .filter(c => prices[c] != null)
        .map(c => {
          const price = prices[c];
          const fmt = price >= 1 ? price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : price.toPrecision(4);
          return `${c.toUpperCase()} ${fmt}`;
        });
      const change = prices["usd_24h_change"];
      const changeStr = change != null ? ` (24h: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%)` : "";
      lines.push(`${label}: ${parts.join(" | ")}${changeStr}`);
    }

    if (lines.length === 0) return null;
    const answer = lines.join("\n") + "\nsource: CoinGecko (live)";
    return {
      query: coinIds.join(", "),
      answer,
      abstract: answer,
      abstractSource: "CoinGecko",
      abstractUrl: "https://www.coingecko.com",
      topics: [],
      results: [],
    };
  } catch (err: any) {
    log(`[Search] CoinGecko failed: ${err.message}`, "search");
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Stock / commodity / forex — Yahoo Finance (real-time, no key)
// ---------------------------------------------------------------------------

interface YahooSymbolDef { symbol: string; label: string }

const COMMODITY_MAP: { pattern: RegExp; def: YahooSymbolDef }[] = [
  { pattern: /\bgold\b/, def: { symbol: "GC=F", label: "Gold (USD/oz)" } },
  { pattern: /\bsilver\b/, def: { symbol: "SI=F", label: "Silver (USD/oz)" } },
  { pattern: /\bplatinum\b/, def: { symbol: "PL=F", label: "Platinum (USD/oz)" } },
  { pattern: /\bpalladium\b/, def: { symbol: "PA=F", label: "Palladium (USD/oz)" } },
  { pattern: /\b(crude\s*oil|crude|wti)\b/, def: { symbol: "CL=F", label: "WTI Crude Oil (USD/barrel)" } },
  { pattern: /\b(brent)\b/, def: { symbol: "BZ=F", label: "Brent Crude (USD/barrel)" } },
  { pattern: /\bnatural\s*gas\b/, def: { symbol: "NG=F", label: "Natural Gas (USD/MMBtu)" } },
  { pattern: /\bcopper\b/, def: { symbol: "HG=F", label: "Copper (USD/lb)" } },
  { pattern: /\b(s&p\s*500|sp500|s&p)\b/, def: { symbol: "^GSPC", label: "S&P 500" } },
  { pattern: /\b(dow\s*jones|dow)\b/, def: { symbol: "^DJI", label: "Dow Jones" } },
  { pattern: /\bnasdaq\b/, def: { symbol: "^IXIC", label: "NASDAQ" } },
  { pattern: /\bnifty\s*50\b|\bnifty\b/, def: { symbol: "^NSEI", label: "Nifty 50" } },
  { pattern: /\bsensex\b/, def: { symbol: "^BSESN", label: "Sensex" } },
];

const FOREX_PATTERNS: { pattern: RegExp; symbol: string; label: string }[] = [
  { pattern: /\b(usd\s*(?:to\s*)?inr|dollar\s*(?:to\s*)?rupee|rupee\s*(?:to\s*)?dollar)\b/i, symbol: "INR=X", label: "USD/INR" },
  { pattern: /\b(eur\s*(?:to\s*)?usd|euro\s*(?:to\s*)?dollar)\b/i, symbol: "EURUSD=X", label: "EUR/USD" },
  { pattern: /\b(gbp\s*(?:to\s*)?usd|pound\s*(?:to\s*)?dollar)\b/i, symbol: "GBPUSD=X", label: "GBP/USD" },
  { pattern: /\b(usd\s*(?:to\s*)?jpy|dollar\s*(?:to\s*)?yen)\b/i, symbol: "JPY=X", label: "USD/JPY" },
  { pattern: /\b(usd\s*(?:to\s*)?cad|dollar\s*(?:to\s*)?canadian)\b/i, symbol: "CAD=X", label: "USD/CAD" },
  { pattern: /\b(usd\s*(?:to\s*)?aud|dollar\s*(?:to\s*)?australian)\b/i, symbol: "AUD=X", label: "USD/AUD" },
  { pattern: /\b(eur\s*(?:to\s*)?inr|euro\s*(?:to\s*)?rupee)\b/i, symbol: "EURINR=X", label: "EUR/INR" },
  { pattern: /\b(gbp\s*(?:to\s*)?inr|pound\s*(?:to\s*)?rupee)\b/i, symbol: "GBPINR=X", label: "GBP/INR" },
];

function detectYahooSymbols(query: string): YahooSymbolDef[] {
  const lower = query.toLowerCase();
  const found: YahooSymbolDef[] = [];

  for (const { pattern, def } of COMMODITY_MAP) {
    if (pattern.test(lower)) found.push(def);
  }
  for (const { pattern, symbol, label } of FOREX_PATTERNS) {
    if (pattern.test(query)) found.push({ symbol, label });
  }
  return found;
}

async function getYahooFinance(defs: YahooSymbolDef[]): Promise<SearchResult | null> {
  try {
    const symbols = defs.map(d => d.symbol).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,currency,marketState`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Yahoo Finance ${res.status}`);
    const data = await res.json() as any;
    const results: any[] = data?.quoteResponse?.result ?? [];
    if (!results.length) return null;

    const lines: string[] = [];
    for (const r of results) {
      const def = defs.find(d => d.symbol === r.symbol);
      const label = def?.label ?? r.shortName ?? r.symbol;
      const price = r.regularMarketPrice;
      const currency = r.currency ?? "USD";
      const change = r.regularMarketChange;
      const changePct = r.regularMarketChangePercent;
      if (price == null) continue;

      const priceStr = price >= 1000
        ? price.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : price.toFixed(price >= 1 ? 2 : 4);

      const changeStr = change != null
        ? ` (${change >= 0 ? "+" : ""}${change.toFixed(2)} / ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`
        : "";
      lines.push(`${label}: ${currency} ${priceStr}${changeStr}`);
    }

    if (!lines.length) return null;
    const answer = lines.join("\n") + "\nsource: Yahoo Finance (live)";
    return {
      query: symbols,
      answer,
      abstract: answer,
      abstractSource: "Yahoo Finance",
      abstractUrl: "https://finance.yahoo.com",
      topics: [],
      results: [],
    };
  } catch (err: any) {
    log(`[Search] Yahoo Finance failed: ${err.message}`, "search");
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. General web search — DuckDuckGo HTML lite (real search results, no key)
// ---------------------------------------------------------------------------

async function scrapeDuckDuckGo(query: string): Promise<SearchResult> {
  const encoded = encodeURIComponent(query);

  // Use DuckDuckGo lite — minimal HTML, easy to parse, returns real search results
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`DuckDuckGo lite returned ${res.status}`);
  const html = await res.text();

  const results: { title: string; snippet: string; url: string }[] = [];

  // Extract result blocks: each result has a result-link, result-snippet, result-url
  const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  const urlRe = /<span[^>]+class="result-url"[^>]*>([\s\S]*?)<\/span>/gi;

  const links: { href: string; title: string }[] = [];
  const snippets: string[] = [];
  const urls: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push({ href: m[1], title: stripHtml(m[2]) });
  }
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(stripHtml(m[1]));
  }
  while ((m = urlRe.exec(html)) !== null) {
    urls.push(stripHtml(m[1]));
  }

  const count = Math.min(links.length, snippets.length, 6);
  for (let i = 0; i < count; i++) {
    const title = links[i].title;
    const snippet = snippets[i] ?? "";
    const url = urls[i] ?? links[i].href;
    if (title && snippet) {
      results.push({ title, snippet: snippet.slice(0, 350), url });
    }
  }

  // Also try to grab the "answer" from the instant answer box at the top
  const answerMatch = html.match(/<div[^>]+class="[^"]*zci[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const answer = answerMatch ? stripHtml(answerMatch[1]).slice(0, 300) || undefined : undefined;

  return {
    query,
    answer: answer || undefined,
    abstract: results[0] ? `${results[0].title}: ${results[0].snippet}` : undefined,
    abstractSource: "DuckDuckGo",
    topics: [],
    results,
  };
}

// ---------------------------------------------------------------------------
// 5. Brave Search (optional upgrade via env key)
// ---------------------------------------------------------------------------

async function braveSearch(query: string, apiKey: string): Promise<SearchResult> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
    {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error(`Brave Search ${res.status}`);
  const data = await res.json() as any;

  const webResults: any[] = data.web?.results ?? [];
  const results = webResults.slice(0, 6).map((r: any) => ({
    title: (r.title ?? "").slice(0, 120),
    snippet: (r.description ?? "").slice(0, 350),
    url: r.url ?? "",
  }));

  return {
    query,
    abstract: results[0] ? `${results[0].title}: ${results[0].snippet}` : undefined,
    abstractSource: "Brave Search",
    topics: [],
    results,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchWeb(query: string): Promise<SearchResult | null> {
  // 1. Weather
  const weatherLoc = detectWeatherLocation(query);
  if (weatherLoc) {
    const result = await getWeather(weatherLoc === query.trim() ? query : weatherLoc);
    if (result) return result;
  }

  // 2. Crypto prices (CoinGecko)
  const coinIds = detectCryptoIds(query);
  if (coinIds.length > 0) {
    const currencies = detectCurrencies(query);
    const result = await getCryptoPrices(coinIds, currencies);
    if (result) return result;
  }

  // 3. Stock / commodity / forex (Yahoo Finance)
  const yahooSymbols = detectYahooSymbols(query);
  if (yahooSymbols.length > 0) {
    const result = await getYahooFinance(yahooSymbols);
    if (result) return result;
  }

  // 4. General web search
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  try {
    if (braveKey) {
      log(`[Search] Brave Search for: ${query.slice(0, 60)}`, "search");
      return await braveSearch(query, braveKey);
    }
    log(`[Search] DuckDuckGo HTML for: ${query.slice(0, 60)}`, "search");
    return await scrapeDuckDuckGo(query);
  } catch (err: any) {
    log(`[Search] General search failed: ${err.message}`, "search");
    if (braveKey) {
      try { return await scrapeDuckDuckGo(query); } catch { return null; }
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
    lines.push(`top result${src}: ${result.abstract}`);
    if (result.abstractUrl) lines.push(`source url: ${result.abstractUrl}`);
  }

  if (result.results.length > 0) {
    lines.push("search results:");
    for (const r of result.results) {
      lines.push(`- ${r.title}`);
      lines.push(`  snippet: ${r.snippet}`);
      if (r.url) lines.push(`  url: ${r.url}`);
    }
  }

  if (result.topics.length > 0 && result.results.length === 0) {
    lines.push("related info:");
    for (const t of result.topics.slice(0, 4)) {
      lines.push(`- ${t.text}`);
      if (t.url) lines.push(`  url: ${t.url}`);
    }
  }

  if (lines.length === 1) lines.push("no results found.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Intent detection — returns query string if a live web lookup is needed
// ---------------------------------------------------------------------------

export function detectSearchIntent(message: string): string | null {
  const lower = message.toLowerCase().trim();
  const cleaned = lower
    .replace(/^(hey |hi |ok |okay |yo |uh |um )?(fred[,!]?\s*)?/, "")
    .replace(/^(can you |could you |please |pls )/, "")
    .trim();

  // Explicit search requests
  const explicitPatterns = [
    /^(?:search|google|bing)\s+(?:for\s+)?(.+)/i,
    /^(?:look up|lookup|find|look for)\s+(.+)/i,
    /^(?:search|find|look up|look for|look this up|check)\s+(?:me\s+)?(.+)/i,
  ];
  for (const pat of explicitPatterns) {
    const m = message.match(pat);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // Weather
  if (/\b(weather|temperature|temp\b|forecast|rain(?:ing)?|snow(?:ing)?|humid(?:ity)?|wind\s*speed|hot|cold|freezing|sunny|cloudy|thunder|storm|degrees?\s*(celsius|fahrenheit|c\b|f\b)|feels?\s*like|heat\s*index|uv\s*index)\b/.test(cleaned)) {
    return message.trim();
  }

  // Crypto
  if (detectCryptoIds(message).length > 0) return message.trim();

  // Commodities / forex / stocks
  if (detectYahooSymbols(message).length > 0) return message.trim();

  // General price queries
  if (/\b(price|prices|cost|costs|how much (?:is|does|do|are)|worth|value|rate|rates|exchange rate)\b/.test(cleaned)) {
    return message.trim();
  }

  // Sports scores / results
  if (/\b(score|scores|result|results|who won|who lost|match\s*(result|score)?|game\s*(score|result|today|tonight)?|standings|leaderboard|fixtures?|playing\s*(today|tonight|now)|vs\.?|versus|ipl|nba|nfl|nhl|mlb|premier\s*league|la\s*liga|bundesliga|serie\s*a|champions\s*league|world\s*cup|olympics?|cricket|football|soccer|basketball|tennis|formula\s*1|f1\b)\b/.test(cleaned)) {
    return message.trim();
  }

  // News / current events
  if (/\b(news|latest\s*(news|update|info)?|what(?:'s| is) happening|current\s*(events?|situation|status)|breaking|today(?:'s)?\s*(news|update)?|this\s*(week|month|year)(?:'s)?\s*(news|update)?|recently|just\s*(happened|announced|released|launched)|new\s+release|just\s+came\s+out)\b/.test(cleaned)) {
    return message.trim();
  }

  // Right now / currently
  if (/\bright\s*now\b|\bcurrently\b|\bas\s+of\s+(today|now)\b|\btoday\b|\bat\s+the\s+moment\b|\bthis\s+moment\b/.test(cleaned)) {
    return message.trim();
  }

  // Live / real-time signals
  if (/\b(live\s*(score|update|feed|data|stream)?|real[\s-]?time|up[\s-]?to[\s-]?date|updated|latest)\b/.test(cleaned)) {
    return message.trim();
  }

  // "What is X in [location]" for time-sensitive data
  if (/\b(what(?:'s| is)(?: the)?) .+\bin\b .+/i.test(cleaned) && /\b(time|date|temperature|temp|price|rate|cost|population|capital|president|prime\s*minister|leader|flag|currency|language|religion|gdp|inflation)\b/.test(cleaned)) {
    return message.trim();
  }

  // Who is the current X
  if (/\b(who is(?: the(?: current)?)?) (president|prime\s*minister|ceo|owner|leader|head|chancellor|king|queen|emperor|governor|mayor)\b/.test(cleaned)) {
    return message.trim();
  }

  // Latest software versions, patches
  if (/\b(current|latest)\s+(version|update|release|patch|build)\b/.test(cleaned)) {
    return message.trim();
  }

  // Population / economic stats
  if (/\b(population of|gdp of|inflation in|interest rate in|unemployment in)\b/.test(cleaned)) {
    return message.trim();
  }

  // "How much does X cost" / "what is the price of X"
  if (/\bhow much\b.+\bcost\b|\bwhat does\b.+\bcost\b|\bwhat(?:'s| is) the price\b/.test(cleaned)) {
    return message.trim();
  }

  return null;
}
