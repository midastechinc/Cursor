const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
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
const isAddressInUseError = (error) => Boolean(error && typeof error === "object" && error.code === "EADDRINUSE");
const DB_FILE_NAME = "payroll.sqlite";

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
    // Allow internal popup windows used by print templates.
    if (url === "about:blank" || url.startsWith(getApiUrl())) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
}

const copyFileIfMissing = (sourcePath, targetPath) => {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
};

const resolveDesktopDataDir = () => {
  const legacyDir = path.join(os.homedir(), ".midas-payroll", "data");
  const userDataDir = path.join(app.getPath("userData"), "data");
  const legacyDbPath = path.join(legacyDir, DB_FILE_NAME);
  const userDbPath = path.join(userDataDir, DB_FILE_NAME);
  const roamingDbPath = path.join(app.getPath("appData"), "ontario-payroll-v1", "data", DB_FILE_NAME);

  if (fs.existsSync(legacyDbPath)) {
    writeLog(`Using legacy data directory: ${legacyDir}`);
    return legacyDir;
  }

  if (fs.existsSync(roamingDbPath)) {
    writeLog(`Using roaming data directory: ${path.dirname(roamingDbPath)}`);
    return path.dirname(roamingDbPath);
  }

  if (fs.existsSync(userDbPath)) {
    writeLog(`Using user data directory: ${userDataDir}`);
    return userDataDir;
  }

  writeLog(`No existing database found. Using user data directory: ${userDataDir}`);
  return userDataDir;
};

ipcMain.handle("desktop-print-current", async () => {
  if (!mainWindow) {
    return { ok: false, error: "No active desktop window." };
  }
  try {
    const frame = mainWindow.webContents.mainFrame;
    await frame.executeJavaScript("window.print()", true);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("desktop-open-mailto", async (_event, url) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

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
  const dataDir = resolveDesktopDataDir();

  let startupResult;
  try {
    startupResult = await serverModule.startServer({
      port: apiPort,
      dataDir,
      serveClient: true,
      staticDir,
    });
  } catch (error) {
    if (isAddressInUseError(error)) {
      writeLog(`Port ${apiPort} is in use. Retrying with an ephemeral port.`);
      startupResult = await serverModule.startServer({
        port: 0,
        dataDir,
        serveClient: true,
        staticDir,
      });
    } else {
      throw error;
    }
  }
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
  contents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url.startsWith(getApiUrl())) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    if (
      navigationUrl === "about:blank"
      || navigationUrl.startsWith("data:")
      || navigationUrl.startsWith("blob:")
      || navigationUrl.startsWith(getApiUrl())
    ) {
      return;
    }
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
