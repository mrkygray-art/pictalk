// Real problems the Evaluation Lab caught, and what was changed. Evidence for "before":
// lab/before-fixes.json (the first lab run, on the code before these fixes).
export const FIXES = [
  {
    id: 'FIX-01',
    title: 'Live words dropping mid-sentence could lose words',
    caughtBy: 'drop-live',
    before: 'Failed (1 of 1 runs)',
    what: 'When signal went while recording a wrap-up note, the app waited for the live connection to report that it had dropped. With no report, the note was saved as complete with only the words heard before the drop, and the full recording was never written down.',
    fix: 'Losing signal now counts as a drop straight away, so the whole recording is written down after it uploads.',
    liveApp: 'Possibly: only when a phone’s connection hangs instead of closing as signal goes.',
  },
  {
    id: 'FIX-02',
    title: 'PDF tools weren’t saved for use with no signal',
    caughtBy: 'open-offline',
    before: 'Failed (1 of 1 runs): 5 files missing',
    what: 'The offline copy saved only the files the first screen loads. The PDF tools load on first export, so on a phone that had never exported, exporting with no signal could fail. New versions were also saved piece by piece, only as each file was used.',
    fix: 'Each build now lists every file it’s made of. The phone saves them all at once, and a new version replaces the old copy in one step.',
    liveApp: 'Yes: a first PDF export with no signal.',
  },
  {
    id: 'FIX-03',
    title: 'Saved copy ignored when the server adds a “Vary” header',
    caughtBy: 'open-offline, restart-offline',
    before: 'Failed (2 of 2 runs): app didn’t open',
    what: 'The lab’s test server marks files “Vary: Origin”. The saved copy then didn’t count as a match, so the app wouldn’t open with no signal.',
    fix: 'App files are now matched by name alone. Their names already change with every version.',
    liveApp: 'No: Firebase Hosting doesn’t send that header today. Fixed so a hosting change can’t break opening offline.',
  },
];

export const NOT_MEASURED = [
  ['Real transcription', 'The lab’s stand-in only reports how much audio it received. Whether Deepgram gets the words right is a separate test.'],
  ['Real phones', 'Runs use desktop Chrome at phone size. Android Chrome and Firefox were checked by hand; iPhone hasn’t been tested.'],
  ['Real network speed', 'Everything runs on one computer, so times after signal returns are near zero. On a phone, add the upload over cell and the transcription time.'],
  ['Slow or weak signal', 'Signal is either on or off here. Very slow uploads (one bar) aren’t simulated yet.'],
  ['Long recordings and big photos', 'Test recordings are 1.5–4 s and the test photo is small.'],
];
