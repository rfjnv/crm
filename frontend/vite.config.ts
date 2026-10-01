import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Force fresh deployment - 2026-03-12
export default defineConfig({
  plugins: [react()],
  build: {
    // Vite 7 по умолчанию целится в Chrome 107 (конец 2022). CRM открывают со
    // встроенных Android-панелей и из WebView Telegram, где System WebView бывает
    // заметно старше — там бандл не парсится и экран остаётся пустым, причём
    // никакой скрипт из этого же бандла об этом уже не сообщит.
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
    rollupOptions: {
      output: {
        // Ядро библиотек — отдельными чанками: они меняются редко, и после деплоя браузер
        // перекачивает только код CRM. antd сюда не добавлять: тогда в стартовую загрузку
        // попадает вся библиотека, включая компоненты, нужные только ленивым страницам.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'axios', 'dayjs', 'zustand'],
        },
      },
    },
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      '/uploads': 'http://localhost:3000',
    },
  },
})
