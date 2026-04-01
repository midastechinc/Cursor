"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("midasPayrollDesktop", {
  platform: process.platform,
});
