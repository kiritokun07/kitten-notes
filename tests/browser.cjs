const { chromium } = require("playwright");
const path = require("node:path");
const extension = path.resolve(__dirname, "../extension");
const channel = process.env.NOTES_TEST_BROWSER || "chromium";
async function launchExtension(profile) {
  const context = await chromium.launchPersistentContext(profile, {
    channel, headless: true, ignoreDefaultArgs: ["--disable-extensions"],
    args: channel === "chrome" ? ["--enable-unsafe-extension-debugging"] :
      ["--disable-extensions-except=" + extension, "--load-extension=" + extension]
  });
  if (channel === "chrome") {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: extension });
    await cdp.detach();
    return { context, panelUrl: "chrome-extension://" + id + "/panel.html" };
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 7000 });
  return { context, panelUrl: new URL("panel.html", worker.url()).href };
}
module.exports = { launchExtension };
