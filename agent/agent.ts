import { modelCallLimitMiddleware } from "langchain";
import { defineDeepAgent } from "managed-deepagents";

import { createModel } from "./model.js";

export const agent = defineDeepAgent({
  // Also the assistant id, Context Hub repo and tracing project prefix; the web app hardcodes it.
  name: "chat-langchain-lite",
  model: createModel(process.env),
  middleware: [modelCallLimitMiddleware({ runLimit: 25, exitBehavior: "end" })],
});
