const { app, BrowserWindow, ipcMain, Menu, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");

const SERVER_PORT = String(process.env.PORT || "3000");

let serverProcess = null;
let mainWindow = null;

function getRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.join(__dirname, "..");
}

function startServer() {
  return new Promise((resolve, reject) => {
    if (serverProcess) {
      resolve();
      return;
    }
    const ROOT = getRoot();
    const runtimeDataDir = path.join(app.getPath("userData"), "data");
    serverProcess = fork(path.join(ROOT, "server.js"), [], {
      cwd: app.isPackaged ? process.resourcesPath : ROOT,
      env: { ...process.env, PORT: SERVER_PORT, DATA_DIR: runtimeDataDir },
      silent: false
    });
    serverProcess.on("error", reject);
    setTimeout(resolve, 900);
  });
}

function getAppIconPath() {
  return path.join(getRoot(), "public", "assets", "ccro-logo.png");
}

function getWindowNativeIcon() {
  const iconPath = getAppIconPath();
  if (!fs.existsSync(iconPath)) return undefined;
  const img = nativeImage.createFromPath(iconPath);
  return img.isEmpty() ? undefined : img;
}

function createWindow() {
  const ROOT = getRoot();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: getWindowNativeIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ROOT, "electron", "preload.js")
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function printHtmlDirect(html) {
  return new Promise((resolve, reject) => {
    const printWindow = new BrowserWindow({
      show: false,
      icon: getWindowNativeIcon(),
      webPreferences: {
        sandbox: true
      }
    });

    const encoded = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    printWindow.loadURL(encoded).then(() => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          landscape: false
        },
        (success, errorType) => {
          printWindow.close();
          if (!success) {
            reject(new Error(errorType || "Print failed"));
            return;
          }
          resolve();
        }
      );
    }).catch((err) => {
      printWindow.close();
      reject(err);
    });
  });
}

ipcMain.handle("direct-print-html", async (_event, payload) => {
  if (!payload || typeof payload.html !== "string" || !payload.html.trim()) {
    return { ok: false, error: "Missing printable HTML." };
  }
  try {
    await printHtmlDirect(payload.html);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "Print failed." };
  }
});

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.regis.inventory");
  }
  Menu.setApplicationMenu(null);
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error(err);
    killServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startServer()
      .then(() => createWindow())
      .catch((err) => console.error(err));
  }
});
