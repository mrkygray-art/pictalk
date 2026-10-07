import { useEffect, useState } from "react";
import Sheet from "./Sheet";

// "Install PicTalk on this phone". Chrome offers to install a site as an app with its own icon;
// installed, PicTalk opens straight from the home screen, with or without signal. The offer can
// arrive before React draws the page, so it's caught here as soon as this file loads.
// iPhones never make that offer (and neither do Firefox, DuckDuckGo, or Samsung Internet), so on
// those the link opens a sheet with numbered steps and pictures of the real buttons, matched to the
// browser. The steps are the React version of Bluey's install-help.js (also used by the portfolio
// and NightAgent); keep them in sync. On an iPhone in Safari (iOS 26+): ⋯ next to the address bar,
// Share, Add to Home Screen, keep Open as Web App on, Add.
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

const ua = navigator.userAgent || "";
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const phone = window.matchMedia("(pointer: coarse)").matches;

function browser() {
  if (/FBAN|FBAV|Instagram|LinkedInApp|GSA\/|Line\/|Snapchat|Twitter|musical_ly|TikTok/i.test(ua)) return "inapp";
  if (isIOS) {
    if (/CriOS/.test(ua)) return "ios-chrome";
    if (/FxiOS/.test(ua)) return "ios-firefox";
    if (/EdgiOS/.test(ua)) return "ios-edge";
    return "ios-safari";
  }
  if (/DuckDuckGo/.test(ua)) return "ddg";
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/Firefox/.test(ua)) return "firefox";
  return "android";
}

// Small pictures of the buttons people look for.
const Icon = {
  more: <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  share: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" /><path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" /></svg>,
  add: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></svg>,
  toggle: <svg viewBox="0 0 34 20" aria-hidden="true"><rect x="1" y="1" width="32" height="18" rx="9" fill="#34c759" /><circle cx="24" cy="10" r="7.5" fill="#fff" /></svg>,
  menu: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  dots: <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>,
  safari: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" /></svg>,
};

function steps() {
  const add = ["add", <>Scroll down and tap <b>Add to Home Screen</b>.</>, <>Not in the list? Tap <b>Edit Actions</b> at the bottom and add it.</>];
  switch (browser()) {
    case "inapp": return { lead: "This page is open inside another app. Open it in your phone's browser first:", list: [["dots", <>Tap the <b>⋯</b> or <b>⋮</b> menu in the corner.</>], ["safari", <>Tap <b>Open in {isIOS ? "Safari" : "browser"}</b>.</>], ["add", "Then come back to this guide there."]] };
    case "ios-chrome": return { list: [["share", <>Tap the <b>Share</b> button in the address bar, at the top right.</>], add, ["add", <>Tap <b>Add</b>.</>]] };
    case "ios-firefox": return { list: [["menu", <>Tap the <b>menu</b> button (three lines) at the bottom right.</>], ["share", <>Tap <b>Share</b>.</>], add, ["add", <>Tap <b>Add</b>.</>]] };
    case "ios-edge": return { list: [["more", <>Tap the <b>⋯</b> menu at the bottom.</>], ["share", <>Tap <b>Share</b>.</>], add, ["add", <>Tap <b>Add</b>.</>]] };
    case "ios-safari": return { list: [["more", <>Tap the <b>⋯</b> button next to the address bar.</>, "Older iPhones: tap the Share button instead and skip to step 3."], ["share", <>Tap <b>Share</b>.</>], add, ["toggle", <>Keep <b>Open as Web App</b> on, then tap <b>Add</b>.</>]] };
    case "ddg": return { list: [["dots", <>Tap the <b>⋮</b> menu.</>], ["add", <>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</>]] };
    case "samsung": return { list: [["menu", <>Tap the <b>☰</b> menu.</>], ["add", <>Tap <b>Add page to</b>, then <b>Home screen</b>.</>]] };
    case "firefox": return { list: [["dots", <>Tap the <b>⋮</b> menu.</>], ["add", <>Tap <b>Add app to Home screen</b> (it may say <b>Install</b>).</>]] };
    default: return { list: [["dots", <>Tap the <b>⋮</b> menu at the top right.</>], ["add", <>Tap <b>Add to Home screen</b> or <b>Install app</b>.</>]] };
  }
}

/** "Install PicTalk on this phone": Chrome's install dialog, or the step-by-step guide. */
export default function InstallLink() {
  const [, redraw] = useState(0);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const fn = () => redraw((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  if (installed() || !(offer || phone || isIOS)) return null;
  const install = async () => {
    if (!offer) { setGuide(true); return; }
    const e = offer;
    offer = null;
    e.prompt();
    await e.userChoice.catch(() => null);
    redraw((n) => n + 1);
  };
  const s = guide ? steps() : null;
  return (
    <>
      <button className="text-btn eng-toggle" onClick={install}>
        Install PicTalk on this phone
      </button>
      {guide && (
        <Sheet title="Put PicTalk on your Home Screen" onClose={() => setGuide(false)}>
          <p>{s.lead || "It takes about 20 seconds. Then PicTalk opens from its own icon, full screen, and works with no signal."}</p>
          <ol className="install-steps">
            {s.list.map(([icon, text, small], i) => (
              <li key={i}>
                <span className="install-step-icon">{Icon[icon]}</span>
                <span>{text}{small && <small>{small}</small>}</span>
              </li>
            ))}
          </ol>
          {!s.lead && <p>Then look for the new icon on your Home Screen.</p>}
          <button className="big-btn" onClick={() => setGuide(false)}>Got it</button>
        </Sheet>
      )}
    </>
  );
}
