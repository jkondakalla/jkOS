import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [tailwindcss(), react()],
  resolve: {
    // Force a single React instance. Without this, workspace packages that
    // get pre-bundled via CJS interop end up with their own React copy,
    // setting a separate dispatcher and breaking hooks with "null (reading
    // 'useState')".
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
})
