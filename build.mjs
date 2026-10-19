import { build } from 'esbuild'
import { rm, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

// 主进程：external 掉 electron / ssh2（含原生模块），运行时从 node_modules 加载
await build({
  entryPoints: ['src/main/main.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.js',
  external: ['electron', 'ssh2'],
})

// preload：必须是 CJS（contextIsolation 沙箱要求）
await build({
  entryPoints: ['src/main/preload.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload.js',
  external: ['electron'],
})

// 渲染层：React 打成单个 IIFE，CSS 落到 dist/renderer.css
// minify：去掉空白/缩短标识符，renderer.js 约 1.8MB -> ~950KB
await build({
  entryPoints: ['src/renderer/index.jsx'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/renderer.js',
  loader: { '.css': 'css' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  logLevel: 'info',
})

await copyFile('src/renderer/index.html', path.join('dist', 'index.html'))
console.log('build done -> dist/')
