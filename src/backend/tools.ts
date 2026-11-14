import { Type, type FunctionDeclaration } from "@google/genai";

/** Tools the model can choose to call. The model decides which, when, and how often. */
export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "web_search",
    description:
      "Search the web and return the top results (title, URL, short snippet). Use specific queries. Call it several times with different angles.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "A specific web search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Download and read the full text of a web page (use a URL returned by web_search). Use it when a snippet looks promising but too short.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "Full http(s) URL to read" },
      },
      required: ["url"],
    },
  },
  {
    name: "finish_report",
    description:
      "Submit the final Markdown research report and end the task. Call this only when you have enough evidence.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        report: { type: Type.STRING, description: "The complete Markdown report" },
      },
      required: ["report"],
    },
  },
];

export interface ToolOutput {
  /** Text handed back to the model */
  forModel: string;
  /** Short line shown in the UI */
  summary: string;
}

const MAX_PAGE_CHARS = 6000;

async function webSearch(query: string): Promise<ToolOutput> {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is missing. Add it to your .env file.");
  }
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5 }),
  });
  if (!response.ok) {
    throw new Error(`Tavily ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data: any = await response.json();
  const results: any[] = data.results ?? [];
  if (results.length === 0) return { forModel: "No results found.", summary: "0 results" };

  const forModel = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`)
    .join("\n\n");
  return { forModel, summary: `${results.length} results` };
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<ToolOutput> {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");

  // 1) Tavily extract (handles JS-heavy and bot-protected pages better)
  if (process.env.TAVILY_API_KEY) {
    try {
      const r = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        },
        body: JSON.stringify({ urls: url }),
      });
      if (r.ok) {
        const data: any = await r.json();
        const text: string | undefined = data.results?.[0]?.raw_content;
        if (text) {
          return {
            forModel: text.slice(0, MAX_PAGE_CHARS),
            summary: `Read ${Math.min(text.length, MAX_PAGE_CHARS)} characters`,
          };
        }
      }
    } catch {
      /* fall through to direct fetch */
    }
  }

  // 2) Direct fetch fallback
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchAgent/2.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Page returned HTTP ${res.status}`);
  const text = stripHtml(await res.text()).slice(0, MAX_PAGE_CHARS);
  if (!text) throw new Error("Page had no readable text");
  return { forModel: text, summary: `Read ${text.length} characters` };
}

/** Runs a tool. Errors are returned to the model (not thrown) so it can recover on its own. */
export async function executeTool(name: string, args: Record<string, any>): Promise<ToolOutput> {
  try {
    if (name === "web_search") return await webSearch(String(args.query ?? ""));
    if (name === "fetch_page") return await fetchPage(String(args.url ?? ""));
    return { forModel: `Unknown tool: ${name}`, summary: "Unknown tool" };
  } catch (err: any) {
    const message = err?.message ?? "Tool failed";
    return { forModel: `Tool error: ${message}. Try a different query or URL.`, summary: `Failed: ${message}` };
  }
}
