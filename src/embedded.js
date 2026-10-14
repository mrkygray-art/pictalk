// Embedded mode: SiteSnap AI opened inside another site's iframe, e.g.
// /?companyId=123&projectId=456. The host fills those in from its own
// template, so an unfilled value can arrive as the literal "{{projectId}}".

// A value the host never filled in (blank or still a {{...}} placeholder) counts as missing
export function cleanId(value) {
  const v = (value ?? "").trim();
  if (!v || /^\{\{.*\}\}$/.test(v)) return null;
  return v;
}

// Running inside an iframe? A cross-origin parent can make window.top throw; that's still embedded.
export function inIframe(win = window) {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

// Read once on load: { embedded, companyId, projectId, hasIds } (ids are null when not received;
// hasIds = the link carried either parameter at all, even an unfilled one)
export function readEmbed(win = window) {
  const params = new URLSearchParams(win.location.search);
  return {
    embedded: inIframe(win),
    companyId: cleanId(params.get("companyId")),
    projectId: cleanId(params.get("projectId")),
    hasIds: params.has("companyId") || params.has("projectId"),
  };
}
