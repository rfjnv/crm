import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Force fresh deployment - 2026-03-12
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/uploads': 'http://localhost:3000',
    },
  },
})
