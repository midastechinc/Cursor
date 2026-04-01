const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let apiServer = null;
let apiPort = Number(process.env.PORT || "3001");

const getApiUrl = () => `http://127.0.0.1:${apiPort}`;

const getAppRoot = () => app.getAppPath();
const getDistServerEntry = () => path.join(getAppRoot(), "dist-server", "server", "index.js");
const getStaticDir = () => path.join(getAppRoot(), "dist");

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
  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, validatedURL) => {
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
  const serverModule = await import(pathToFileURL(serverEntry).href);
  const dataDir = path.join(app.getPath("userData"), "data");

  const startupResult = await serverModule.startServer({
    port: apiPort,
    dataDir,
    serveClient: true,
    staticDir: getStaticDir(),
  });
  apiServer = startupResult.server;
  apiPort = startupResult.port;
}

app.whenReady().then(async () => {
  app.setName("Midas Payroll");
  try {
    await startApiServer();
    createWindow();
    setupAutoUpdates();
  } catch (error) {
    console.error("Failed to start desktop app:", error?.message || error);
    dialog.showErrorBox(
      "Midas Payroll could not start",
      `The local server failed to start.\n\n${error?.message || error}`,
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
