import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The admin app runs on its own dev server (separate from the consumer app and
// the assessor console) and talks to the same FastAPI backend. In dev it calls
// relative paths like /admin/applications; Vite proxies the admin + auth surface
// to the backend.
const BACKEND = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175, // distinct from consumer (5173) and console (5174)
    proxy: {
      '/admin': BACKEND,
      '/auth': BACKEND,
      '/health': BACKEND,
    },
  },
})
