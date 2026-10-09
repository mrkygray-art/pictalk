// Example jobs for the app owner's own account (the UNLIMITED_AI_EMAILS accounts), so a
// fresh PicTalk doesn't open to an empty My Jobs. Six homes and one commercial site from
// different trades (made-up customers and places; no real customer data). Unlike the
// "Try Piccolo" sample, these are ordinary finished jobs: they never expire and can be
// edited, sent to Piccolo, or deleted. Photos are AI-generated images in
// functions/example-photos/<id>-<n>.jpg.

const EXAMPLES = [
  {
    id: "kitchen-remodel",
    daysAgo: 2,
    customer: "Thompson residence",
    location: "Kitchen remodel",
    stops: [
      {
        place: "Sink base",
        words:
          "Sink base cabinet. The bottom is swollen and stained from an old leak, supply lines are the original braided ones. Replace the whole sink base, new shutoffs and supply lines, and check the subfloor once it's out.",
        photo: "An open sink base cabinet with a warped, water-stained particleboard floor and older braided supply lines.",
      },
      {
        place: "Range wall",
        words:
          "Range wall. They want to go from the electric range to a 30 inch gas range and a real vent hood ducted outside. Gas line is about 15 feet away in the garage. Hood would duct straight up through the cabinet, roughly 8 feet to the roof.",
        photo: "A dated range wall with an older white electric range, oak cabinets, and a small recirculating hood.",
      },
      {
        place: "Dishwasher floor",
        words:
          "Floor by the dishwasher. Vinyl is lifting at the seam and it's soft underfoot about two feet out. Plan on cutting out and replacing a 4 by 4 section of subfloor. New luxury vinyl plank for the whole kitchen, about 180 square feet.",
        photo: "Worn sheet vinyl beside a dishwasher with a lifted, bubbled seam and dark staining.",
      },
    ],
    fieldNotes: "Kitchen is about 12 by 15. Cabinets stay except the sink base. Homeowner wants the work done in two weeks or less; they'll set up a temporary kitchen in the dining room.",
    customerComments: "Can we keep the existing countertops? Budget is around twenty thousand. Prefer a stainless hood.",
  },
  {
    id: "ev-charger",
    daysAgo: 4,
    customer: "Nguyen residence",
    location: "Garage EV charger",
    stops: [
      {
        place: "Main panel",
        words:
          "Main panel in the garage. It's a 100 amp panel and every space is full, a few tandems already. Not enough room or capacity for a 60 amp charger circuit. Recommend a 200 amp service upgrade with a new panel.",
        photo: "An open 100-amp residential panel with every breaker slot full, including a few tandem breakers.",
      },
      {
        place: "Garage wall",
        words:
          "Charger location on the wall by the garage door, left side. About 40 feet of run from the panel. Level 2 charger, 48 amp, hardwired on a 60 amp circuit, 6 gauge in conduit along the wall.",
        photo: "A bare drywall section beside the garage door where the charger will mount, with a compact electric car parked nearby.",
      },
      {
        place: "Meter",
        words:
          "Meter on the side of the house. Overhead service. The upgrade means a new meter base and mast, so we'll need the utility to disconnect and reconnect. Permit and inspection required.",
        photo: "A stucco wall with an electric meter base and service mast above it, and a hose bib below.",
      },
    ],
    fieldNotes: "Customer bought the car last month and is charging on a regular outlet. Utility scheduling usually takes two to three weeks for a service upgrade.",
    customerComments: "We'd like the charger cord to reach both parking spots if possible. Can you include the permit fees in the quote?",
  },
  {
    id: "home-security",
    daysAgo: 6,
    customer: "Patel residence",
    location: "Two-story home",
    stops: [
      {
        place: "Front door",
        words:
          "Front door. Swap the old doorbell for a video doorbell on the existing transformer, and replace the deadbolt with a keypad smart lock. Door is standard, two and three-eighths backset.",
        photo: "A front door with an old wired doorbell button beside the frame and a basic keyed deadbolt.",
      },
      {
        place: "Back gate corner",
        words:
          "Back corner of the house over the side gate. One outdoor camera on the fascia covering the gate and the back patio. Another camera on the opposite corner for the driveway. Run PoE cable through the attic, about 60 feet each.",
        photo: "The corner of a roof eave above a wooden side gate, with an empty spot on the fascia for a camera.",
      },
      {
        place: "Hall closet",
        words:
          "Hall closet with the router. Put the recorder here with a small PoE switch. There's one outlet; add a small battery backup. Two cameras total plus the doorbell, 30 days of recording.",
        photo: "A hallway closet shelf with a home router and modem, a power strip, and network and coax cables.",
      },
    ],
    fieldNotes: "Attic access is in the upstairs hallway. Plenty of room to fish cables down the hall closet wall. Wi-Fi signal at the front door is fine.",
    customerComments: "We travel a lot, so we want phone alerts when someone is at the gate. No monthly fees if we can avoid it.",
  },
  {
    id: "fence-gate",
    daysAgo: 9,
    customer: "Morales residence",
    location: "Backyard fence",
    stops: [
      {
        place: "East side",
        words:
          "East side fence. Three posts rotted at the ground and the whole section is leaning toward the neighbor. Replace those posts with new ones set in concrete, or galvanized steel posts.",
        photo: "A weathered six-foot wood privacy fence leaning, with a post rotted at the base.",
      },
      {
        place: "Side gate",
        words:
          "Side gate drags on the concrete and won't latch. Replace the gate with a new 4 foot cedar gate on a steel frame, heavy-duty hinges, and a self-closing latch.",
        photo: "A sagging wood gate dragging on a concrete path, with a rusty hinge and a gap at the latch side.",
      },
      {
        place: "Back property line",
        words:
          "Back property line. About 120 feet of fence, boards split and missing all along it. Customer wants the whole back run replaced with 6 foot cedar, dog-eared pickets. Haul away the old fence.",
        photo: "A long run of old wood fence along the back property line with missing and split boards.",
      },
    ],
    fieldNotes: "Call 811 for utility locates before digging. Neighbor on the east side agreed to split the cost of that section.",
    customerComments: "We have a dog, so the yard needs to be closed up by the end of each day.",
  },
  {
    id: "irrigation",
    daysAgo: 12,
    customer: "Carter residence",
    location: "Front yard irrigation",
    stops: [
      {
        place: "Front lawn",
        words:
          "Front lawn, zone 2. Sprinkler head is snapped off, probably the mower. It's flooding that corner. Replace the head and riser, then check the coverage on the rest of the zone.",
        photo: "A broken pop-up sprinkler head with water bubbling up and soggy grass around it.",
      },
      {
        place: "Valve box",
        words:
          "Valve box by the driveway. Three valves, the zone 3 valve bonnet is cracked and weeping. Replace that valve. The box lid is broken too, so a new valve box.",
        photo: "An open valve box with three sprinkler valves, one with a cracked bonnet, and wet dirt.",
      },
      {
        place: "Garage",
        words:
          "Controller in the garage is about 20 years old and the display is fading. Swap it for a smart Wi-Fi controller, 6 zones, same wiring.",
        photo: "An old sprinkler timer on a garage wall with its cover open and zone wires running into it.",
      },
    ],
    fieldNotes: "Water bill doubled last month according to the customer. Run each zone after the repair to confirm no other leaks.",
    customerComments: "Can the new controller skip watering when it rains?",
  },
  {
    id: "flooring",
    daysAgo: 16,
    customer: "Kim residence",
    location: "Living areas",
    stops: [
      {
        place: "Living room",
        words:
          "Living room carpet, about 420 square feet. Pull the carpet and pad, and install waterproof luxury vinyl plank. Slab floor, so a quick level check first. Move the couch and the TV stand.",
        photo: "Worn beige wall-to-wall carpet with stains and traffic patterns, furniture pushed to one side.",
      },
      {
        place: "Hallway",
        words:
          "Hallway, about 90 square feet, same vinyl plank. It meets the tile at the entry with a worn metal strip and a small height difference. New flush transition there.",
        photo: "A carpeted hallway meeting a ceramic tile entry with a worn metal transition strip.",
      },
      {
        place: "Stairs",
        words:
          "Stairs, 12 steps. Customer wants matching vinyl treads and risers with stair nose. New quarter round along all the baseboards in these areas.",
        photo: "A carpeted staircase of about twelve steps with worn nosings and a painted baseboard.",
      },
    ],
    fieldNotes: "Total flooring about 510 square feet plus the stairs. Order 10 percent extra for cuts. Customer picked a light oak color.",
    customerComments: "We'd like this done before family visits next month.",
  },
  {
    id: "warehouse-led",
    daysAgo: 20,
    customer: "Ridgeview Distribution",
    location: "Warehouse lighting",
    stops: [
      {
        place: "Racking aisles",
        words:
          "Warehouse floor. 36 metal halide high bays at about 28 feet, a lot of them dim or out. Replace with LED high bays, 150 watt, with motion sensors in the aisles. Need a lift for this.",
        photo: "Pallet racking aisles under old metal halide high-bay fixtures on a 28-foot steel joist ceiling, a few fixtures dim.",
      },
      {
        place: "Loading dock",
        words:
          "Loading dock. Six wall packs over the dock doors, two are out. Replace with LED wall packs with photocells. Add two dock loading lights on swing arms.",
        photo: "Three roll-up dock doors with old wall-pack fixtures above them, one fixture dark.",
      },
      {
        place: "Front office",
        words:
          "Front office drop ceiling. 24 two by four fluorescent troffers, lenses yellowed. Swap for LED flat panels. Add an occupancy sensor in the break room.",
        photo: "A drop ceiling with old 2x4 fluorescent troffers, one lens yellowed and one tube dim, desks below.",
      },
    ],
    fieldNotes: "Facility runs two shifts, so lift work has to be after 10 PM or on weekends. Check the utility's LED rebate program before quoting.",
    customerComments: "Facilities manager wants the energy savings and payback estimate in the proposal.",
  },
];

exports.examples = EXAMPLES;
