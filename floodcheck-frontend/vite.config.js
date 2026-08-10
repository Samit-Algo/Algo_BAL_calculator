import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FloodCheck frontend dev server. Port 5174 is allow-listed by the FloodCheck
// backend CORS. VITE_API_BASE overrides the API base URL if needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
