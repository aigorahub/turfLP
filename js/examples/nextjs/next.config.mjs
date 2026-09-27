import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
export default {
  // A self-contained server in .next/standalone, traced like a Vercel deployment.
  output: "standalone",
  // Keep turflp and highs as plain Node.js packages, so that highs finds its
  // highs.wasm file next to its own module instead of inside a bundle.
  serverExternalPackages: ["turflp", "highs"],
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};
