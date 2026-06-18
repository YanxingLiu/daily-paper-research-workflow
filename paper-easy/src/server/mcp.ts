import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Request, Response } from "express";
import * as z from "zod/v4";
import { getAdminAuthError } from "./auth";
import type { AppConfig } from "./config";
import {
  getArxivAuthorPapersFeed,
  getArxivDailyPapersFeed,
  getHuggingFaceDailyPapersFeed,
  parseSyncKind
} from "./feedService";
import type { PaperStore } from "./store";
import { runSync } from "./sync";

type McpEndpointOptions = {
  config: AppConfig;
  store: PaperStore;
  fetchImpl?: typeof fetch;
};

export function mountMcpEndpoint(app: Express, options: McpEndpointOptions): void {
  app.post("/mcp", async (request, response) => {
    const authError = getAdminAuthError(request.headers, options.config.adminToken, { requireConfiguredToken: true });
    if (authError) {
      response.status(authError.status).json({ error: authError.message });
      return;
    }

    await handleMcpRequest(request, response, options);
  });

  app.get("/mcp", (_request, response) => {
    response.status(405).json({ error: "Method not allowed" });
  });

  app.delete("/mcp", (_request, response) => {
    response.status(405).json({ error: "Method not allowed" });
  });
}

function createPapersEasyMcpServer({ config, store, fetchImpl }: McpEndpointOptions): McpServer {
  const server = new McpServer({
    name: "papers-easy",
    version: "0.1.0"
  });

  server.registerTool(
    "get_arxiv_daily_papers",
    {
      title: "Get arXiv daily papers",
      description: "Read cached arXiv daily papers by category and optional archive date. This tool does not sync.",
      inputSchema: {
        categories: z.array(z.string()).optional().describe("arXiv category ids. Defaults to configured categories."),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
          .optional()
          .describe("Archive date in YYYY-MM-DD format."),
        maxResults: z.number().int().positive().optional().describe("Maximum papers per category.")
      }
    },
    async ({ categories, date, maxResults }) =>
      jsonToolResult(
        await getArxivDailyPapersFeed({
          store,
          config,
          fetchImpl,
          categories,
          date,
          maxResults
        })
      )
  );

  server.registerTool(
    "get_arxiv_author_papers",
    {
      title: "Get arXiv author papers",
      description: "Read cached arXiv papers for watched or provided authors. This tool does not sync.",
      inputSchema: {
        authors: z.array(z.string()).optional().describe("Author names. Defaults to configured watched authors."),
        maxResults: z.number().int().positive().optional().describe("Maximum papers per author.")
      }
    },
    async ({ authors, maxResults }) =>
      jsonToolResult(
        await getArxivAuthorPapersFeed({
          store,
          config,
          fetchImpl,
          authors,
          maxResults
        })
      )
  );

  server.registerTool(
    "get_huggingface_daily_papers",
    {
      title: "Get Hugging Face Daily Papers",
      description: "Read cached Hugging Face Daily Papers for an optional date. This tool does not sync.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
          .optional()
          .describe("Daily Papers date in YYYY-MM-DD format."),
        maxResults: z.number().int().positive().optional().describe("Maximum papers to return.")
      }
    },
    async ({ date, maxResults }) =>
      jsonToolResult(
        await getHuggingFaceDailyPapersFeed({
          store,
          config,
          fetchImpl,
          date,
          maxResults
        })
      )
  );

  server.registerTool(
    "sync_papers",
    {
      title: "Sync Papers Easy feeds",
      description: "Explicitly refresh cached Papers Easy data. This is the only MCP tool that performs sync side effects.",
      inputSchema: {
        kind: z.enum(["daily", "authors", "huggingface", "all"]).default("all").describe("Feed kind to sync."),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
          .optional()
          .describe("Hugging Face date in YYYY-MM-DD format.")
      }
    },
    async ({ kind, date }) => {
      const run = await runSync({
        kind: parseSyncKind(kind),
        store,
        config,
        fetchImpl,
        huggingFaceDate: date
      });
      return jsonToolResult(run, run.status === "failed");
    }
  );

  return server;
}

async function handleMcpRequest(request: Request, response: Response, options: McpEndpointOptions): Promise<void> {
  const server = createPapersEasyMcpServer(options);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined
  });

  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal MCP server error"
        },
        id: null
      });
    }
  }
}

function jsonToolResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data)
      }
    ],
    ...(isError ? { isError: true } : {})
  };
}
