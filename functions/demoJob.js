// The "Try Piccolo" sample job: a short, realistic security site walk (made-up business).
// Words are written the way a tech talks into the phone. No real customer data.
module.exports = {
  customer: "Sample: Riverside Dental",
  location: "Front office and parking lot",
  stops: [
    {
      words:
        "Front entrance. The card reader by the glass door is cracked and the door strike sticks when you pull. They want a mobile credential reader here instead, something like an HID Signo.",
      photo: "A wall-mounted card reader beside an aluminum glass door frame. The reader's front cover has a visible crack across it.",
    },
    {
      words:
        "North side, facing the parking lot. They want two cameras up on the soffit to cover the lot and the walkway to the door. Soffit is about twelve feet.",
      photo: "An exterior wall with a soffit roughly 12 feet up. Beyond the walkway is a parking lot with about 20 spaces and two light poles.",
    },
    {
      words:
        "IDF closet in the back hallway. Twenty-four port switch, maybe six ports open. I don't think it's PoE. There's room in the rack for another unit.",
      photo: "A small wall-mounted rack with a 24-port network switch, a patch panel, and loose patch cables. A label on the rack reads IDF-1.",
    },
    {
      words: "Reception desk. Office manager wants a panic button under the desk, tied into the alarm panel.",
      photo: "A reception desk with an open knee space under the counter and a computer on top.",
    },
  ],
  fieldNotes:
    "Need to confirm the cable path from the north soffit back to the IDF, probably through the drop ceiling in the hallway. The switch will likely need to be replaced with a PoE model to power the cameras and reader. Door strike may need replacing too.",
  customerComments:
    "We'd like this done before our inspection on the 20th. Work after 5 pm only; we see patients during the day.",
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
const CATEGORY_PRICES = { equipment: 150, cable: 260, labor: 380, misc: 75 };

/** A sample unit price for a drafted line (labor by the lot, everything else by item). */
function samplePrice(line) {
  if (line.category === "labor") return CATEGORY_PRICES.labor;
  const text = `${line.description} ${line.notes || ""}`;
  const hit = ITEM_PRICES.find(([re]) => re.test(text));
  return hit ? hit[1] : CATEGORY_PRICES[line.category] ?? CATEGORY_PRICES.misc;
}
module.exports.samplePrice = samplePrice;
