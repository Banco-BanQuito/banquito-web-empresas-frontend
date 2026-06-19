import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3003,
    proxy: {
      "/api/v2/auth": {
        target: "http://localhost:8083",
        changeOrigin: true
      },
      "^/api/v2/payments/batches/.+/status": {
        target: "http://localhost:8085",
        changeOrigin: true
      },
      "^/api/v2/payments/batches/.+/report": {
        target: "http://localhost:8088",
        changeOrigin: true
      },
      "^/api/v2/payments/receipts": {
        target: "http://localhost:8088",
        changeOrigin: true
      },
      "^/api/v2/payments/batches": {
        target: "http://localhost:8084",
        changeOrigin: true
      },
      "^/api/v2/accounts": {
        target: "http://localhost:8081",
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 3003
  }
});
