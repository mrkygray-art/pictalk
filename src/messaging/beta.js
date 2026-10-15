// Features still being tried out, off for everyone until turned on on a phone with ?beta=report
// (remembered on that phone; ?beta=off turns it back off). Step 3 of the voice + photo -> Procore
// record spec stays hidden from everyone else until it's been tested end to end.
const KEY = "sitesnap-beta";

export function readBeta() {
  try {
    const q = new URLSearchParams(window.location.search).get("beta");
    if (q === "report") localStorage.setItem(KEY, "report");
    if (q === "off") localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === "report";
  } catch {
    return false;
  }
}
