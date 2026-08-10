import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// NoiseCheck frontend dev server. Port 5175 is allow-listed by the NoiseCheck
// backend CORS (FloodCheck owns 5174). VITE_API_BASE overrides the API base URL.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true },
});
