// src/main/preload.js
var { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("termal", {
  // SSH
  connect: (host) => ipcRenderer.invoke("ssh:connect", host),
  shell: (opts) => ipcRenderer.invoke("ssh:shell", opts),
  write: (opts) => ipcRenderer.invoke("ssh:write", opts),
  resize: (opts) => ipcRenderer.invoke("ssh:resize", opts),
  close: (sessionId) => ipcRenderer.invoke("ssh:close", { sessionId }),
  // shell 外独立执行命令（取 pwd 等状态，不写进终端显示）
  exec: (sessionId, command) => ipcRenderer.invoke("ssh:exec", { sessionId, command }),
  onData: (cb) => ipcRenderer.on("ssh:data", (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on("ssh:error", (_e, d) => cb(d)),
  onClosed: (cb) => ipcRenderer.on("ssh:closed", (_e, d) => cb(d)),
  onTabClosed: (cb) => ipcRenderer.on("ssh:tab-closed", (_e, d) => cb(d)),
  // 隧道（SSH 端口转发，独立会话）
  tunnelStart: (t) => ipcRenderer.invoke("tunnel:start", t),
  tunnelStop: (id) => ipcRenderer.invoke("tunnel:stop", { id }),
  tunnelList: () => ipcRenderer.invoke("tunnel:list"),
  // 密钥文件
  keyReadFile: (p) => ipcRenderer.invoke("key:readFile", { path: p }),
  keyPickFile: () => ipcRenderer.invoke("key:pickFile"),
  keyValidateContent: (content) => ipcRenderer.invoke("key:validateContent", { content }),
  // SSH 测试连接
  testSsh: (host) => ipcRenderer.invoke("ssh:test", host),
  // SFTP 文件管理
  sftpList: (sessionId, remotePath) => ipcRenderer.invoke("sftp:list", { sessionId, remotePath }),
  sftpRealpath: (sessionId, remotePath) => ipcRenderer.invoke("sftp:realpath", { sessionId, remotePath }),
  sftpMkdir: (sessionId, remotePath) => ipcRenderer.invoke("sftp:mkdir", { sessionId, remotePath }),
  sftpTouch: (sessionId, remotePath) => ipcRenderer.invoke("sftp:touch", { sessionId, remotePath }),
  sftpDelete: (sessionId, remotePath, type) => ipcRenderer.invoke("sftp:delete", { sessionId, remotePath, type }),
  sftpRename: (sessionId, from, to) => ipcRenderer.invoke("sftp:rename", { sessionId, from, to }),
  sftpChmod: (sessionId, remotePath, mode) => ipcRenderer.invoke("sftp:chmod", { sessionId, remotePath, mode }),
  sftpUpload: (sessionId, localPath, remotePath) => ipcRenderer.invoke("sftp:upload", { sessionId, localPath, remotePath }),
  sftpPickUploadFiles: () => ipcRenderer.invoke("sftp:pickUploadFiles"),
  sftpDownload: (sessionId, remotePath, fileName, downloadDir) => ipcRenderer.invoke("sftp:download", { sessionId, remotePath, fileName, downloadDir }),
  sftpTransferAbort: (transferId) => ipcRenderer.invoke("sftp:transfer-abort", { transferId }),
  revealInFinder: (filePath) => ipcRenderer.invoke("shell:reveal", { path: filePath }),
  openDir: (dirPath) => ipcRenderer.invoke("shell:openDir", { path: dirPath }),
  pickDownloadDir: () => ipcRenderer.invoke("dialog:pickDownloadDir"),
  onTransferProgress: (cb) => ipcRenderer.on("sftp:transfer-progress", (_e, d) => cb(d)),
  sftpHome: (sessionId) => ipcRenderer.invoke("sftp:home", { sessionId }),
  // AI
  aiChat: (body) => ipcRenderer.invoke("ai:chat", body),
  aiTest: (body) => ipcRenderer.invoke("ai:test", body),
  onAiChunk: (cb) => ipcRenderer.on("ai:chunk", (_e, d) => cb(d)),
  onAiDone: (cb) => ipcRenderer.on("ai:done", (_e, d) => cb(d)),
  // AI 对话文件存储
  chatsList: (dir) => ipcRenderer.invoke("chats:list", { dir }),
  chatsLoad: (dir, file) => ipcRenderer.invoke("chats:load", { dir, file }),
  chatsSave: (dir, conv) => ipcRenderer.invoke("chats:save", { dir, conv }),
  chatsDelete: (dir, file) => ipcRenderer.invoke("chats:delete", { dir, file }),
  chatsRename: (dir, file, title) => ipcRenderer.invoke("chats:rename", { dir, file, title }),
  chatsPickDir: () => ipcRenderer.invoke("chats:pickDir"),
  // 版本与更新
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  checkUpdate: () => ipcRenderer.invoke("app:checkUpdate"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url })
});
