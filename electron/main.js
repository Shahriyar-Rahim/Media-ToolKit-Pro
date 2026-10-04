const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("path");
const { registerIpc } = require("./ipc/register");
const { openDb } = require("./services/db");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:5173";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0f1419",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const ok = isDev ? url.startsWith(DEV_URL) : url.startsWith("file://");
    if (!ok) e.preventDefault();
  });
  if (isDev) win.loadURL(DEV_URL);
  if (isDev) {
    win.webContents.openDevTools();
  } else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return win;
}

app.whenReady().then(() => {

  Menu.setApplicationMenu(null);
  
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; img-src 'self' data: file:;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; connect-src 'self' https:; object-src 'none'; base-uri 'none'";
  session.defaultSession.webRequest.onHeadersReceived((d, cb) =>
    cb({
      responseHeaders: {
        ...d.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    }),
  );
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));

  const db = openDb(app.getPath("userData"));
  const win = createWindow();
  registerIpc({ db, getWindow: () => win, userData: app.getPath("userData") });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
