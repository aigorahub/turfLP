import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export default {
  serverExternalPackages: ["turflp", "highs"],
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The worker script loads at run time by path, so the tracer must include it and its packages.
  outputFileTracingIncludes: {
    "/api/probe/*": ["./workers/**", "./node_modules/turflp/**", "./node_modules/highs/**"],
  },
};
