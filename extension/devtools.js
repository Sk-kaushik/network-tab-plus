// Registers the "Network Tab+" tab inside DevTools, next to Network.
import { armCapture } from "./stream.js";

chrome.devtools.panels.create("Network Tab+", "icons/icon32.png", "panel.html");

// Wrapped as early as we can, so a stream is caught even if you open our tab
// later. about:blank and a page mid-navigation refuse, hence the retries.
// A stream the page starts during its own load can still beat us to it.
let tries = 0;
const arm = () => armCapture((result, error) => {
  if (error && tries++ < 5) setTimeout(arm, 400);
});

arm();
chrome.devtools.network.onNavigated.addListener(() => { tries = 0; arm(); });
