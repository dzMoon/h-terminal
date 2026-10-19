#!/bin/bash
# 开发态菜单栏首项显示「Electron」修正脚本
# macOS 菜单栏第一项标题取 app 包的 CFBundleName，菜单模板的 label 管不到。
# 开发态跑的是 node_modules/electron/dist/Electron.app，其 Info.plist 里
# CFBundleName = Electron —— 直接改成 HTerminal。
#
# 何时需要重跑：npm install / 重装 node_modules 会还原 Electron.app，
# 菜单栏又变回 Electron 时执行本脚本（bash fix-dev-menu-name.sh）。
set -e
PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "未找到 $PLIST —— 请在项目根目录执行" >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleName HTerminal" -c "Set :CFBundleDisplayName HTerminal" "$PLIST"
echo "done: Electron.app -> HTerminal（重启 npm run dev 生效）"
