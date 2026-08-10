/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  server: {
    // /mnt/c (WSL) does not propagate file events; polling keeps HMR working
    watch: { usePolling: true, interval: 500 },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
