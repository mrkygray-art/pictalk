// Test companies and people for the Procore sandbox, and the rules for what the cleanup may touch. All data is
// fictional; phones use the reserved 555-01XX range.
//   Set 1: Ky's sitesnap_test_users.md (2026-10-14), as it ended up in Procore: Lena Kowalski (ClearFlow) and
//          Summit Framing's 4 people were never created, and their emails (lkowalski, druiz) went to set 2.
//          Summit Framing & Drywall exists with no people; it stays listed so the cleanup never offers to remove it.
//   Set 2: sitesnap-seed-directory-expansion.md (2026-10-14): 5 trade companies, 21 people.
// Project Role: "Project Manager" for PMs only; GC and Worker get none (job title shows), per the expansion spec.
// Used only by api/procore/seed-directory.js, which refuses to run outside Procore's sandbox.

export const TAG = "SiteSnap test data";

const CA = { country_code: "US", state_code: "CA" };
const PM_ROLE = "Project Manager";
const person = (first, last, handle, initials, title, _role, roleType, cell, ext) => ({
  first_name: first, last_name: last, email_address: `mrkygray+${handle}@gmail.com`, initials, job_title: title,
  mobile_phone: cell, ...(ext ? { business_phone_extension: ext } : {}), projectRole: roleType === "PM" ? PM_ROLE : null, roleType,
});
// Set 2 rows: first, last, job title, role type, mobile (initials from the name; email from the convention)
const person2 = (first, last, title, roleType, cell) =>
  person(first, last, `${first[0]}${last}`.toLowerCase(), `${first[0]}${last[0]}`, title, null, roleType, cell);
const company2 = (name, trade, email, phone, users) => ({
  set: 2, vendor: { name, business_phone: phone, email_address: email, notes: trade, labor_union: null }, users,
});

export const SEED = [
  {
    set: 1,
    vendor: {
      name: "Ironbridge Construction Group", abbreviated_name: "Ironbridge", trade_name: "Ironbridge Builders",
      business_phone: "(310) 555-0101", fax_number: "(310) 555-0102", address: "4100 Harbor Commerce Way", city: "Torrance", zip: "90501",
      email_address: "mrkygray+IronbridgeCompany@gmail.com", website: "www.ironbridgebuilders-test.com",
      notes: "general contractor, commercial, residential, ground-up, tenant improvement", license_number: "CA-B-900101", labor_union: null,
    },
    users: [
      person("Marcus", "Hale", "mhale", "MH", "Project Manager", "Project Manager", "PM", "(310) 555-0111", 201),
      person("Diane", "Okafor", "dokafor", "DO", "General Superintendent", "General Contractor", "GC", "(310) 555-0112", 202),
      person("Tyler", "Brandt", "tbrandt", "TB", "Site Laborer", "Worker", "Worker", "(310) 555-0113", 203),
      person("Priya", "Nair", "pnair", "PN", "Site Safety Coordinator", "Worker", "Worker", "(310) 555-0114", 204),
    ],
  },
  {
    set: 1,
    vendor: {
      name: "VoltLine Electric Inc.", abbreviated_name: "VoltLine", trade_name: "VoltLine Electrical Contractors",
      business_phone: "(310) 555-0120", fax_number: "(310) 555-0121", address: "2250 Anchor Industrial Blvd", city: "Hawthorne", zip: "90250",
      email_address: "mrkygray+VoltLineCompany@gmail.com", website: "www.voltlineelectric-test.com",
      notes: "electrical, power, lighting, low voltage, commercial, residential", license_number: "CA-C10-845220", labor_union: "IBEW Local 11",
    },
    users: [
      person("Rosa", "Mendez", "rmendez", "RM", "Project Manager", "Project Manager", "PM", "(310) 555-0131", 101),
      person("Jamal", "Whitfield", "jwhitfield", "JW", "Electrical General Foreman", "General Contractor", "GC", "(310) 555-0132", 102),
      person("Kenji", "Tanaka", "ktanaka", "KT", "Journeyman Electrician", "Worker", "Worker", "(310) 555-0133", 103),
      person("Sofia", "Reyes", "sreyes", "SR", "Apprentice Electrician", "Worker", "Worker", "(310) 555-0134", 104),
    ],
  },
  {
    set: 1,
    vendor: {
      name: "ClearFlow Plumbing & Mechanical", abbreviated_name: "ClearFlow", trade_name: "ClearFlow Mechanical Services",
      business_phone: "(424) 555-0140", fax_number: "(424) 555-0141", address: "890 Sepulveda Service Road", city: "El Segundo", zip: "90245",
      email_address: "mrkygray+ClearFlowCompany@gmail.com", website: "www.clearflowmech-test.com",
      notes: "plumbing, HVAC, mechanical, piping, commercial, residential", license_number: "CA-C36-770415", labor_union: "UA Local 78",
    },
    users: [
      person("Greg", "Sorensen", "gsorensen", "GS", "Project Manager", "Project Manager", "PM", "(424) 555-0151", 301),
      person("Alicia", "Dubois", "adubois", "AD", "Mechanical Superintendent", "General Contractor", "GC", "(424) 555-0152", 302),
      person("Omar", "Haddad", "ohaddad", "OH", "Journeyman Plumber", "Worker", "Worker", "(424) 555-0153", 303),
    ],
  },
  {
    set: 1,
    vendor: {
      name: "Summit Framing & Drywall", abbreviated_name: "Summit", trade_name: "Summit Interiors",
      business_phone: "(323) 555-0160", fax_number: "(323) 555-0161", address: "1575 Crenshaw Trade Center", city: "Gardena", zip: "90248",
      email_address: "mrkygray+SummitCompany@gmail.com", website: "www.summitframing-test.com",
      notes: "framing, drywall, carpentry, finishes, residential, tenant improvement", license_number: "CA-C9-698330", labor_union: "Carpenters Local 721",
    },
    users: [],
  },
  company2("Summit Roofing & Waterproofing", "roofing, waterproofing", "mrkygray+SummitRoofingCompany@gmail.com", "(310) 555-0160", [
    person2("Carla", "Vasquez", "Project Manager", "PM", "(310) 555-0171"),
    person2("Derek", "Lindqvist", "Roofing Superintendent", "GC", "(310) 555-0172"),
    person2("Miguel", "Alvarado", "Journeyman Roofer", "Worker", "(310) 555-0173"),
    person2("Trevor", "Nguyen", "Waterproofing Installer", "Worker", "(310) 555-0174"),
  ]),
  company2("Pacific Concrete & Foundations", "concrete", "mrkygray+PacificConcreteCompany@gmail.com", "(424) 555-0180", [
    person2("Harold", "Beaumont", "Project Manager", "PM", "(424) 555-0191"),
    person2("Lena", "Kowalski", "Concrete Superintendent", "GC", "(424) 555-0192"),
    person2("Andre", "Washington", "Concrete Finisher", "Worker", "(424) 555-0193"),
    person2("Isabel", "Cortez", "Formwork Carpenter", "Worker", "(424) 555-0194"),
    person2("Raj", "Patel", "Pump Operator", "Worker", "(424) 555-0195"),
  ]),
  company2("Apex Fire Protection Systems", "fire sprinkler, fire alarm", "mrkygray+ApexFireProtectionCompany@gmail.com", "(310) 555-0200", [
    person2("Naomi", "Fischer", "Project Manager", "PM", "(310) 555-0211"),
    person2("Victor", "Castellanos", "Fire Sprinkler Foreman", "GC", "(310) 555-0212"),
    person2("Dylan", "Murphy", "Sprinkler Fitter", "Worker", "(310) 555-0213"),
    person2("Hana", "Yoshida", "Fire Alarm Technician", "Worker", "(310) 555-0214"),
  ]),
  company2("Cornerstone Drywall & Framing", "drywall, framing", "mrkygray+CornerstoneDrywallCompany@gmail.com", "(323) 555-0220", [
    person2("Brian", "Oyelaran", "Project Manager", "PM", "(323) 555-0231"),
    person2("Tessa", "Ramirez", "Framing Superintendent", "GC", "(323) 555-0232"),
    person2("Luis", "Ochoa", "Lead Drywall Finisher", "Worker", "(323) 555-0233"),
    person2("Kareem", "Bishop", "Metal Stud Framer", "Worker", "(323) 555-0234"),
  ]),
  company2("Sentinel Low Voltage & Security", "low voltage, security", "mrkygray+SentinelLowVoltageCompany@gmail.com", "(818) 555-0240", [
    person2("Elena", "Marchetti", "Project Manager", "PM", "(818) 555-0251"),
    person2("Wesley", "Park", "Low Voltage Foreman", "GC", "(818) 555-0252"),
    person2("Chloe", "Abara", "Security Systems Technician", "Worker", "(818) 555-0253"),
    person2("Dominic", "Ruiz", "Cable Puller", "Worker", "(818) 555-0254"),
  ]),
];

// ---------- Procore request bodies ----------

// Create / update company vendor (POST /rest/v1.0/vendors, PATCH /rest/v1.0/vendors/{id})
export function vendorBody(companyId, v) {
  const { labor_union, ...rest } = v;
  return {
    company_id: Number(companyId),
    vendor: { ...rest, ...CA, is_active: true, ...(labor_union ? { labor_union, union_member: true } : { union_member: false }) },
  };
}

// Create / update company user (POST / PATCH /rest/v1.3/companies/{company_id}/users). Procore refuses an
// update that includes email_address, so updates leave it out. No permission template: "apply later".
export function userBody(u, vendorId, seedVendor, { update = false } = {}) {
  const { roleType, email_address, ...rest } = u;
  const fields = { ...rest };
  delete fields.projectRole; // set separately, as a Project Role on the project
  return {
    user: {
      ...fields, ...(update ? {} : { email_address }), ...CA,
      business_phone: seedVendor.business_phone, vendor_id: Number(vendorId),
      is_active: true, is_employee: false, notes: `${TAG}. Role type: ${roleType}.`,
    },
  };
}

// The person's Project Role, spelled as the project spells it (Procore answers 404 for a name it doesn't have)
export function projectRoleFor(wanted, available) {
  if (!wanted) return null;
  return available.find((n) => String(n).trim().toLowerCase() === String(wanted).trim().toLowerCase()) ?? null;
}

// ---------- what the cleanup may touch ----------

const email = (u) => String(u?.email_address ?? "").toLowerCase();
const KEEP_VENDOR = /^architect test company$/i;
const isProcoreUser = (u) => email(u).endsWith("@procore.com");
const seedEmails = new Set(SEED.flatMap((c) => c.users.map((u) => u.email_address.toLowerCase())));
const seedVendorNames = new Set(SEED.map((c) => c.vendor.name.toLowerCase()));
export const isSeedEmail = (e) => seedEmails.has(String(e ?? "").toLowerCase());
export const isSeedVendor = (name) => seedVendorNames.has(String(name ?? "").trim().toLowerCase());

/**
 * Who and what the cleanup would touch. users / vendors: company records (active and inactive) as Procore
 * returns them; meId: the signed-in person. Each row: { id, name, detail, active, action, checked, reason }.
 *   keep        never touched (signed-in person, @procore.com users, Architect TEST Company and its people)
 *   reuse       one of the new test records already exists: updated and made active again, never removed
 *   remove      Ky's earlier test data (mrkygray+ emails, SonLetric): made inactive, checked by default
 *   ask         anything else: listed unchecked, removed only if Ky ticks it
 * Already-inactive rows are left alone (Procore has no delete for users or companies).
 */
export function cleanupPlan({ users, vendors, meId }) {
  const vendorName = (id) => vendors.find((v) => String(v.id) === String(id))?.name ?? "";
  const protectedVendorIds = new Set();
  for (const u of users) {
    const vid = u?.vendor?.id;
    if (vid != null && (String(u.id) === String(meId) || isProcoreUser(u))) protectedVendorIds.add(String(vid));
  }
  for (const v of vendors) if (KEEP_VENDOR.test(String(v.name ?? "").trim())) protectedVendorIds.add(String(v.id));

  const userRows = users.map((u) => {
    const vid = u?.vendor?.id != null ? String(u.vendor.id) : null;
    const row = { id: u.id, name: u.name ?? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(), detail: [u.email_address, u.vendor?.name ?? (vid ? vendorName(vid) : "")].filter(Boolean).join(" · "), active: u.is_active !== false, checked: false };
    if (String(u.id) === String(meId)) return { ...row, action: "keep", reason: "you" };
    if (isProcoreUser(u)) return { ...row, action: "keep", reason: "Procore test user" };
    if (vid && protectedVendorIds.has(vid)) return { ...row, action: "keep", reason: "Architect TEST Company" };
    if (isSeedEmail(u.email_address)) return { ...row, action: "reuse", reason: "new test person, updated" };
    if (!row.active) return { ...row, action: "keep", reason: "already inactive" };
    if (email(u).includes("mrkygray+") || /sonletric/i.test(row.detail)) return { ...row, action: "remove", checked: true, reason: "earlier test data" };
    return { ...row, action: "ask", reason: "not sure: tick to remove" };
  });

  const vendorRows = vendors.map((v) => {
    const row = { id: v.id, name: v.name ?? `Company ${v.id}`, detail: v.email_address ?? "", active: v.is_active !== false, checked: false };
    if (protectedVendorIds.has(String(v.id))) return { ...row, action: "keep", reason: KEEP_VENDOR.test(String(v.name ?? "").trim()) ? "Procore test company" : "has people who stay" };
    if (isSeedVendor(v.name)) return { ...row, action: "reuse", reason: "new test company, updated" };
    if (!row.active) return { ...row, action: "keep", reason: "already inactive" };
    const people = userRows.filter((u) => String(users.find((x) => x.id === u.id)?.vendor?.id) === String(v.id) && u.active);
    const earlier = /mrkygray/i.test(row.detail) || /sonletric/i.test(row.name) || (people.length > 0 && people.every((p) => p.action === "remove"));
    return earlier ? { ...row, action: "remove", checked: true, reason: "earlier test data" } : { ...row, action: "ask", reason: "not sure: tick to remove" };
  });
  return { users: userRows, vendors: vendorRows };
}

/** The ids a cleanup request may actually change: only rows marked remove or ask, never keep or reuse. */
export function removable(plan, userIds, vendorIds) {
  const pick = (rows, ids) => {
    const want = new Set((Array.isArray(ids) ? ids : []).map(String));
    return rows.filter((r) => (r.action === "remove" || r.action === "ask") && want.has(String(r.id)));
  };
  return { users: pick(plan.users, userIds), vendors: pick(plan.vendors, vendorIds) };
}
