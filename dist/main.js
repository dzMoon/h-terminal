// src/main/main.js
var { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
var path = require("node:path");
var { Client } = require("ssh2");
var fs = require("node:fs");
var net = require("node:net");
var http = require("node:http");
var https = require("node:https");
var { URL } = require("node:url");
app.setName("HTerminal");
var mainWindow = null;
function createWindow() {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1e3,
    minHeight: 560,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    {
      // 开发态菜单栏首项显示「Electron」：macOS 用 app 包的 CFBundleName 当首项标题，
      // 菜单 label 管不到它 —— setName 也只是改内存值。已直接改 node_modules 里
      // Electron.app 的 Info.plist（CFBundleName/CFBundleDisplayName → HTerminal）。
      // 注意：重装 node_modules 会还原，需重新执行 PlistBuddy 补丁
      label: app.name,
      submenu: [
        { role: "quit", label: "\u9000\u51FA HTerminal" }
      ]
    },
    {
      label: "\u7F16\u8F91",
      submenu: [
        { role: "copy", label: "\u590D\u5236" },
        { role: "paste", label: "\u7C98\u8D34" },
        { role: "cut", label: "\u526A\u5207" },
        { role: "selectAll", label: "\u5168\u9009" }
      ]
    }
  ];
  if (!isMac) template.unshift({ role: "appMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
if (process.platform === "darwin" && app.dock) {
  try {
    const iconPath = path.join(__dirname, "..", "build-assets", "icon_1024.png");
    if (fs.existsSync(iconPath)) app.dock.setIcon(iconPath);
  } catch {
  }
}
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
function disconnectAll() {
  for (const s of sessions.values()) {
    try {
      s.sftp && s.sftp.end();
    } catch {
    }
    for (const stream of s.streams.values()) {
      try {
        stream.close();
      } catch {
      }
    }
    try {
      s.conn.end();
    } catch {
    }
  }
  sessions.clear();
  for (const t of tunnels.values()) {
    try {
      t.server && t.server.close();
    } catch {
    }
    try {
      t.conn.end();
    } catch {
    }
  }
  tunnels.clear();
}
app.on("before-quit", disconnectAll);
app.on("will-quit", disconnectAll);
var sessions = /* @__PURE__ */ new Map();
var sessionSeq = 0;
function send(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}
function connectHost(host) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const sessionId = `s${++sessionSeq}`;
    const opts = {
      host: host.hostname,
      port: host.port || 22,
      username: host.username,
      readyTimeout: 15e3,
      keepaliveInterval: 15e3
    };
    if (host.authType === "key" && host.privateKey) {
      opts.privateKey = typeof host.privateKey === "string" && host.privateKey.includes("PRIVATE KEY-----") ? host.privateKey : fs.readFileSync(expandHome(host.privateKey));
      if (host.passphrase) opts.passphrase = host.passphrase;
    } else if (host.password) {
      opts.password = host.password;
    } else {
      opts.agent = process.env.SSH_AUTH_SOCK;
    }
    conn.on("ready", () => {
      sessions.set(sessionId, { conn, streams: /* @__PURE__ */ new Map(), host: host.hostname });
      resolve(sessionId);
    }).on("error", (err) => {
      reject(err);
    }).on("close", () => {
      const s = sessions.get(sessionId);
      if (s) {
        sessions.delete(sessionId);
        send("ssh:closed", { sessionId });
      }
    }).connect(opts);
  });
}
ipcMain.handle("ssh:connect", async (_e, host) => {
  try {
    const sessionId = await connectHost(host);
    return { ok: true, sessionId };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});
ipcMain.handle("ssh:shell", async (_e, { sessionId, tabId, cols, rows }) => {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, message: "\u4F1A\u8BDD\u4E0D\u5B58\u5728" };
  return new Promise((resolve) => {
    s.conn.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
      if (err) return resolve({ ok: false, message: err.message });
      s.streams.set(tabId, stream);
      stream.on("data", (d) => send("ssh:data", { tabId, data: d.toString("utf8") }));
      stream.on("close", () => {
        s.streams.delete(tabId);
        send("ssh:tab-closed", { tabId, sessionId });
      });
      resolve({ ok: true });
    });
  });
});
ipcMain.handle("ssh:write", (_e, { sessionId, tabId, data }) => {
  const s = sessions.get(sessionId);
  const stream = s && s.streams.get(tabId);
  if (stream) stream.write(data);
  return { ok: true };
});
ipcMain.handle("ssh:resize", (_e, { sessionId, tabId, cols, rows }) => {
  const s = sessions.get(sessionId);
  const stream = s && s.streams.get(tabId);
  if (stream) stream.setWindow(rows, cols, 0, 0);
  return { ok: true };
});
ipcMain.handle("ssh:close", (_e, { sessionId }) => {
  const s = sessions.get(sessionId);
  if (s) {
    try {
      s.sftp && s.sftp.end();
    } catch {
    }
    for (const stream of s.streams.values()) {
      try {
        stream.close();
      } catch {
      }
    }
    s.streams.clear();
    try {
      s.conn.end();
    } catch {
    }
    sessions.delete(sessionId);
  }
  return { ok: true };
});
ipcMain.handle("ssh:exec", async (_e, { sessionId, command, timeoutMs = 5e3 }) => {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, message: "\u4F1A\u8BDD\u4E0D\u5B58\u5728" };
  return new Promise((resolve) => {
    s.conn.exec(command, (err, stream) => {
      if (err) return resolve({ ok: false, message: err.message });
      let out = "";
      const timer = setTimeout(() => {
        try {
          stream.close();
        } catch {
        }
        ;
        resolve({ ok: false, message: "\u6267\u884C\u8D85\u65F6" });
      }, timeoutMs);
      stream.on("data", (d) => {
        out += d.toString("utf8");
      });
      stream.stderr.on("data", () => {
      });
      stream.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout: out.trim(), message: code === 0 ? void 0 : `exit ${code}` });
      });
    });
  });
});
var tunnels = /* @__PURE__ */ new Map();
ipcMain.handle("tunnel:start", async (_e, { id, host, type, localHost, localPort, remoteHost, remotePort }) => {
  if (tunnels.has(id)) return { ok: false, message: "\u96A7\u9053\u5DF2\u5728\u8FD0\u884C" };
  if (!host || !host.hostname) return { ok: false, message: "\u4E3B\u673A\u914D\u7F6E\u7F3A\u5931\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\uFF09" };
  let sessionId;
  try {
    sessionId = await connectHost(host);
  } catch (err) {
    return { ok: false, message: `\u8FDE\u63A5\u5931\u8D25: ${err.message}` };
  }
  const conn = sessions.get(sessionId).conn;
  const cleanup = () => {
    tunnels.delete(id);
    try {
      conn.end();
    } catch {
    }
  };
  try {
    if (type === "remote") {
      const bindPort = Number(remotePort);
      await new Promise((resolve, reject) => {
        conn.forwardIn("", bindPort, (err) => err ? reject(err) : resolve());
      });
      const onTcp = (_info, accept) => {
        const stream = accept();
        const sock = net.connect(Number(localPort), localHost || "127.0.0.1");
        sock.on("connect", () => {
          stream.pipe(sock);
          sock.pipe(stream);
        });
        sock.on("error", () => {
          try {
            stream.close();
          } catch {
          }
        });
        stream.on("error", () => {
          try {
            sock.destroy();
          } catch {
          }
        });
      };
      conn.on("tcp connection", onTcp);
      tunnels.set(id, { sessionId, conn, onTcp, remoteBind: bindPort });
    } else {
      const server = net.createServer((socket) => {
        conn.forwardOut("127.0.0.1", 0, remoteHost, Number(remotePort), (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(stream);
          stream.pipe(socket);
          stream.on("error", () => {
            try {
              socket.destroy();
            } catch {
            }
          });
          socket.on("error", () => {
            try {
              stream.close();
            } catch {
            }
          });
        });
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(Number(localPort), localHost || "127.0.0.1", () => resolve());
      });
      tunnels.set(id, { sessionId, conn, server });
    }
    conn.once("close", () => {
      if (tunnels.get(id)?.sessionId === sessionId) tunnels.delete(id);
    });
    return { ok: true };
  } catch (err) {
    const t = tunnels.get(id);
    if (t) {
      try {
        if (t.server) t.server.close();
      } catch {
      }
    }
    cleanup();
    return { ok: false, message: `\u8F6C\u53D1\u5EFA\u7ACB\u5931\u8D25: ${err.message}` };
  }
});
ipcMain.handle("tunnel:stop", (_e, { id }) => {
  const t = tunnels.get(id);
  if (!t) return { ok: false, message: "\u96A7\u9053\u672A\u5728\u8FD0\u884C" };
  tunnels.delete(id);
  try {
    if (t.server) t.server.close();
  } catch {
  }
  try {
    if (t.onTcp) t.conn.removeListener("tcp connection", t.onTcp);
  } catch {
  }
  try {
    if (t.remoteBind) t.conn.unforwardIn("", t.remoteBind);
  } catch {
  }
  try {
    t.conn.end();
  } catch {
  }
  return { ok: true };
});
ipcMain.handle("tunnel:list", () => ({ ok: true, ids: [...tunnels.keys()] }));
function expandHome(p) {
  if (!p) return p;
  if (p === "~") return CONFIG_DIR && require("node:os").homedir();
  if (p.startsWith("~/")) return path.join(require("node:os").homedir(), p.slice(2));
  return p;
}
var KEY_HEAD_RE = /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/;
function validateKeyContent(content) {
  if (!KEY_HEAD_RE.test(content)) {
    return { ok: false, message: "\u4E0D\u662F\u6709\u6548\u7684\u79C1\u94A5\u6587\u4EF6\uFF08\u7F3A\u5C11 BEGIN PRIVATE KEY \u5934\uFF09" };
  }
  return { ok: true };
}
ipcMain.handle("key:readFile", (_e, { path: p }) => {
  try {
    const real = expandHome(p);
    const content = fs.readFileSync(real, "utf8");
    const v = validateKeyContent(content);
    if (!v.ok) return v;
    return { ok: true, privateKey: content, fileName: path.basename(real) };
  } catch (e) {
    return { ok: false, message: `\u8BFB\u53D6\u5931\u8D25: ${e.message}` };
  }
});
ipcMain.handle("key:pickFile", async () => {
  const r = await dialog.showOpenDialog({
    title: "\u9009\u62E9\u79C1\u94A5\u6587\u4EF6",
    properties: ["openFile"],
    defaultPath: path.join(require("node:os").homedir(), ".ssh"),
    filters: [{ name: "\u79C1\u94A5", extensions: ["id_rsa", "id_ed25519", "id_ecdsa", "pem", "key", "ppk", "txt", "*"] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const content = fs.readFileSync(r.filePaths[0], "utf8");
  const v = validateKeyContent(content);
  if (!v.ok) return v;
  return { ok: true, privateKey: content, fileName: path.basename(r.filePaths[0]) };
});
ipcMain.handle("key:validateContent", (_e, { content }) => validateKeyContent(content));
async function getSftp(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("\u4F1A\u8BDD\u4E0D\u5B58\u5728");
  if (s.sftp) return s.sftp;
  return new Promise((resolve, reject) => {
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err);
      s.sftp = sftp;
      resolve(sftp);
    });
  });
}
function statModeToPerm(mode) {
  const perms = ["r", "w", "x"];
  let out = "";
  for (let g = 2; g >= 0; g--) {
    for (let b = 2; b >= 0; b--) {
      const bit = 1 << g * 3 + b;
      out += mode & bit ? perms[2 - b] : "-";
    }
  }
  return out;
}
ipcMain.handle("sftp:list", async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = await getSftp(sessionId);
    const entries = await new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
    });
    const items = await Promise.all(entries.map((e) => new Promise((resolve) => {
      const full = remotePath.replace(/\/+$/, "") + "/" + e.filename;
      sftp.lstat(full, (err2, st) => {
        if (err2) return resolve({
          name: e.filename,
          type: "file",
          size: e.attrs.size,
          mtime: e.attrs.mtime * 1e3,
          mode: e.attrs.mode,
          perm: ""
        });
        resolve({
          name: e.filename,
          type: st.isDirectory() ? "dir" : st.isSymbolicLink() ? "link" : "file",
          size: st.size,
          mtime: st.mtime * 1e3,
          mode: st.mode,
          perm: statModeToPerm(st.mode)
        });
      });
    })));
    items.sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:realpath", async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = await getSftp(sessionId);
    const p = await new Promise((resolve, reject) => {
      sftp.realpath(remotePath, (err, t) => err ? reject(err) : resolve(t));
    });
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:mkdir", async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = await getSftp(sessionId);
    await new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:touch", async (_e, { sessionId, remotePath }) => {
  try {
    const sftp = await getSftp(sessionId);
    await new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, "", (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
async function sftpDelete(sftp, remotePath, type) {
  try {
    if (type === "dir") {
      const entries = await new Promise((resolve, reject) => {
        sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
      });
      for (const e of entries) {
        const full = remotePath.replace(/\/+$/, "") + "/" + e.filename;
        const st = await new Promise((resolve, reject) => {
          sftp.lstat(full, (err2, s2) => err2 ? reject(err2) : resolve(s2));
        });
        const r = await sftpDelete(sftp, full, st.isDirectory() ? "dir" : "file");
        if (!r.ok) return r;
      }
      await new Promise((resolve, reject) => {
        sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve());
      });
    } else {
      await new Promise((resolve, reject) => {
        sftp.unlink(remotePath, (err) => err ? reject(err) : resolve());
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
ipcMain.handle("sftp:delete", async (_e, { sessionId, remotePath, type }) => {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, message: "\u4F1A\u8BDD\u4E0D\u5B58\u5728" };
  try {
    const sftp = await getSftp(sessionId);
    return await sftpDelete(sftp, remotePath, type);
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:rename", async (_e, { sessionId, from, to }) => {
  try {
    const sftp = await getSftp(sessionId);
    await new Promise((resolve, reject) => {
      sftp.rename(from, to, (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:chmod", async (_e, { sessionId, remotePath, mode }) => {
  try {
    const sftp = await getSftp(sessionId);
    await new Promise((resolve, reject) => {
      sftp.chmod(remotePath, parseInt(mode, 8), (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
var transfers = /* @__PURE__ */ new Map();
var transferSeq = 0;
function openTransferSftp(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return Promise.reject(new Error("\u4F1A\u8BDD\u4E0D\u5B58\u5728"));
  return new Promise((resolve, reject) => {
    s.conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}
function xferWithProgress(sftp, direction, remotePath, localPath) {
  const transferId = `x${++transferSeq}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      transfers.delete(transferId);
      try {
        sftp.close();
      } catch {
      }
      resolve(r);
    };
    const opts = {
      step: (totalTransferred, _chunk, totalFile) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const pct = totalFile > 0 ? Math.floor(totalTransferred / totalFile * 100) : 0;
        mainWindow.webContents.send("sftp:transfer-progress", {
          transferId,
          direction,
          remotePath,
          localPath,
          transferred: totalTransferred,
          total: totalFile,
          pct
        });
      }
    };
    transfers.set(transferId, () => {
      opts.__aborted = true;
      finish({ ok: false, aborted: true, message: "\u5DF2\u7EC8\u6B62" });
    });
    const cb = (err) => {
      if (opts.__aborted) return;
      finish(err ? { ok: false, message: err.message } : { ok: true });
    };
    if (direction === "upload") sftp.fastPut(localPath, remotePath, opts, cb);
    else sftp.fastGet(remotePath, localPath, opts, cb);
  });
}
ipcMain.handle("dialog:pickDownloadDir", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dir: r.filePaths[0] };
});
ipcMain.handle("shell:reveal", (_e, { path: filePath }) => {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("shell:openDir", (_e, { path: dirPath }) => {
  try {
    const p = String(dirPath || "");
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      return { ok: false, message: "\u76EE\u5F55\u4E0D\u5B58\u5728" };
    }
    shell.openPath(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:transfer-abort", (_e, { transferId }) => {
  const abort = transfers.get(transferId);
  if (abort) {
    abort();
    return { ok: true };
  }
  return { ok: false, message: "\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u7ED3\u675F" };
});
ipcMain.handle("sftp:upload", async (_e, { sessionId, localPath, remotePath }) => {
  let sftp;
  try {
    sftp = await openTransferSftp(sessionId);
    return await xferWithProgress(sftp, "upload", remotePath, localPath);
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:pickUploadFiles", async () => {
  const r = await dialog.showOpenDialog({
    title: "\u9009\u62E9\u8981\u4E0A\u4F20\u7684\u6587\u4EF6",
    properties: ["openFile", "multiSelections"]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, files: r.filePaths };
});
ipcMain.handle("sftp:download", async (_e, { sessionId, remotePath, fileName, downloadDir }) => {
  let sftp;
  try {
    let savePath;
    const baseDir = expandHome(downloadDir && downloadDir.trim()) || path.join(require("node:os").homedir(), "Downloads");
    const s = sessions.get(sessionId);
    const now = /* @__PURE__ */ new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dir = path.join(baseDir, s ? s.host : "unknown", `${now.getFullYear()}-${mm}-${dd}`);
    fs.mkdirSync(dir, { recursive: true });
    let candidate = path.join(dir, fileName);
    let n = 1;
    while (fs.existsSync(candidate)) {
      const dot = fileName.lastIndexOf(".");
      candidate = dot > 0 ? path.join(dir, `${fileName.slice(0, dot)}(${n})${fileName.slice(dot)}`) : path.join(dir, `${fileName}(${n})`);
      n++;
    }
    savePath = candidate;
    sftp = await openTransferSftp(sessionId);
    const res = await xferWithProgress(sftp, "download", remotePath, savePath);
    return { ...res, localPath: savePath };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("sftp:home", async (_e, { sessionId }) => {
  try {
    const sftp = await getSftp(sessionId);
    const p = await new Promise((resolve, reject) => {
      sftp.realpath(".", (err, t) => err ? reject(err) : resolve(t));
    });
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("ssh:test", async (_e, host) => {
  const buildOpts = () => {
    const opts = {
      host: host.hostname,
      port: host.port || 22,
      username: host.username,
      readyTimeout: 1e4
    };
    if (host.authType === "key" && host.privateKey) {
      opts.privateKey = host.privateKey;
      if (host.passphrase) opts.passphrase = host.passphrase;
    } else if (host.password) {
      opts.password = host.password;
    } else {
      opts.agent = process.env.SSH_AUTH_SOCK;
    }
    return opts;
  };
  return new Promise((resolve) => {
    const conn = new Client();
    const finish = (r) => {
      try {
        conn.end();
      } catch {
      }
      ;
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "\u8FDE\u63A5\u8D85\u65F6\uFF0810s\uFF09" }), 11e3);
    conn.on("ready", () => {
      clearTimeout(timer);
      finish({ ok: true });
    }).on("error", (err) => {
      clearTimeout(timer);
      const msg = err.level === "client-authentication" ? "\u8BA4\u8BC1\u5931\u8D25\uFF1A\u7528\u6237\u540D/\u5BC6\u7801/\u5BC6\u94A5\u4E0D\u6B63\u786E" : err.message;
      finish({ ok: false, message: msg });
    }).connect(buildOpts());
  });
});
var os = require("node:os");
async function ensureChatDir(dir) {
  let real = dir;
  if (!real) real = path.join(os.homedir(), "Documents", "HTerminalChats");
  if (real === "~") real = os.homedir();
  if (real.startsWith("~/")) real = path.join(os.homedir(), real.slice(2));
  await fs.promises.mkdir(real, { recursive: true });
  return real;
}
ipcMain.handle("chats:list", async (_e, { dir }) => {
  try {
    const real = await ensureChatDir(dir);
    const files = await fs.promises.readdir(real);
    const items = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const st = await fs.promises.stat(path.join(real, f));
        const txt = await fs.promises.readFile(path.join(real, f), "utf8");
        const j = JSON.parse(txt);
        items.push({
          file: f,
          id: j.id || f.replace(/\.json$/, ""),
          title: j.title || "\u672A\u547D\u540D\u5BF9\u8BDD",
          hostId: j.hostId || null,
          count: Array.isArray(j.messages) ? j.messages.length : 0,
          mtime: st.mtimeMs
        });
      } catch {
      }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, dir: real, items };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("chats:load", async (_e, { dir, file }) => {
  try {
    const real = await ensureChatDir(dir);
    const txt = await fs.promises.readFile(path.join(real, file), "utf8");
    return { ok: true, conv: JSON.parse(txt) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("chats:save", async (_e, { dir, conv }) => {
  try {
    const real = await ensureChatDir(dir);
    const file = `${conv.id}.json`;
    await fs.promises.writeFile(path.join(real, file), JSON.stringify(conv, null, 2), "utf8");
    return { ok: true, file };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("chats:delete", async (_e, { dir, file }) => {
  try {
    const real = await ensureChatDir(dir);
    await fs.promises.unlink(path.join(real, file));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("chats:rename", async (_e, { dir, file, title }) => {
  try {
    const real = await ensureChatDir(dir);
    const p = path.join(real, file);
    const j = JSON.parse(await fs.promises.readFile(p, "utf8"));
    j.title = title;
    await fs.promises.writeFile(p, JSON.stringify(j, null, 2), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle("chats:pickDir", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dir: r.filePaths[0] };
});
var memAiKey = "";
ipcMain.handle("ai:test", async (_e, { baseUrl, apiKey }) => {
  const key = (apiKey || "").trim();
  if (!key) return { ok: false, message: "\u8BF7\u5148\u586B\u5199 API Key" };
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(`${base}/models`);
  } catch {
    return { ok: false, message: `Base URL \u65E0\u6548: ${baseUrl}` };
  }
  return new Promise((resolve) => {
    const reqMod = url.protocol === "https:" ? https : http;
    const req = reqMod.request(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      timeout: 8e3
    }, (res) => {
      let buf = "";
      res.on("data", (c) => {
        buf += c;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          let msg = `HTTP ${res.statusCode}`;
          try {
            const j = JSON.parse(buf);
            msg += `: ${j.error && (j.error.message || j.error.code) || buf.slice(0, 200)}`;
          } catch {
            if (buf.includes("<!doctype") || buf.includes("<html")) {
              msg += ": \u8FD4\u56DE\u4E86\u7F51\u9875\u800C\u975E API \u2014\u2014 Base URL \u5927\u6982\u7387\u5C11\u4E86 /v1";
            }
          }
          return resolve({ ok: false, message: msg });
        }
        try {
          const j = JSON.parse(buf);
          const models = (j.data || []).map((m) => m.id);
          resolve({ ok: true, models });
        } catch {
          resolve({ ok: false, message: "\u54CD\u5E94\u4E0D\u662F JSON \u2014\u2014 Base URL \u53EF\u80FD\u4E0D\u5BF9" });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, message: "\u8FDE\u63A5\u8D85\u65F6\uFF088s\uFF09" });
    });
    req.on("error", (e) => resolve({ ok: false, message: e.message }));
    req.end();
  });
});
ipcMain.handle("ai:chat", async (_e, body) => {
  const apiKey = (body.apiKey || memAiKey || "").trim();
  if (!apiKey) return { ok: false, message: "\u672A\u914D\u7F6E API Key\uFF08\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF09" };
  if (!body.messages || !body.messages.length) return { ok: false, message: "\u6D88\u606F\u4E3A\u7A7A" };
  const base = (body.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(`${base}/chat/completions`);
  } catch {
    return { ok: false, message: `Base URL \u65E0\u6548: ${base}` };
  }
  const payload = JSON.stringify({
    model: (body.model || "gpt-4o-mini").trim(),
    messages: body.messages,
    stream: true
  });
  console.log("[ai] request ->", url.href, "model =", body.model);
  const reqMod = url.protocol === "https:" ? https : http;
  const req = reqMod.request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    },
    (res) => {
      const ct = String(res.headers["content-type"] || "");
      if (res.statusCode !== 200 || ct.includes("text/html")) {
        let buf2 = "";
        res.on("data", (c) => {
          buf2 += c;
        });
        res.on("end", () => {
          let msg = `HTTP ${res.statusCode}`;
          if (ct.includes("text/html") || buf2.includes("<!doctype") || buf2.includes("<html")) {
            msg += `: \u7F51\u5173\u8FD4\u56DE\u4E86\u7F51\u9875\u800C\u975E API \u2014\u2014 Base URL \u5C11\u4E86 /v1\uFF08\u5F53\u524D\u8BF7\u6C42\u7684\u662F ${url.pathname}\uFF09`;
          } else {
            try {
              const j = JSON.parse(buf2);
              msg += `: ${j.error && (j.error.message || j.error.code) || j.message || buf2.slice(0, 300)}`;
            } catch {
              if (buf2) msg += `: ${buf2.slice(0, 300)}`;
            }
          }
          console.log("[ai] error response:", msg);
          send("ai:done", { requestId: body.requestId, error: msg });
        });
        return;
      }
      console.log("[ai] streaming response started, requestId =", body.requestId, "content-type =", ct);
      let buf = "";
      let gotAnyChunk = false;
      res.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            if (!gotAnyChunk) {
              send("ai:done", { requestId: body.requestId, error: "\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\uFF08\u65E0\u4EFB\u4F55\u5185\u5BB9\u5E27\uFF09" });
            } else {
              send("ai:done", { requestId: body.requestId });
            }
            return;
          }
          try {
            const obj = JSON.parse(data);
            if (obj.error) {
              send("ai:done", { requestId: body.requestId, error: obj.error.message || JSON.stringify(obj.error).slice(0, 300) });
              return;
            }
            const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
            if (delta && delta.reasoning_content) {
              gotAnyChunk = true;
              send("ai:chunk", { requestId: body.requestId, content: delta.reasoning_content });
            }
            if (delta && delta.content) {
              gotAnyChunk = true;
              send("ai:chunk", { requestId: body.requestId, content: delta.content });
            }
          } catch {
          }
        }
      });
      res.on("end", () => {
        console.log("[ai] stream ended, requestId =", body.requestId, "gotAnyChunk =", gotAnyChunk);
        if (!gotAnyChunk) {
          send("ai:done", { requestId: body.requestId, error: "\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\uFF08\u6D41\u7ED3\u675F\u4F46\u6CA1\u6709\u4EFB\u4F55\u5185\u5BB9\uFF09" });
        } else {
          send("ai:done", { requestId: body.requestId });
        }
      });
      res.on("error", (e) => {
        console.log("[ai] stream error:", e.message);
        send("ai:done", { requestId: body.requestId, error: `\u7F51\u7EDC\u9519\u8BEF: ${e.message}` });
      });
    }
  );
  req.on("error", (e) => {
    console.log("[ai] request error:", e.message);
    send("ai:done", { requestId: body.requestId, error: `\u8BF7\u6C42\u5931\u8D25: ${e.message}` });
  });
  req.write(payload);
  req.end();
  return { ok: true };
});
function readAppVersion() {
  try {
    return require(path.join(app.getAppPath(), "package.json")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
ipcMain.handle("app:getVersion", () => ({ ok: true, version: readAppVersion() }));
ipcMain.handle("app:checkUpdate", async () => {
  const current = readAppVersion();
  const feed = (process.env.UPDATE_URL || "").trim();
  if (!feed) return { ok: true, current, latest: current, hasUpdate: false };
  try {
    const res = await fetch(feed, { signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return { ok: false, message: `\u66F4\u65B0\u670D\u52A1\u8FD4\u56DE HTTP ${res.status}` };
    const j = await res.json();
    const latest = String(j.version || "");
    return {
      ok: true,
      current,
      latest,
      hasUpdate: !!latest && latest !== current,
      downloadUrl: j.url || "",
      notes: j.notes || ""
    };
  } catch (e) {
    return { ok: false, message: `\u68C0\u67E5\u66F4\u65B0\u5931\u8D25: ${e.message}` };
  }
});
ipcMain.handle("shell:openExternal", (_e, { url }) => {
  const u = String(url || "");
  if (/^https?:\/\//i.test(u)) shell.openExternal(u);
  return { ok: true };
});
