import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createApp } from "./src/server/index";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "papers-easy-api",
      configureServer(server) {
        server.middlewares.use(createApp());
      }
    }
  ]
});
