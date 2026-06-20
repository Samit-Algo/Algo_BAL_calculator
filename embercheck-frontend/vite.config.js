import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development the app calls relative paths like /assess; Vite proxies
// those to the FastAPI backend. The backend's default port is 8000 (uvicorn
// app.main:app --reload) - change the target below if you run it elsewhere.
const BACKEND = 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/assess': BACKEND,
      '/suggest': BACKEND,
      '/health': BACKEND,
      // Consumer-account auth (Phase 1): register/login/refresh/logout + /users/me.
      '/auth': BACKEND,
      '/users': BACKEND,
      // Cases (Phase 1, Step 3b-ii): server-side assessment + photo persistence.
      '/cases': BACKEND,
    },
  },
})
