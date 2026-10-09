// The "Try Piccolo" sample job: a short, realistic security site walk (made-up business).
// Words are written the way a tech talks into the phone. No real customer data.
module.exports = {
  // Bump when the sample changes: Try Piccolo replaces an older sample with the new one
  version: 3,
  customer: "Sample: Riverside Dental",
  location: "Front office and parking lot",
  stops: [
    {
      place: "Front entrance",
      words:
        "Front entrance. The card reader by the glass door is cracked and the door strike sticks when you pull. They want a mobile credential reader here instead, something like an HID Signo.",
      photo: "A wall-mounted card reader beside an aluminum glass door frame. The reader's front cover has a visible crack across it.",
    },
    {
      place: "North soffit",
      words:
        "North side, facing the parking lot. They want two cameras up on the soffit to cover the lot and the walkway to the door. Soffit is about twelve feet. Cable run back to the IDF is about a hundred and twenty feet through the hallway drop ceiling.",
      photo: "An exterior wall with a soffit roughly 12 feet up. Beyond the walkway is a parking lot with about 20 spaces and two light poles.",
    },
    {
      place: "IDF closet",
      words:
        "IDF closet in the back hallway. Twenty-four port switch, maybe six ports open, and it's not PoE, so we'll swap it for a twenty-four port PoE switch. There's room in the rack, and the alarm panel is on the wall in this same closet.",
      photo: "A small wall-mounted rack with a 24-port network switch, a patch panel, and loose patch cables. A label on the rack reads IDF-1.",
    },
    {
      place: "Reception desk",
      words: "Reception desk. Office manager wants a panic button under the desk, tied into the alarm panel as a silent hold-up zone. About forty feet of wire back to the closet.",
      photo: "A reception desk with an open knee space under the counter and a computer on top.",
    },
  ],
  fieldNotes:
    "Cable path from the north soffit goes through the hallway drop ceiling to the IDF, about 120 feet each. Replace the switch with a 24-port PoE model to power the two cameras and the reader. Replace the door strike, it's worn out. Cameras at 12 feet, aimed at the lot and the walkway. Two techs, one evening.",
  customerComments:
    "We'd like this done before our inspection on the 20th. Work after 5 pm only; we see patients during the day. Our office manager will let you in and has the alarm code.",
  // Photos for the four stops (AI-generated sample images, functions/demo-photos/stop1-4.jpg)
  photos: ["stop1.jpg", "stop2.jpg", "stop3.jpg", "stop4.jpg"],
  // Quote settings for the sample (used instead of the company's own)
  quote: {
    quotePrefix: "SAMPLE-",
    markupPct: 15,
    taxPct: 9.5,
    laborRate: 95,
    terms: "Sample quote for demonstration only. 50% deposit to schedule, balance due on completion. Valid for 30 days.",
  },
};

// Sample prices so the sample quote is complete without typing. Only the sample job uses
// them, and each one is marked priceSource "sample" ("Sample price" in the app and PDF).
const ITEM_PRICES = [
  [/bracket|mount|adapter|back ?box/i, 45],
  [/camera/i, 425],
  [/reader|credential/i, 365],
  [/strike|lock/i, 185],
  [/switch|poe/i, 489],
  [/panic|duress|hold.?up/i, 95],
  [/cable|wire|cat ?6|conduit|pathway/i, 260],
  [/power supply|psu|transformer/i, 120],
  [/junction|j-?box/i, 25],
];
const CATEGORY_PRICES = { equipment: 150, cable: 260, labor: 650, misc: 75 };
// Per foot, when a line is measured in feet
const FOOT_PRICES = [
  [/alarm|security wire|2.?conductor|22.?\d|18.?\d/i, 0.45],
  [/conduit|raceway/i, 3.5],
  [/cable|cat ?6|cat ?5|network|wire/i, 0.95],
];

/** A sample unit price for a drafted line: per foot for footage, labor by the lot, else by item. */
function samplePrice(line) {
  const text = `${line.description} ${line.notes || ""}`;
  if (/^(ft|feet|foot|lf)$/i.test(String(line.unit || "").trim())) {
    return (FOOT_PRICES.find(([re]) => re.test(text)) || [null, 1])[1];
  }
  if (line.category === "labor") return CATEGORY_PRICES.labor;
  const hit = ITEM_PRICES.find(([re]) => re.test(text));
  return hit ? hit[1] : CATEGORY_PRICES[line.category] ?? CATEGORY_PRICES.misc;
}
module.exports.samplePrice = samplePrice;

// Sample answers for whatever the AI still asks, so the sample shows a finished job. Each one
// is labeled as a sample answer; first match wins.
const ANSWERS = [
  [/cable|run|length|path|route|feet|ft\b/i, "About 120 ft per camera through the hallway drop ceiling; about 40 ft for the panic button."],
  [/height|mount/i, "Cameras on the soffit at about 12 ft; panic button under the reception counter."],
  [/switch|poe|port|rack/i, "Replace with a 24-port PoE switch in the IDF-1 rack; there is room in the rack."],
  [/strike|door|lock|reader|credential/i, "Replace the strike and install a mobile credential reader on the same frame."],
  [/panic|alarm|zone|hold.?up/i, "Silent hold-up zone on the existing alarm panel in the IDF closet."],
  [/hour|time|schedule|access|when|date/i, "After 5 pm, before the inspection on the 20th; the office manager will let us in."],
  [/camera|model|resolution|view|aim/i, "Two 4 MP outdoor cameras aimed at the parking lot and the walkway to the door."],
  [/power|outlet|ups/i, "The PoE switch powers the cameras and reader; there is an outlet in the closet."],
];
function sampleAnswer(question) {
  const hit = ANSWERS.find(([re]) => re.test(question));
  return `Sample answer: ${hit ? hit[1] : "Confirmed with the customer during the site walk."}`;
}
module.exports.sampleAnswer = sampleAnswer;
