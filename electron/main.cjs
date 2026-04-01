const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow = null;
let apiServer = null;

const API_PORT = Number(process.env.PORT || "3001");
const API_URL = `http://127.0.0.1:${API_PORT}`;

const getAppRoot = () => app.getAppPath();
const getDistServerEntry = () => path.join(getAppRoot(), "dist-server", "index.js");
const getStaticDir = () => path.join(getAppRoot(), "dist");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(API_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

async function startApiServer() {
  const serverEntry = getDistServerEntry();
  const serverModule = await import(pathToFileURL(serverEntry).href);
  const dataDir = path.join(app.getPath("userData"), "data");

  apiServer = await serverModule.startServer({
    port: API_PORT,
    dataDir,
    serveClient: true,
    staticDir: getStaticDir(),
  });
}

app.whenReady().then(async () => {
  app.setName("Midas Payroll");
  await startApiServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    if (!navigationUrl.startsWith(API_URL)) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiServer) {
    apiServer.close();
  }
});
