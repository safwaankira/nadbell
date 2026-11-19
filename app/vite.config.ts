import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * Security headers for every page. The app is a static-ish wallet dapp: it only
 * talks to its own origin and a Monad RPC, and loads fonts from Google.
 * script-src needs 'unsafe-inline' because TanStack Start streams per-request
 * hydration scripts inline; it still blocks scripts from any other origin.
 */
function securityHeaders(rpcUrl: string | undefined): Record<string, string> {
  const rpcs = ["https://testnet-rpc.monad.xyz", "https://rpc.monad.xyz"];
  if (rpcUrl?.startsWith("https://")) rpcs.push(new URL(rpcUrl).origin);
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self' ${[...new Set(rpcs)].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "content-security-policy": csp,
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

export default defineConfig(({ command, isPreview, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    server: { host: "0.0.0.0", port: 8080, strictPort: true },
    preview: { host: "127.0.0.1", port: 8081, strictPort: true },
    resolve: { tsconfigPaths: true },
    plugins: [
      tailwindcss(),
      tanstackStart(),
      // Vercel output for `vite build` (and `vite preview` of that build).
      // The headers go in as a raw Vercel route with `continue: true`. Nitro's routeRules
      // headers emit a route without it, which ends routing before the SSR function.
      ...(command === "build" || isPreview
        ? [
            nitro({
              preset: "vercel",
              vercel: {
                config: { routes: [{ src: "/(.*)", headers: securityHeaders(env.VITE_RPC_URL), continue: true }] },
              },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
