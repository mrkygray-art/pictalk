// Guest demo switch for the background senders (docs/guest-demo.md). MessagingApp turns it on for a demo session;
// the message, photo and inspection queues then never send anything (the screens show the view-only note at each
// send button instead). A safety net: the server and the rules refuse demo writes too.
let on = false;
export const setDemoMode = (value) => { on = !!value; };
export const demoMode = () => on;
