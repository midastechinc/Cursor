"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("midasPayrollDesktop", {
  platform: process.platform,
  isDesktop: true,
  printCurrentWindow: () => ipcRenderer.invoke("desktop-print-current"),
  openMailto: (href) => ipcRenderer.invoke("desktop-open-mailto", href),
});
