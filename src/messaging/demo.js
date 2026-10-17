import { createContext, useContext } from "react";

// Guest demo (docs/guest-demo.md): someone who opened /demo is signed in as the view-only demo guest. They can look
// at everything SiteSnap reads from Procore; anything that would write shows a friendly note instead (DemoSheet in
// DemoBanner.jsx). The server refuses those writes too (api/_procore.js, firestore.rules, functions), so this is
// only the nice part.
export const DemoContext = createContext({ demo: false, explain: () => {} });
export const useDemo = () => useContext(DemoContext);

// Run fn, or in the demo explain what it would have done. Usage: onClick={guard("Sending a message", send)}
export function useDemoGuard() {
  const { demo, explain } = useDemo();
  return (what, fn) => (...args) => (demo ? explain(what) : fn(...args));
}
