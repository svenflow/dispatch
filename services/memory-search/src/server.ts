/**
 * HTTP server for search daemon.
 */

import { Store } from "./store";
import { SearchEngine, RankedResult } from "./search";
import { Poller } from "./poller";
import { Config } from "./config";

// =============================================================================
// Types
// =============================================================================

export interface ServerOptions {
  port: number;
  host: string;
}

export interface HealthResponse {
  status: "ok" | "error";
  indexed: number;
  uptime: number;
  version: string;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  category?: string;
  after?: number;
  before?: number;
}

export interface SearchResponse {
  results: RankedResult[];
  took_ms: number;
  query: string;
}

export interface StatusResponse {
  categories: Record<string, number>;
  total_docs: number;
  needs_embedding: number;
  last_modified: string | null;
  uptime: number;
}

export interface MemorySaveRequest {
  contact: string;
  memory_text: string;
  type?: string;
  importance?: number;
  tags?: string[];
}

export interface MemoryLoadRequest {
  contact: string;
  type?: string;
  limit?: number;
}

export interface MemorySearchRequest {
  query: string;
  contact?: string;
  limit?: number;
}

// =============================================================================
// Server
// =============================================================================

export class Server {
  private store: Store;
  private searchEngine: SearchEngine;
  private poller: Poller;
  private config: Config;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private startTime: number = Date.now();

  constructor(store: Store, searchEngine: SearchEngine, poller: Poller, config: Config) {
    this.store = store;
    this.searchEngine = searchEngine;
    this.poller = poller;
    this.config = config;
  }

  /**
   * Start the HTTP server with automatic port retry
   */
  start(): void {
    const { port: configPort, host } = this.config.server;

    // Try configured port first, then try up to 10 alternatives
    const maxAttempts = 10;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = configPort + attempt;
      try {
        this.server = Bun.serve({
          port,
          hostname: host,
          fetch: async (req) => {
            return this.handleRequest(req);
          },
        });

        if (attempt > 0) {
          console.log(`Port ${configPort} was in use, using port ${port} instead`);
        }
        console.log(`Search daemon listening on http://${host}:${port}`);
        return;
      } catch (error: any) {
        if (error.code === "EADDRINUSE") {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${configPort}. Last error: ${lastError?.message}`);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // CORS headers
      const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      };

      // Handle OPTIONS for CORS
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            ...headers,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Route requests
      if (path === "/health" && req.method === "GET") {
        return this.handleHealth(headers);
      }

      if (path === "/search" && req.method === "GET") {
        return await this.handleSearchGet(url, headers);
      }

      if (path === "/search" && req.method === "POST") {
        return await this.handleSearchPost(req, headers);
      }

      if (path === "/status" && req.method === "GET") {
        return this.handleStatus(headers);
      }

      if (path === "/index" && req.method === "POST") {
        return await this.handleIndex(req, headers);
      }

      if (path === "/reindex" && req.method === "POST") {
        return await this.handleReindex(req, headers);
      }

      // Memory endpoints
      if (path === "/memory/save" && req.method === "POST") {
        return await this.handleMemorySave(req, headers);
      }

      if (path === "/memory/load" && req.method === "GET") {
        return this.handleMemoryLoad(url, headers);
      }

      if (path === "/memory/search" && req.method === "GET") {
        return this.handleMemorySearch(url, headers);
      }

      if (path === "/memory/delete" && req.method === "POST") {
        return await this.handleMemoryDelete(req, headers);
      }

      if (path === "/memory/stats" && req.method === "GET") {
        return this.handleMemoryStats(headers);
      }

      // 404
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers,
      });
    } catch (error) {
      console.error("Server error:", error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ===========================================================================
  // Handlers
  // ===========================================================================

  private handleHealth(headers: Record<string, string>): Response {
    const status = this.store.getStatus();
    const response: HealthResponse = {
      status: "ok",
      indexed: status.total_docs,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: "1.0.0",
    };
    return new Response(JSON.stringify(response), { headers });
  }

  private async handleSearchGet(url: URL, headers: Record<string, string>): Promise<Response> {
    const query = url.searchParams.get("q");
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query parameter 'q'" }), {
        status: 400,
        headers,
      });
    }

    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const category = url.searchParams.get("category") || undefined;
    const afterStr = url.searchParams.get("after");
    const beforeStr = url.searchParams.get("before");
    const after = afterStr ? parseInt(afterStr, 10) : undefined;
    const before = beforeStr ? parseInt(beforeStr, 10) : undefined;

    return await this.doSearch(query, limit, category, after, before, headers);
  }

  private async handleSearchPost(req: Request, headers: Record<string, string>): Promise<Response> {
    const body = await req.json() as SearchRequest;

    if (!body.query) {
      return new Response(JSON.stringify({ error: "Missing 'query' in request body" }), {
        status: 400,
        headers,
      });
    }

    return await this.doSearch(body.query, body.limit || 20, body.category, body.after, body.before, headers);
  }

  private async doSearch(
    query: string,
    limit: number,
    category: string | undefined,
    after: number | undefined,
    before: number | undefined,
    headers: Record<string, string>
  ): Promise<Response> {
    const startTime = Date.now();

    const results = await this.searchEngine.search(query, limit, category, after, before);

    const response: SearchResponse = {
      results,
      took_ms: Date.now() - startTime,
      query,
    };

    return new Response(JSON.stringify(response), { headers });
  }

  private handleStatus(headers: Record<string, string>): Response {
    const status = this.store.getStatus();
    const response: StatusResponse = {
      categories: status.categories,
      total_docs: status.total_docs,
      needs_embedding: status.needs_embedding,
      last_modified: status.last_modified,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
    return new Response(JSON.stringify(response), { headers });
  }

  private async handleIndex(req: Request, headers: Record<string, string>): Promise<Response> {
    const body = await req.json() as {
      category: string;
      path: string;
      content: string;
      title?: string;
    };

    if (!body.category || !body.path || !body.content) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: category, path, content" }),
        { status: 400, headers }
      );
    }

    try {
      const { hashContent } = await import("./store");
      const hash = hashContent(body.content);
      const title = body.title || body.path;

      this.store.insertContent(hash, body.content);

      const existing = this.store.findDocument(body.category, body.path);
      if (existing) {
        this.store.updateDocument(existing.id, title, hash, Date.now());
      } else {
        this.store.insertDocument(body.category, body.path, title, hash, Date.now());
      }

      return new Response(JSON.stringify({ success: true, hash }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers,
      });
    }
  }

  private async handleReindex(req: Request, headers: Record<string, string>): Promise<Response> {
    const body = await req.json() as { category?: string };

    try {
      if (body.category) {
        const result = await this.poller.pollCategory(body.category);
        return new Response(JSON.stringify({ success: true, result }), { headers });
      } else {
        // Reindex all
        await this.poller.poll();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers,
      });
    }
  }

  // ===========================================================================
  // Memory Handlers
  // ===========================================================================

  private async handleMemorySave(req: Request, headers: Record<string, string>): Promise<Response> {
    try {
      const body = await req.json() as MemorySaveRequest;

      if (!body.contact || !body.memory_text) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: contact, memory_text" }),
          { status: 400, headers }
        );
      }

      const id = this.store.saveMemory(
        body.contact,
        body.memory_text,
        body.type || "fact",
        body.importance || 3,
        body.tags || []
      );

      return new Response(JSON.stringify({ success: true, id }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers,
      });
    }
  }

  private handleMemoryLoad(url: URL, headers: Record<string, string>): Response {
    const contact = url.searchParams.get("contact");
    if (!contact) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: contact" }),
        { status: 400, headers }
      );
    }

    const type = url.searchParams.get("type") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);

    const memories = this.store.loadMemories(contact, type, limit);
    return new Response(JSON.stringify({ memories }), { headers });
  }

  private handleMemorySearch(url: URL, headers: Record<string, string>): Response {
    const query = url.searchParams.get("q");
    if (!query) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: q" }),
        { status: 400, headers }
      );
    }

    const contact = url.searchParams.get("contact") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);

    const memories = this.store.searchMemories(query, contact, limit);
    return new Response(JSON.stringify({ memories }), { headers });
  }

  private async handleMemoryDelete(req: Request, headers: Record<string, string>): Promise<Response> {
    try {
      const body = await req.json() as { id: number };

      if (!body.id) {
        return new Response(
          JSON.stringify({ error: "Missing required field: id" }),
          { status: 400, headers }
        );
      }

      this.store.deleteMemory(body.id);
      return new Response(JSON.stringify({ success: true }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers,
      });
    }
  }

  private handleMemoryStats(headers: Record<string, string>): Response {
    const stats = this.store.getMemoryStats();
    return new Response(JSON.stringify(stats), { headers });
  }
}
