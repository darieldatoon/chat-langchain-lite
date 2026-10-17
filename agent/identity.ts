import { auth, defineIdentity } from "managed-deepagents";

// Callers send their own LangSmith PAT; MDA admits only members of the deployment's workspace.
export const identity = defineIdentity({
  auth: auth.langsmithApiKey(),
});
