/**
 * electron-builder afterPack (Windows): embed icons on the .exe without
 * signAndEditExecutable (which unpacks winCodeSign.7z and requires symlink /
 * Developer Mode on Windows).
 * Requires build/icon.ico from `npm run icons` (sourced from public/assets/ccro-logo.png).
 */
const fs = require("fs");
const path = require("path");
const rcedit = require("rcedit");

module.exports = async function afterPackWinIcon(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "win32") return;

  const projectDir = packager.projectDir;
  const icoPath = path.join(projectDir, "build", "icon.ico");
  if (!fs.existsSync(icoPath)) {
    throw new Error(
      "Missing build/icon.ico. Run `npm run icons` before packaging (generates from public/assets/ccro-logo.png)."
    );
  }

  const appInfo = packager.appInfo;
  const exeName = `${appInfo.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: expected executable not found: ${exePath}`);
  }

  const winVer = appInfo.getVersionInWeirdWindowsForm();
  // Task Manager (and similar) shows FileDescription for the process name — use product name, not package description.
  const versionString = {
    FileDescription: appInfo.productName,
    ProductName: appInfo.productName
  };
  const copyright = appInfo.copyright;
  if (copyright) {
    versionString.LegalCopyright = copyright;
  }

  await rcedit(exePath, {
    icon: icoPath,
    "file-version": winVer,
    "product-version": winVer,
    "version-string": versionString
  });
};
