import Sheet from "../Sheet";

// Guest demo (docs/guest-demo.md; the context is in demo.js): pinned to the top of every screen in the demo
export function DemoBanner({ onExit }) {
  return (
    <div className="demo-banner" role="status">
      <span><strong>Demo mode:</strong> view only</span>
      <button type="button" className="text-btn inline" onClick={onExit}>Exit demo</button>
    </div>
  );
}

// What a blocked button would do in the real app
export function DemoSheet({ what, onClose }) {
  return (
    <Sheet title="This is a view-only demo" onClose={onClose}>
      <p>{what} is turned off here, so nothing is sent to Procore.</p>
      <p className="msg-status">Everything you can see is real data from the demo projects in Procore. In the real app, your team signs in with their own Procore accounts and this button works.</p>
      <button type="button" className="save-btn" onClick={onClose}>Got It</button>
    </Sheet>
  );
}
