import { registerHarnessProfile } from "deepagents";
import { modelCallLimitMiddleware, toolErrorMiddleware } from "langchain";
import { defineDeepAgent, type ManagedServerRuntime } from "managed-deepagents";
import { z } from "zod";

import { accessMiddleware, accessPolicy } from "./access.js";
import { chooseModel, createModel, MODEL_CHOICES } from "./model.js";

// Docs searches must stay in the root trace, where evaluators read them; the built-in
// general-purpose subagent would run them out of sight.
for (const provider of ["anthropic", "openai"]) {
  registerHarnessProfile(provider, { generalPurposeSubagent: { enabled: false } });
}

// Lets an eval run pick the model. Real users never set it, so they always get the default.
export const contextSchema = z.object({ eval_model: z.enum(MODEL_CHOICES).optional() });

// A failed or timed-out tool call becomes an error result, so the model can still answer from its
// other searches. It sits inside the access check, whose refusals must still end the run.
const toolErrors = toolErrorMiddleware({
  onError: (_error, request) =>
    `The ${request.toolCall.name} call failed or timed out. Try another query, answer from the results you already have, or tell the user the docs lookup was unavailable.`,
});

// A factory, so the model is chosen per run and summarization inherits it too.
export function agent(runtime: ManagedServerRuntime) {
  return defineDeepAgent({
    // Also the assistant id and tracing project prefix; the web app hardcodes it.
    name: "chat-langchain-lite",
    model: createModel(process.env, chooseModel(runtime.executionRuntime?.context?.eval_model)),
    contextSchema,
    middleware: [
      accessMiddleware(accessPolicy(process.env)),
      toolErrors,
      modelCallLimitMiddleware({ runLimit: 25, exitBehavior: "end" }),
    ],
  });
}
