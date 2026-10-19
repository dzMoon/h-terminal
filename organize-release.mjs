// 打包后整理产物：只留安装包，移动到 dist/<版本>/ 目录
// 运行时机：electron-builder 完成后（npm run package 系列脚本末尾追加）
import { readdir, mkdir, rm, cp, readFile } from 'node:fs/promises'
import path from 'node:path'

// dist/ 同时是 build.mjs 的输出目录和 electron-builder 的输出目录，
// 里面的 main.js/preload.js 等是运行时文件（package.json main 入口指向 dist/main.js），不能动
const DIST = 'dist'
const KEEP_EXTS = ['.dmg', '.exe', '.zip', '.AppImage', '.deb']
const SKIP_NAMES = ['blockmap', 'builder-debug.yml', 'latest.yml']

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const target = path.join(DIST, version)
await mkdir(target, { recursive: true })

const entries = await readdir(DIST, { withFileTypes: true })
let moved = 0
for (const e of entries) {
  // 目标目录自身跳过
  if (e.name === version) continue

  const full = path.join(DIST, e.name)
  // electron-builder 的解包中间目录（mac/、mac-arm64/、win-unpacked/）和图标缓存（.icon-ico/）直接删
  if (e.isDirectory()) {
    if (/^(mac|win|linux)(-|$)/.test(e.name) || e.name === '.icon-ico') {
      await rm(full, { recursive: true, force: true })
      console.log(`removed unpacked dir: ${e.name}`)
    }
    continue
  }
  // 只搬安装包本体，blockmap / latest.yml / builder-debug.yml 等杂项直接删
  const isInstaller = KEEP_EXTS.includes(path.extname(e.name))
  if (isInstaller) {
    await cp(full, path.join(target, e.name))
    await rm(full, { force: true })
    moved++
    console.log(`moved: ${e.name} -> dist/${version}/`)
  } else if (SKIP_NAMES.some(s => e.name.includes(s))) {
    await rm(full, { force: true })
    console.log(`removed: ${e.name}`)
  }
}

console.log(`done: ${moved} installer(s) in dist/${version}/`)
