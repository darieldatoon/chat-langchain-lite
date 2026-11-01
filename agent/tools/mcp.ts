import { defineMcp } from "managed-deepagents";

export const mcp = defineMcp({
  servers: {
    langchainDocs: {
      transport: "http",
      url: "https://docs.langchain.com/mcp",
      // The server also offers submit_feedback, which writes to the docs team. Keep it read-only.
      includeTools: ["search_docs_by_lang_chain", "query_docs_filesystem_docs_by_lang_chain"],
      // Docs calls normally return in about a second; the MCP SDK would otherwise wait 60s.
      defaultToolTimeout: 20_000,
    },
  },
});
