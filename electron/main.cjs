const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let apiServer = null;
let apiPort = Number(process.env.PORT || "3001");

const getApiUrl = () => `http://127.0.0.1:${apiPort}`;

const getAppRoot = () => app.getAppPath();
const getDistServerEntry = () => path.join(getAppRoot(), "dist-server", "server", "index.js");
const getStaticDir = () => path.join(getAppRoot(), "dist");
const getLogFile = () => path.join(app.getPath("userData"), "desktop.log");

function writeLog(message) {
  try {
    fs.appendFileSync(getLogFile(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures so app startup is not blocked.
  }
}

function setupAutoUpdates() {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.error("Auto-update error:", error?.message || error);
  });

  autoUpdater.on("update-available", async (info) => {
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Version ${info.version} is available.`,
      detail: "Download the update now? The app will restart after installation.",
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate().catch((error) => {
        console.error("Failed to download update:", error?.message || error);
      });
    }
  });

  autoUpdater.on("update-downloaded", async () => {
    const result = await dialog.showMessageBox({
      type: "question",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: "An update has been downloaded.",
      detail: "Restart now to install the latest version?",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error("Failed to check for updates:", error?.message || error);
  });
}

function createWindow() {
  writeLog(`Creating window. API URL: ${getApiUrl()}`);
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

  mainWindow.loadURL(getApiUrl());
  mainWindow.webContents.on("did-finish-load", () => {
    writeLog(`Renderer loaded successfully: ${getApiUrl()}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeLog(`Renderer process exited unexpectedly: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) {
      writeLog(`Renderer console message [${level}]: ${message}`);
    }
  });
  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, validatedURL) => {
    writeLog(`did-fail-load url=${validatedURL} code=${errorCode} message=${errorDescription}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Midas Payroll could not load",
      message: "The desktop window failed to load the app page.",
      detail: `URL: ${validatedURL}\nError ${errorCode}: ${errorDescription}`,
    });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

async function startApiServer() {
  const serverEntry = getDistServerEntry();
  const staticDir = getStaticDir();
  writeLog(`App root: ${getAppRoot()}`);
  writeLog(`Server entry: ${serverEntry}`);
  writeLog(`Static dir: ${staticDir}`);
  writeLog(`Server entry exists: ${fs.existsSync(serverEntry)}`);
  writeLog(`Static dir exists: ${fs.existsSync(staticDir)}`);
  writeLog(`Static index exists: ${fs.existsSync(path.join(staticDir, "index.html"))}`);
  const serverModule = await import(pathToFileURL(serverEntry).href);
  const dataDir = path.join(app.getPath("userData"), "data");

  const startupResult = await serverModule.startServer({
    port: apiPort,
    dataDir,
    serveClient: true,
    staticDir,
  });
  apiServer = startupResult.server;
  apiPort = startupResult.port;
  writeLog(`API server started on ${getApiUrl()}`);
}

app.whenReady().then(async () => {
  app.setName("Midas Payroll");
  writeLog("App starting...");
  try {
    await startApiServer();
    createWindow();
    setupAutoUpdates();
  } catch (error) {
    console.error("Failed to start desktop app:", error?.message || error);
    writeLog(`Startup failed: ${error?.message || error}`);
    dialog.showErrorBox(
      "Midas Payroll could not start",
      `The local server failed to start.\n\n${error?.message || error}\n\nLog file: ${getLogFile()}`,
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    if (!navigationUrl.startsWith(getApiUrl())) {
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
