import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // dev tunnels (localtunnel / localhost.run) send their own Host header
    allowedHosts: ['.loca.lt', '.lhr.life', '.serveousercontent.com'],
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:8000', ws: true } },
  },
})
