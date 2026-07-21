import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PHYLO_LENS_PROXY_TARGET =
  process.env.VITE_PHYLO_LENS_PROXY_TARGET ?? "http://localhost:8000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: PHYLO_LENS_PROXY_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (_, __, res) => {
            console.log("error connection upstream");
            res.writeHead(502);
            res.end();
          });
          proxy.on("proxyRes", (proxyRes, _, res) => {
            const upstreamSocket = proxyRes.socket;
            console.log("upstream connected");
            if (upstreamSocket) {
              upstreamSocket.once("close", () => {
                console.log("upstream closed");
                if (!res.writableFinished) {
                  console.log("destroying downstream");
                  res.destroy();
                }
              });
            }
          });
        },
      },
      "/health": {
        target: PHYLO_LENS_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
