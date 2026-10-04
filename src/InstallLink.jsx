import { useEffect, useState } from "react";

// Chrome offers to install a site as an app with its own icon. Installed, PicTalk opens
// straight from the home screen, with or without signal. The offer can arrive before
// React draws the page, so it's caught here as soon as this file loads.
let offer = null;
const listeners = new Set();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // show our own small link instead of the browser's banner
  offer = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener("appinstalled", () => {
  offer = null;
  listeners.forEach((fn) => fn());
});

/** "Install PicTalk on this phone" — only shown when the browser can install it. */
export default function InstallLink() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const fn = () => redraw((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  if (!offer) return null;
  const install = async () => {
    const e = offer;
    offer = null;
    e.prompt();
    await e.userChoice.catch(() => null);
    redraw((n) => n + 1);
  };
  return (
    <button className="text-btn eng-toggle" onClick={install}>
      Install PicTalk on this phone
    </button>
  );
}
