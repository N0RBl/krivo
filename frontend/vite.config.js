import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    host: "0.0.0.0",

    port: 5173,

    strictPort: true,

    https: {
      key: fs.readFileSync("./cert/krivo-key.pem"),
      cert: fs.readFileSync("./cert/krivo.pem"),
    },

    proxy: {
      "/socket.io": {
        target: "http://192.168.0.15:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },

  define: {
    global: "globalThis",
    "process.env": {},
  },

  resolve: {
    alias: {
      buffer: "buffer",
      util: "util",
      process: "process/browser",
    },
  },
});
