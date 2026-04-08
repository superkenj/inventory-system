const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronPrint", {
  directPrintHtml: async (html) => ipcRenderer.invoke("direct-print-html", { html })
});
