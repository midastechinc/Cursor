"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("midasPayrollDesktop", {
  platform: process.platform,
  isDesktop: true,
  printCurrentWindow: () => ipcRenderer.invoke("desktop-print-current"),
  openMailto: (href) => ipcRenderer.invoke("desktop-open-mailto", href),
  emailPayStub: (payload) => ipcRenderer.invoke("desktop-email-paystub", payload),
  exportDatabase: () => ipcRenderer.invoke("desktop-export-database"),
  importDatabase: () => ipcRenderer.invoke("desktop-import-database"),
  runSoftwareUpdate: () => ipcRenderer.invoke("desktop-run-software-update"),
});
