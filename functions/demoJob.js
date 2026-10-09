// The "Try Piccolo" sample jobs: short, realistic site walks from different trades (made-up
// businesses and addresses; no real customer data). Words are written the way a tech talks
// into the phone. Try Piccolo opens a random one; "Try a different sample" swaps it.
//
// Each sample comes out of the AI draft as a finished example (functions/piccolo.js): every
// line still unpriced gets a sample price from its own price list (priceSource "sample"),
// every line is checked, and any open question gets a labeled sample answer. Photos are
// AI-generated sample images in functions/demo-photos/<id>-<n>.jpg.

const VERSION = 4; // bump when the samples change: Try Piccolo replaces an older sample

const TERMS = "Sample quote for demonstration only. 50% deposit to schedule, balance due on completion. Valid for 30 days.";
const quote = (extra = {}) => ({ quotePrefix: "SAMPLE-", markupPct: 15, taxPct: 9.5, laborRate: 95, terms: TERMS, ...extra });

const SAMPLES = [
  {
    id: "security-dental",
    trade: "Security",
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
        words:
          "Reception desk. Office manager wants a panic button under the desk, tied into the alarm panel as a silent hold-up zone. About forty feet of wire back to the closet.",
        photo: "A reception desk with an open knee space under the counter and a computer on top.",
      },
    ],
    fieldNotes:
      "Cable path from the north soffit goes through the hallway drop ceiling to the IDF, about 120 feet each. Replace the switch with a 24-port PoE model to power the two cameras and the reader. Replace the door strike, it's worn out. Cameras at 12 feet, aimed at the lot and the walkway. Two techs, one evening.",
    customerComments:
      "We'd like this done before our inspection on the 20th. Work after 5 pm only; we see patients during the day. Our office manager will let you in and has the alarm code.",
    quote: quote(),
    prices: {
      items: [
        [/junction|j-?box/i, 25],
        [/bracket|mount|adapter|back ?box/i, 45],
        [/camera/i, 425],
        [/reader|credential/i, 365],
        [/strike|lock/i, 185],
        [/switch|poe/i, 489],
        [/panic|duress|hold.?up/i, 95],
        [/power supply|psu|transformer/i, 120],
      ],
      perFoot: [
        [/alarm|security wire|conductor/i, 0.45],
        [/conduit|raceway/i, 3.5],
        [/cable|cat ?6|cat ?5|network|wire/i, 0.95],
      ],
      laborLot: 650,
      byCategory: { equipment: 150, cable: 260, misc: 75 },
    },
    answers: [
      [/cable|run|length|path|route|feet|ft\b/i, "About 120 ft per camera through the hallway drop ceiling; about 40 ft for the panic button."],
      [/height|mount/i, "Cameras on the soffit at about 12 ft; panic button under the reception counter."],
      [/switch|poe|port|rack/i, "Replace with a 24-port PoE switch in the IDF-1 rack; there is room in the rack."],
      [/strike|door|lock|reader|credential/i, "Replace the strike and install a mobile credential reader on the same frame."],
      [/panic|alarm|zone|hold.?up/i, "Silent hold-up zone on the existing alarm panel in the IDF closet."],
      [/camera|model|resolution|view|aim/i, "Two 4 MP outdoor cameras aimed at the parking lot and the walkway to the door."],
    ],
  },
  {
    id: "electrical-restaurant",
    trade: "Electrical",
    customer: "Sample: Harbor Grill",
    location: "Kitchen and dining room",
    stops: [
      {
        place: "Electrical room",
        words:
          "Main panel is two hundred amp and it's full, no open spaces. They're adding a second fryer and a walk-in cooler, so we'll set a forty-two space subpanel right next to it, fed from a new hundred amp breaker in the main.",
        photo: "A gray 200-amp main electrical panel with its door open; every breaker space is filled. Bare wall to its right.",
      },
      {
        place: "Kitchen line",
        words:
          "Second fryer goes here on the cook line. Needs a new two-forty volt, fifty amp circuit, about thirty-five feet of run from the subpanel. And the four outlets behind the line aren't GFCI, swap all four to GFCI.",
        photo: "A commercial kitchen cook line with stainless steel equipment; four duplex outlets on the wall behind it, one with a scorched faceplate.",
      },
      {
        place: "Walk-in cooler",
        words:
          "New walk-in cooler goes in this corner. Needs a dedicated two-oh-eight volt, thirty amp circuit with a disconnect at the unit. About fifty feet of run.",
        photo: "An empty corner of a back storage room with a concrete floor where a walk-in cooler will go; conduit runs along the ceiling.",
      },
      {
        place: "Dining room",
        words:
          "Dining room has twelve old fluorescent two-by-four troffers, two of them flicker. Owner wants LED flat panels, same layout, on the existing switch.",
        photo: "A restaurant dining room ceiling with twelve 2x4 fluorescent troffer fixtures in a drop ceiling.",
      },
    ],
    fieldNotes:
      "Add a 42-space subpanel off a new 100 A breaker, 6 ft from the main. EMT on the ceiling: fryer circuit 35 ft (50 A, 240 V), cooler circuit 50 ft (30 A, 208 V) with a disconnect at the unit. Swap 4 receptacles behind the line to GFCI. Replace 12 troffers with 2x4 LED flat panels on the existing switch. Permit needed. One electrician and a helper, two days.",
    customerComments: "We can only shut the power off on Monday when we're closed. Please keep the dining room usable on Tuesday.",
    quote: quote({ laborRate: 110 }),
    prices: {
      items: [
        [/breaker/i, 95],
        [/disconnect/i, 165],
        [/subpanel|sub-panel|load center/i, 1150],
        [/gfci|receptacle|outlet/i, 38],
        [/led|panel light|flat panel|troffer|fixture/i, 145],
        [/permit/i, 350],
      ],
      perFoot: [
        [/emt|conduit/i, 4.5],
        [/wire|thhn|cable|circuit/i, 3.25],
      ],
      laborLot: 1800,
      byCategory: { equipment: 120, cable: 260, misc: 85 },
    },
    answers: [
      [/shut|outage|power off|when|schedule|day/i, "Monday, when the restaurant is closed; dining room back in use Tuesday."],
      [/permit|inspect/i, "Permit and inspection are included in this quote."],
      [/run|length|feet|ft\b|conduit|emt/i, "EMT on the ceiling: about 35 ft to the fryer and 50 ft to the cooler."],
      [/fixture|led|lighting|switch/i, "Twelve 2x4 LED flat panels in the same layout on the existing switch."],
      [/cooler|disconnect/i, "Dedicated 30 A, 208 V circuit with a disconnect at the cooler."],
    ],
  },
  {
    id: "hvac-office",
    trade: "HVAC",
    customer: "Sample: Pinecrest Insurance",
    location: "Second-floor office",
    stops: [
      {
        place: "Roof",
        words:
          "Rooftop unit for the second floor is a ten ton, about twenty-two years old. Compressor's hard starting and the condenser coil is rotten. Recommending a replacement ten ton on the same curb with a curb adapter, and we'll need a crane.",
        photo: "A large weathered rooftop HVAC unit on a flat commercial roof with corroded condenser coil fins and rust streaks.",
      },
      {
        place: "Conference room",
        words:
          "Conference room always runs about ten degrees hot. There's only one supply. Add a second twelve-inch supply with a balancing damper, about twenty feet of flex off the trunk, and a new diffuser.",
        photo: "An office conference room with a long table and a single ceiling supply diffuser in a drop ceiling.",
      },
      {
        place: "Front desk",
        words:
          "Old non-programmable thermostat by the front desk. Swap it for a smart programmable thermostat, same wires, there's a C wire.",
        photo: "An old beige non-programmable thermostat on an office wall next to a light switch.",
      },
      {
        place: "Mechanical closet",
        words:
          "Filters are about three months past due. Sixteen by twenty-five by two, four of them. Change them, and they want quarterly maintenance going forward.",
        photo: "An air handler filter rack in a mechanical closet holding dirty gray pleated filters.",
      },
    ],
    fieldNotes:
      "Replace the 10-ton rooftop unit on the same curb with a curb adapter; crane lift needed. Add a 12-inch supply branch with a balancing damper, 20 ft of flex, and a diffuser to the conference room. Swap the thermostat for a smart programmable one (C wire present). Replace 4 filters, 16x25x2. Quote a quarterly maintenance plan (4 visits a year). Crew of 3, one Saturday.",
    customerComments: "Please do the rooftop swap on a Saturday. Put the maintenance plan as its own line in the same quote.",
    quote: quote({ laborRate: 125 }),
    prices: {
      items: [
        [/curb/i, 1200],
        [/crane/i, 1500],
        [/thermostat/i, 285],
        [/filter/i, 18],
        [/damper/i, 65],
        [/diffuser|register|grille/i, 85],
        [/maintenance|plan|visit/i, 225],
        [/rooftop|rtu|package unit|10.?ton|ten.?ton/i, 14500],
      ],
      perFoot: [[/flex|duct/i, 6]],
      laborLot: 3200,
      byCategory: { equipment: 150, cable: 120, misc: 95 },
    },
    answers: [
      [/when|schedule|saturday|day/i, "On a Saturday, with the building closed."],
      [/crane|lift|roof access/i, "Crane lift included; the roof has a hatch for the crew."],
      [/curb|size|tonnage|ton/i, "Same 10-ton size on the existing curb with a curb adapter."],
      [/maintenance|plan|visit/i, "Quarterly plan: 4 visits a year, priced per visit."],
      [/duct|supply|damper|conference/i, "One new 12-inch supply branch with a balancing damper, about 20 ft of flex."],
    ],
  },
  {
    id: "plumbing-home",
    trade: "Plumbing",
    customer: "Sample: Garcia residence",
    location: "Garage, kitchen, and upstairs bath",
    stops: [
      {
        place: "Garage",
        words:
          "Water heater is a fifty gallon gas, fourteen years old, rust at the base and it's leaking a little. Replace with a fifty gallon gas in the same spot. Needs an expansion tank, and the earthquake straps are missing.",
        photo: "An old 50-gallon gas water heater in a garage corner with rust stains and water at its base and no seismic straps.",
      },
      {
        place: "Upstairs bathroom",
        words:
          "Toilet runs constantly and rocks on the floor. Pull it, new wax ring and a flange repair, and replace the fill valve and flapper.",
        photo: "A bathroom with a white toilet and stained, cracked caulk at its base.",
      },
      {
        place: "Kitchen",
        words:
          "Slow kitchen drain and the faucet drips. Snake the drain and install the new faucet they bought, it's in the box on the counter.",
        photo: "A kitchen sink with a dripping chrome faucet and a boxed new faucet on the counter.",
      },
      {
        place: "Front of house",
        words:
          "Main shutoff by the front hose bib is an old gate valve that won't fully close. Replace it with a three-quarter-inch ball valve.",
        photo: "An old corroded gate valve on a copper pipe at the front of a house near a hose bib.",
      },
    ],
    fieldNotes:
      "Replace the 50-gallon gas water heater with an expansion tank, seismic straps, and new flex connectors; haul away the old one. Reset the upstairs toilet: wax ring, flange repair kit, fill valve, flapper. Snake the kitchen drain and install the customer-supplied faucet. Replace the 3/4-inch main shutoff with a ball valve. One plumber, one day.",
    customerComments: "We work from home, so mornings are best. Please haul away the old water heater.",
    quote: quote({ laborRate: 125 }),
    prices: {
      items: [
        [/haul|disposal|dispose/i, 95],
        [/expansion/i, 95],
        [/strap|seismic|earthquake/i, 45],
        [/connector|flex/i, 25],
        [/wax/i, 12],
        [/flange/i, 35],
        [/fill valve/i, 28],
        [/flapper/i, 12],
        [/ball valve|shutoff|shut-off/i, 48],
        [/snake|drain|auger|clear/i, 175],
        [/faucet/i, 0],
        [/water heater/i, 1350],
      ],
      perFoot: [[/pipe|copper|pex/i, 6]],
      laborLot: 950,
      byCategory: { equipment: 60, cable: 40, misc: 40 },
    },
    answers: [
      [/when|schedule|morning|time/i, "Weekday morning; the homeowners work from home."],
      [/haul|disposal|old/i, "Haul-away of the old water heater is included."],
      [/faucet/i, "Customer supplied the faucet; quote covers installation only."],
      [/size|gallon|gas|electric/i, "Same 50-gallon gas size in the same spot."],
      [/valve|shutoff|main/i, "3/4-inch full-port ball valve on the main."],
    ],
  },
  {
    id: "roofing-home",
    trade: "Roofing",
    customer: "Sample: Thompson residence",
    location: "Roof, attic, and gutters",
    stops: [
      {
        place: "Back slope",
        words:
          "Leak over the back bedroom. About ten shingles are missing from the wind on the back slope and the felt is showing. Replace them, match the gray architectural shingles.",
        photo: "An asphalt shingle roof slope with a patch of missing gray architectural shingles exposing black felt underlayment.",
      },
      {
        place: "Chimney",
        words:
          "Step flashing around the chimney is pulled away and the counter flashing is loose. That's the likely leak. Reflash the whole chimney.",
        photo: "A brick chimney on a shingle roof with loose, rusted metal flashing at its base.",
      },
      {
        place: "Attic",
        words:
          "In the attic there's a stained, soft area of decking about four by eight right under the chimney. Replace one sheet of half-inch plywood.",
        photo: "An attic interior with a dark water-stained patch of roof decking near a chimney and insulation below.",
      },
      {
        place: "Front gutter",
        words:
          "Front gutter is sagging, two hangers pulled out, about forty feet of gutter. Re-hang it with hidden hangers every two feet and clean all the gutters.",
        photo: "The front gutter of a house sagging away from the fascia with leaves and debris in it.",
      },
    ],
    fieldNotes:
      "Replace about 10 missing architectural shingles on the back slope (2 bundles, color match gray). Reflash the chimney: new step and counter flashing. Replace one 4x8 sheet of 1/2-inch plywood decking under the chimney with new underlayment. Re-hang 40 ft of front gutter with hidden hangers every 2 ft (20 hangers) and clean all gutters. Haul away debris. Crew of 2, one day.",
    customerComments: "We have a dog in the backyard, please keep the gate closed. Rain is forecast next week, so sooner is better.",
    quote: quote(),
    prices: {
      items: [
        [/shingle|bundle/i, 48],
        [/flashing|reflash/i, 285],
        [/plywood|decking|sheathing|osb/i, 65],
        [/underlayment|felt|ice and water/i, 95],
        [/hanger/i, 4],
        [/clean/i, 175],
        [/haul|disposal|dumpster|debris/i, 250],
      ],
      perFoot: [[/gutter/i, 9]],
      laborLot: 1400,
      byCategory: { equipment: 60, cable: 40, misc: 60 },
    },
    answers: [
      [/color|match|shingle/i, "Gray architectural shingles to match the existing roof."],
      [/when|schedule|rain|weather/i, "Before the rain forecast next week; one day on site."],
      [/gate|dog|access/i, "Back gate stays closed; the dog stays in the yard."],
      [/decking|plywood|attic/i, "One 4x8 sheet of 1/2-inch plywood under the chimney."],
      [/gutter|hanger/i, "About 40 ft re-hung with hidden hangers every 2 ft."],
    ],
  },
  {
    id: "solar-home",
    trade: "Solar",
    customer: "Sample: Nguyen residence",
    location: "Roof, garage, and main panel",
    stops: [
      {
        place: "South roof",
        words:
          "South-facing roof, about six hundred square feet usable, no shade after nine a.m. Room for sixteen four-hundred-watt panels in two rows.",
        photo: "A large south-facing asphalt shingle roof section with no vents or shade under a clear sky.",
      },
      {
        place: "Main panel",
        words:
          "Main panel is two hundred amp with a two hundred amp main breaker, busbar is two twenty-five, so we can backfeed under the hundred-twenty-percent rule. We'll need a forty amp two-pole breaker for the inverter.",
        photo: "A residential 200-amp electrical panel on a garage wall with its cover off, showing labeled breakers.",
      },
      {
        place: "Garage wall",
        words:
          "Inverter and battery go on this garage wall, about twenty feet from the panel. They want one thirteen kilowatt-hour battery to back up the fridge and the lights, so a small critical-loads panel too.",
        photo: "An empty drywall garage wall next to the electrical panel with space for a battery and an inverter.",
      },
      {
        place: "Meter",
        words: "Utility meter on the side of the house. The utility needs an AC disconnect right next to it.",
        photo: "A residential electric utility meter on a stucco exterior wall.",
      },
    ],
    fieldNotes:
      "6.4 kW system: 16 x 400 W panels in 2 rows on the south roof with flashed mounts and rails. Hybrid inverter and one 13 kWh battery on the garage wall, plus a critical-loads panel for the fridge and lights. 40 A 2-pole backfeed breaker. AC disconnect next to the meter. About 20 ft of conduit from the panel to the inverter and 60 ft from the roof to the garage. Permit and utility interconnection included. Crew of 3, two days.",
    customerComments: "We'd like to see the federal tax credit amount. Our HOA needs the panel layout before install.",
    quote: quote(),
    prices: {
      items: [
        [/rail|racking|mount|flash/i, 85],
        [/breaker/i, 75],
        [/disconnect/i, 220],
        [/critical|load.?panel|sub.?panel/i, 450],
        [/permit|interconnect/i, 650],
        [/monitor/i, 0],
        [/inverter/i, 2800],
        [/battery/i, 8900],
        [/module|panel.*watt|solar panel|400.?w/i, 260],
      ],
      perFoot: [[/conduit|wire|pv wire|cable/i, 7]],
      laborLot: 4200,
      byCategory: { equipment: 120, cable: 200, misc: 150 },
    },
    answers: [
      [/tax credit|incentive|federal/i, "The federal credit is 30% of the system cost; shown for planning only."],
      [/hoa|layout|drawing/i, "Panel layout drawing goes to the HOA before install."],
      [/shade|orientation|tilt|roof/i, "South-facing, no shade after 9 a.m.; 16 panels in 2 rows."],
      [/backfeed|busbar|main|breaker|panel/i, "225 A busbar with a 200 A main: a 40 A backfeed breaker fits the 120% rule."],
      [/battery|backup|critical/i, "One 13 kWh battery backing up the fridge and lights through a critical-loads panel."],
    ],
  },
  {
    id: "painting-retail",
    trade: "Painting",
    customer: "Sample: Bloom Boutique",
    location: "Sales floor and storefront",
    stops: [
      {
        place: "Sales floor",
        words:
          "Sales floor walls, about two thousand square feet of wall, nine-foot ceilings. Scuffed white now, they want a warm gray, two coats eggshell, patch the nail holes first.",
        photo: "An empty retail sales floor with scuffed white walls and a wood floor.",
      },
      {
        place: "Accent wall",
        words: "Back wall behind the register is the accent wall, twenty feet wide by nine high, deep green, two coats.",
        photo: "The plain white back wall of a boutique behind a checkout counter.",
      },
      {
        place: "Ceiling",
        words: "Twelve drop ceiling tiles have water stains, two-by-four. Replace those, and paint the exposed ductwork black, about sixty feet of it.",
        photo: "A retail ceiling with stained drop ceiling tiles and exposed silver ductwork.",
      },
      {
        place: "Storefront",
        words: "Outside, the door frame and trim are peeling. Scrape, prime, and paint black semi-gloss, two coats.",
        photo: "A store entrance with a wooden door frame and trim with peeling paint.",
      },
    ],
    fieldNotes:
      "Walls about 2,000 sq ft: patch, then 2 coats eggshell warm gray (about 12 gallons). Accent wall 20 x 9 ft, 2 coats deep green (2 gallons). Replace 12 stained 2x4 ceiling tiles. Paint about 60 ft of exposed duct black (3 gallons). Exterior door frame and trim: scrape, prime, 2 coats black semi-gloss. Protect floors and fixtures. 2 painters, 3 nights.",
    customerComments: "We're open 10 to 7. Work overnight only and have the floor clear by 9 a.m.",
    quote: quote(),
    prices: {
      items: [
        [/primer/i, 38],
        [/paint|gallon|coat/i, 58],
        [/tile/i, 14],
        [/patch|spackle|caulk/i, 25],
        [/protect|drop cloth|masking|plastic/i, 90],
      ],
      perFoot: [[/duct/i, 4], [/trim|frame/i, 3]],
      perSqft: 1.6,
      laborLot: 2600,
      byCategory: { equipment: 50, cable: 40, misc: 50 },
    },
    answers: [
      [/hour|when|schedule|night|open/i, "Overnight only; the floor is clear by 9 a.m. each day."],
      [/color|sheen|finish|gray|green/i, "Warm gray eggshell walls, deep green accent wall, black semi-gloss trim."],
      [/square|area|sq|size/i, "About 2,000 sq ft of wall plus a 20 x 9 ft accent wall."],
      [/tile|ceiling/i, "Twelve 2x4 tiles replaced to match."],
      [/duct/i, "About 60 ft of exposed duct painted black."],
    ],
  },
  {
    id: "appraisal-repairs",
    trade: "Home appraisal",
    customer: "Sample: 418 Maple Street (FHA appraisal)",
    location: "Whole house",
    stops: [
      {
        place: "Front steps",
        words:
          "Appraisal condition: the front steps have four risers and no handrail. FHA needs a handrail. Install a black metal handrail, about six feet long.",
        photo: "Concrete front porch steps of a small older house, four steps with no handrail.",
      },
      {
        place: "Exterior trim",
        words:
          "Peeling paint on the exterior trim and the garage door frame. House is a nineteen sixty build, so treat it as lead. Scrape, prime, and paint about a hundred and twenty linear feet of trim, lead-safe.",
        photo: "Wood exterior trim and a garage door frame with peeling white paint on an older house.",
      },
      {
        place: "Back bedroom",
        words:
          "Back bedroom window has a cracked pane and it's painted shut. FHA needs egress. Replace it with a vinyl slider, thirty-six by forty-eight.",
        photo: "A bedroom window with a cracked glass pane and a painted-shut wood frame.",
      },
      {
        place: "Utility closet",
        words: "Water heater has no discharge pipe on the relief valve. Add a three-quarter-inch discharge pipe down to six inches above the floor.",
        photo: "A gas water heater in a utility closet with a relief valve but no discharge pipe attached.",
      },
    ],
    fieldNotes:
      "Appraisal conditions to clear before closing: handrail at the front steps (4 risers, 6 ft), lead-safe scrape, prime, and paint of about 120 linear ft of trim, replace the cracked back bedroom window with a 36x48 vinyl slider for egress, add a 3/4-inch TPR discharge pipe at the water heater. Photograph each repair for the appraiser's re-inspection. One crew, two days.",
    customerComments: "Closing is in three weeks. The appraiser needs a photo of each repair when it's done.",
    quote: quote(),
    prices: {
      items: [
        [/anchor|hardware|fastener|screws/i, 25],
        [/handrail|railing/i, 340],
        [/window|slider/i, 485],
        [/discharge|tpr|relief/i, 35],
        [/lead|rrp|containment/i, 120],
        [/primer/i, 38],
        [/paint|gallon/i, 58],
        [/photo|documentation|re-?inspection/i, 75],
      ],
      perFoot: [[/trim|frame/i, 3.5]],
      laborLot: 1500,
      byCategory: { equipment: 60, cable: 40, misc: 60 },
    },
    answers: [
      [/closing|when|schedule|deadline/i, "Done within two weeks, ahead of the three-week closing."],
      [/lead|rrp|1960|age/i, "Lead-safe (RRP) practices for all scraping and painting."],
      [/window|size|egress/i, "36x48 vinyl slider that meets egress."],
      [/handrail|rail|step/i, "6 ft black metal handrail at the 4-riser front steps."],
      [/photo|inspection|appraiser/i, "A photo of each completed repair goes to the appraiser."],
    ],
  },
];

/** A random sample, different from excludeId when possible. */
function pickSample(excludeId) {
  const pool = SAMPLES.filter((s) => s.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)] || SAMPLES[0];
}

const sampleById = (id) => SAMPLES.find((s) => s.id === id) || SAMPLES[0];

/**
 * A sample unit price for a drafted line: per foot / sq ft when measured that way, labor by
 * the lot (the sample's labor budget split across laborLots lines), else by item.
 */
function samplePrice(line, sample = SAMPLES[0], { laborLots = 1 } = {}) {
  const p = sample.prices;
  const text = `${line.description} ${line.notes || ""}`;
  const unit = String(line.unit || "").trim();
  if (/^(ft|feet|foot|lf|lin\.? ?ft)$/i.test(unit)) {
    return (p.perFoot.find(([re]) => re.test(text)) || [null, 1])[1];
  }
  if (/^(sq\.? ?ft|sf|sqft|square feet)$/i.test(unit)) return p.perSqft || 1.5;
  if (line.category === "labor") {
    // Hourly labor without a rate gets the sample's own rate
    if (/^(hr|hrs|hour|hours)$/i.test(unit)) return sample.quote.laborRate;
    return Math.max(50, Math.round(p.laborLot / Math.max(1, laborLots) / 5) * 5);
  }
  const hit = p.items.find(([re]) => re.test(text));
  return hit ? hit[1] : p.byCategory[line.category] ?? p.byCategory.misc;
}

/** A labeled sample answer for an open question. */
function sampleAnswer(question, sample = SAMPLES[0]) {
  const hit = sample.answers.find(([re]) => re.test(question));
  return `Sample answer: ${hit ? hit[1] : "Confirmed with the customer during the site walk."}`;
}

module.exports = { version: VERSION, samples: SAMPLES, pickSample, sampleById, samplePrice, sampleAnswer };
