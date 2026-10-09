// The PicTalk help guide: the only source the "Ask PicTalk" help chat answers from
// (functions/help.js). Written for field techs, in the app's own button names.
// Keep it current: when a feature or a button name changes, update the matching section here
// in the same change (the quick-start PDF in public/ only covers the core flow, so it rarely
// needs updating).

const SECTIONS = [
  {
    id: "what-is",
    title: "What PicTalk is",
    text: `PicTalk is a phone app for site walks. At each spot you take a photo and say what you see. PicTalk keeps the photo, the voice recording, and a written copy of your words together as a "stop," and groups the stops into a job, so a whole site walk stays together. When you end the job, PicTalk can write a short AI summary with action items, and you can download the job as a PDF report. A second tab, Piccolo, turns a finished job into a work order, parts list, and quote. PicTalk works with no signal: everything is saved on the phone first and uploads when signal comes back. It is a free demo app, so please don't record real customer information.`,
  },
  {
    id: "quick-start",
    title: "Quick start: your first job in five steps",
    text: `1. Tap Start New Job. The bar at the top changes from "No job open" to the job you're saving to.
2. Tap Take Photo and take a picture of what you're looking at (or pick one from your photos).
3. Tap Tap to Talk and say what you see. Tap the button again (it shows Stop and a timer) when you're done.
4. Tap Save This Stop. The stop appears under Saved stops. Repeat steps 2 to 4 at each spot.
5. When the walk is done, tap End Job. Add the customer and location if you like, then tap Save & Finish Job. PicTalk then writes the AI summary, and you can download the PDF from the job's page.`,
  },
  {
    id: "jobs",
    title: "Starting a job and the job bar",
    text: `Every stop goes into a job. Tap Start New Job on the main screen to open one. Only one job is open at a time; starting a new job finishes the one that was open. The bar at the top of the screen always shows where stops are going: "Saving to" and the job name, or "No job open, nothing is being saved." If you take a photo or talk with no job open, PicTalk asks you to start a new job first. A new job is named with its date and time until you add a customer and location when you end it. In this demo a job can hold up to 10 stops; end the job and start a new one to keep going.`,
  },
  {
    id: "photo",
    title: "Taking a photo",
    text: `Tap Take Photo. On a phone it opens the camera (or lets you choose a photo you already took). The photo shows on screen until you save the stop. Tap Retake Photo to replace it before saving. A stop can be just a photo, just a voice note, or both; both is best.`,
  },
  {
    id: "talk",
    title: "Recording a voice note (Tap to Talk)",
    text: `Tap Tap to Talk and speak. The button turns into Stop with a timer while it records; tap it again to stop. You can listen back before saving. Tap Talk Again to record it over. The first time, your browser asks for permission to use the microphone; tap Allow. After the stop uploads, PicTalk writes down your words (the card shows "Writing it down…" for a moment, then the text). If nothing was said, the card shows "No speech heard." Voice recordings are deleted after 5 days in this demo, but the written words are kept for good. On a computer with more than one microphone, a "Microphone: … Change" line under Tap to Talk lets you pick which one to use.`,
  },
  {
    id: "save-stop",
    title: "Saving a stop and what the status means",
    text: `Tap Save This Stop to save the photo and voice note together. The stop shows under Saved stops right away, newest first. It is saved on your phone first, then uploaded. Status lines on the stop card: "Saved on this phone" or "Waiting to upload" means it hasn't uploaded yet (usually no signal; it uploads by itself when signal comes back, so keep the app open or come back to it); "Writing it down…" means the words are being transcribed; then the words appear. You don't need to do anything to retry; PicTalk keeps trying.`,
  },
  {
    id: "offline",
    title: "Working with no signal",
    text: `PicTalk is built for basements, mechanical rooms, and places with no signal. With no signal you can still start and end jobs, take photos, record voice notes, and save stops; they wait on the phone and upload by themselves when signal returns. Things that need signal: the written words (transcription), Describe photo, the AI summary, deleting a stop that already uploaded, signing in, Piccolo drafts, and the help chat. To open PicTalk with no signal at all, install it on your phone first (see Installing PicTalk). Don't clear your browser data while stops are still waiting to upload.`,
  },
  {
    id: "edit-stop",
    title: "Changing a saved stop: words, location, photo, move, delete",
    text: `Each saved stop card has buttons for fixing it later:
- Edit words: fix the written copy of what you said (for example a misheard part number). The PDF, summary, and Piccolo use your edited words.
- Add location / Edit location: where on the site the stop was, like "Reception desk," "IDF closet," or "North soffit." Places you already used in the job are one tap. The location shows on the card ("Stop 3 · IDF closet"), in the PDF, in the summary, and in Piccolo's work order. Remove Location clears it.
- Add photo (a stop with no photo) or Replace photo (asks first; the old photo is deleted).
- Move or delete this stop: Move to a Different Job moves the stop into another job; Delete Stop removes it for good (an uploaded stop needs signal to delete, so its files are removed too).`,
  },
  {
    id: "describe-photo",
    title: "Describe photo (AI photo descriptions)",
    text: `Each stop with a photo has a Describe photo button. AI looks at the photo and writes 2 to 4 plain sentences: what it shows and where, any readable text copied exactly (brand, model and serial numbers, labels, meter readings), and visible condition such as cracks, rust, water stains, or exposed wiring. It also uses your words for context. It's useful for capturing a label you didn't read aloud. You can Edit description or delete it. Tapped with no signal, it waits and runs once signal returns. Demo limits: 3 descriptions per stop and 30 per account per day. The description goes into the PDF, the AI summary, and Piccolo.`,
  },
  {
    id: "end-job",
    title: "Ending a job",
    text: `Tap End Job at the bottom of the Saved stops list. The Finish sheet asks for the Customer and Location (both optional; they name the job, like "Customer – Location – date"). You can also add wrap-up notes there (see Wrap-up notes). Then tap:
- Save & Finish Job to finish it and stay in PicTalk (the AI summary starts building), or
- Finish & Send to Piccolo to finish it and open it in Piccolo for a work order and quote, or
- Keep Going to go back without ending.
Your saved stops stay saved either way. If a photo or voice note is on screen but not saved yet, ending the job throws it away, so save the stop first.`,
  },
  {
    id: "wrap-up",
    title: "Wrap-up notes (field notes and customer comments)",
    text: `When you end a job (or later, on the job's page) you can record two optional notes: Add field notes (your overall notes: scope, access, schedule, anything that isn't one spot) and Add customer comments (what the customer asked for; PicTalk asks you to confirm the customer agreed to be recorded). The recorder has Pause and Continue, and Done. On Android, your words appear on screen as you speak; elsewhere they're written down after the recording uploads. You can edit the text afterward, and recording again adds to the note instead of replacing it. Wrap-up notes are the most important input to the AI summary and Piccolo, and they appear in the PDF.`,
  },
  {
    id: "summary",
    title: "The AI summary",
    text: `After you end a job, PicTalk drafts a short summary and a list of action items ranked High, Medium, or Low, using your wrap-up notes, the words at each stop, and any photo descriptions. Each action item links to the stop or note it came from. The summary is marked as an AI draft: read it, use Edit summary or Edit action item to fix anything, then tap Approve Summary. Only an approved summary goes into the PDF. Editing an approved summary puts it back to draft. Regenerate summary builds a new one (limit 5 per job and 20 per account per day in the demo). If it says "out of date," you changed words, photos, or notes after it was written; regenerate it. A job with no speech, photo descriptions, or wrap-up notes gets no summary. It needs signal.`,
  },
  {
    id: "my-jobs",
    title: "My Jobs, Recent jobs, and the job page",
    text: `With no job open, the main screen lists your Recent jobs under Start New Job; tap one to open it. My Jobs (top right of the main screen) lists every job, Open and Finished. A job's page shows its stops, wrap-up notes, AI summary, and buttons to Download PDF or Share PDF, Open in Piccolo, Edit customer & location, and Reopen This Job (reopening makes it the open job again so you can add stops; any other open job is finished). Delete This Job appears at the bottom for the example jobs and the Try Piccolo sample.`,
  },
  {
    id: "pdf",
    title: "The PDF report",
    text: `On a finished job's page, tap Download PDF (on a computer) or Share PDF (on a phone, to send it by text, email, or a drive). The first time, PicTalk asks for your initials for the report (blank is fine). The PDF has the customer, location, a revision number that goes up each time you export, each stop's photo, words, location, time, and photo description, the wrap-up notes, and the AI summary if you approved it. It needs signal to load the photos.`,
  },
  {
    id: "install",
    title: "Installing PicTalk on your phone",
    text: `PicTalk is a web app you can put on your home screen so it opens like an app, full screen, even with no signal. Tap Install PicTalk on this phone at the bottom of the main screen for steps that match your browser. In Chrome on Android it's one tap. On iPhone in Safari: tap Share, then Add to Home Screen, then Add. Firefox and other browsers: use Add to Home screen in the browser menu. If you opened PicTalk inside another app (like a text message or social app), open it in your phone's browser first.`,
  },
  {
    id: "account",
    title: "Guest mode, saving your work, and signing in",
    text: `You can use PicTalk without an account: you start as a guest. Guest jobs are deleted after 7 days, so don't capture anything you need to keep until you save your work. Tap Save my work (top right) and sign in with Google or an emailed link; your jobs, photos, and notes stay with you and stop expiring, and you can open them on another device by signing in there. Piccolo needs a signed-in account.`,
  },
  {
    id: "example-jobs",
    title: "The example jobs",
    text: `A new visitor's PicTalk opens with seven made-up example jobs (a kitchen remodel, an EV charger, home security, a backyard fence, sprinkler repairs, flooring, and a warehouse lighting retrofit), so there's something to explore right away. They're your own copy: open them, edit them, send them to Piccolo, or delete them with Delete This Job. As a guest they're removed after 7 days like your other jobs.`,
  },
  {
    id: "piccolo",
    title: "Piccolo: work orders, parts lists, and quotes",
    text: `Piccolo is the second tab at the top (PicTalk | Piccolo). It turns a finished job into an AI-drafted work order, parts list, and quote, and needs a quick sign-in. New? Tap Try Piccolo to open a sample site walk from one of eight trades; "Try a different sample" swaps it. For your own job, use Finish & Send to Piccolo when ending it, or Open in Piccolo on the job's page. The draft has tabs: Overview, Work Order, Parts, Quote, and Media. Every line shows where it came from; tap it to see the stop. Lines marked Verify have a part number the AI suggested that wasn't in your words; prices stay blank unless they come from your labor rate or a past quote. Tap a line to edit it, Add Line to add one, and set markup, tax, and terms on the Quote tab. Changes save by themselves and Undo is available. Tap Finalize to lock a version (it lists anything still unpriced or unchecked first), then Export a PDF (work order, parts list, quote), CSV files, or a full package. Add photos or notes in PicTalk sends you back to the job; a newer draft can then be compared with yours.`,
  },
  {
    id: "best-practices",
    title: "Best practices for great results",
    text: `- One stop per spot: take the photo first, then talk about that spot. Separate stops for separate locations make the PDF, summary, and work order much clearer.
- Say where you are first: "Front entrance, east side." Then also tap Add location on the stop.
- Talk like you're briefing a coworker who isn't there: what you see, what's wrong, what needs to be done, and how many.
- Read model and part numbers, labels, and measurements out loud, slowly; spell letters that sound alike ("B as in boy"). Check them afterward with Edit words.
- Give quantities and distances: "two cameras," "about 40 feet of cable," "three doors."
- Take a wide photo for context and a close-up for detail as two stops, or use Describe photo to capture a label.
- Record in the quietest spot you can, a few inches from the phone; avoid wind and running equipment.
- Keep each voice note short and focused (30 seconds to a minute); several short stops beat one long one.
- Use wrap-up notes for the big picture: overall scope, access and schedule, and what the customer asked for.
- Before you leave the site, scroll through Saved stops and fix any words that came out wrong.
- Read and approve the AI summary before you share the PDF; the summary only reports what you said.
- Install PicTalk on your phone before you go somewhere with no signal.
- Sign in with Save my work so your jobs don't expire, and don't record real customer data in this demo.`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    text: `- Tap to Talk does nothing or says the microphone is blocked: allow the microphone for this site in your browser's settings (site settings, Microphone), then reload.
- A stop says "Saved on this phone" or "Waiting to upload" for a long time: you probably have no signal. It uploads by itself when signal returns; keep PicTalk open for a minute once you're back in signal. Don't clear browser data until it uploads.
- "Writing it down…" for more than a few minutes: check your signal; it finishes after the voice note uploads.
- "No speech heard": the recording was silent or too quiet. Use Edit words to type it, or record a new stop closer to the phone.
- "Recording expired" or a voice note won't play: recordings are deleted after 5 days in this demo. The written words are kept.
- "This demo allows 10 stops per job": end the job and start a new one.
- The AI summary didn't appear: it needs the voice notes to be written down first and needs signal. Open the job from My Jobs and try again. A job with no words or notes gets no summary.
- Can't find a job: check My Jobs; guest jobs are deleted after 7 days unless you tap Save my work.
- Want to see what's happening behind the scenes: tap Engineering Mode at the bottom of the main screen for upload and sync status.`,
  },
  {
    id: "limits",
    title: "Demo limits",
    text: `PicTalk is a public demo. Limits: up to 10 stops per job; voice recordings are deleted after 5 days (the words are kept); guest jobs are deleted after 7 days unless you save your work; AI summaries: 5 per job and 20 per day; photo descriptions: 3 per stop and 30 per day; Piccolo drafts are limited per day and per job; the help chat answers a limited number of questions per day. Please don't record real customer information.`,
  },
  {
    id: "engineering",
    title: "Engineering Mode and the Evaluation Lab",
    text: `Engineering Mode (a link at the bottom of the main screen; off by default) shows an inside view: the path each stop takes from the phone to the cloud, upload timings, what's waiting to upload, errors, and a Sync now button. It only shows your own data. The Evaluation Lab (also linked at the bottom) shows results of automated tests that simulate losing signal mid-recording and check nothing is lost.`,
  },
];

module.exports = { SECTIONS };
