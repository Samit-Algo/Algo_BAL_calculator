import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Console runs on its own dev server (separate from the consumer app) and
// talks to the same FastAPI backend. In dev it calls relative paths like
// /console/worklist; Vite proxies the Console + auth surface to the backend.
const BACKEND = 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // distinct from the consumer app's 5173
    proxy: {
      '/console': BACKEND,
      '/auth': BACKEND,
      '/users': BACKEND,
      '/health': BACKEND,
    },
  },
})
