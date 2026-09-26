import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

/** Baked in so a backup file can say which app wrote it without shipping `package.json` or an
 *  env var to the browser. Read here rather than imported: `package.json` is not a source module. */
const appVersion = (JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version

/** The libraries this app always loads, grouped so a screen change never invalidates the
 *  framework download and the browser can fetch the big ones in parallel. Screens are already
 *  their own chunks through dynamic import in App.tsx. */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const pkg = id.split('node_modules/').pop()!.split('/')[0];
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router' || pkg === 'react-router-dom' || pkg === 'scheduler') return 'react';
  if (pkg === 'motion' || pkg === 'framer-motion' || pkg === 'motion-dom' || pkg === 'motion-utils') return 'motion';
  if (pkg.startsWith('@supabase')) return 'supabase';
  if (pkg === 'lucide-react') return 'icons';
  if (pkg === 'date-fns') return 'dates';
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
})
