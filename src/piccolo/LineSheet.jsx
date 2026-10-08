import { useState } from "react";
import Sheet from "../Sheet";

const CATEGORIES = [
  ["equipment", "Equipment"],
  ["cable", "Cable"],
  ["labor", "Labor"],
  ["misc", "Other"],
];

// Text in a money/number box: "" stays blank (null); otherwise a number or the typed text
const toNumber = (v) => {
  const t = String(v).replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const asText = (n) => (n === null || n === undefined ? "" : String(n));

/**
 * Edit one BOM / quote line. Saving is one undo step. Changing the part number or price
 * makes it the user's (no more Verify / ESTIMATE badge).
 */
export default function LineSheet({ line, isNew, position, count, showPrices, onSave, onDelete, onDuplicate, onMove, onClose }) {
  const [f, setF] = useState({
    description: line.description,
    qty: asText(line.qty),
    unit: line.unit,
    partNumber: line.partNumber,
    unitCost: asText(line.unitCost),
    unitPrice: asText(line.unitPrice),
    location: line.location,
    notes: line.notes,
    category: line.category,
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = (e) => {
    e.preventDefault();
    const qty = toNumber(f.qty);
    const unitCost = toNumber(f.unitCost);
    const unitPrice = toNumber(f.unitPrice);
    if (!f.description.trim()) return setError("Add a description.");
    if (qty === null || Number.isNaN(qty) || qty <= 0) return setError("Quantity needs to be a number above 0.");
    if (Number.isNaN(unitCost) || Number.isNaN(unitPrice) || unitCost < 0 || unitPrice < 0) {
      return setError("Cost and price need to be numbers, or left blank.");
    }
    const partNumber = f.partNumber.trim();
    const partChanged = partNumber !== line.partNumber;
    const priceChanged = unitPrice !== line.unitPrice || unitCost !== line.unitCost;
    onSave({
      ...line,
      description: f.description.trim(),
      qty: Math.round(qty * 100) / 100,
      unit: f.unit.trim() || "ea",
      partNumber,
      partNumberStatus: !partNumber ? "none" : partChanged ? "user" : line.partNumberStatus,
      unitCost,
      unitPrice,
      priceSource: unitPrice === null ? "none" : priceChanged ? "user" : line.priceSource,
      location: f.location.trim(),
      notes: f.notes.trim(),
      category: f.category,
      checked: true, // the user has looked at it
    });
  };

  return (
    <Sheet title={isNew ? "Add a line" : "Edit line"} onClose={onClose}>
      <form className="sheet-form" onSubmit={save}>
        {error && <p className="error" role="alert">{error}</p>}
        {line.source?.quote && <p className="pc-quote">From the job: “{line.source.quote}”</p>}
        <div className="detail-fields">
          <label>
            Description
            <input value={f.description} onChange={set("description")} maxLength={200} autoFocus={isNew} />
          </label>
          <div className="pc-field-row">
            <label>
              Quantity
              <input value={f.qty} onChange={set("qty")} inputMode="decimal" maxLength={10} />
            </label>
            <label>
              Unit
              <input value={f.unit} onChange={set("unit")} maxLength={20} placeholder="ea, ft, hr" />
            </label>
          </div>
          <label>
            Part number
            <input value={f.partNumber} onChange={set("partNumber")} maxLength={60} autoCapitalize="characters" autoComplete="off" />
          </label>
          {line.partNumberStatus === "ai_suggested" && f.partNumber === line.partNumber && f.partNumber && (
            <p className="pc-hint">The AI suggested this part number; nobody said it. Saving keeps it marked Verify unless you change it, or tap Part number is right.</p>
          )}
          {showPrices && (
            <div className="pc-field-row">
              <label>
                Your cost (each)
                <input value={f.unitCost} onChange={set("unitCost")} inputMode="decimal" placeholder="Blank" maxLength={12} />
              </label>
              <label>
                Price (each)
                <input value={f.unitPrice} onChange={set("unitPrice")} inputMode="decimal" placeholder="Blank" maxLength={12} />
              </label>
            </div>
          )}
          <label>
            Where
            <input value={f.location} onChange={set("location")} maxLength={120} />
          </label>
          <label>
            Notes
            <input value={f.notes} onChange={set("notes")} maxLength={300} />
          </label>
          <label>
            Type
            <select value={f.category} onChange={set("category")}>
              {CATEGORIES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className="save-btn">
          {isNew ? "Add Line" : "Save"}
        </button>
        {!isNew && line.partNumberStatus === "ai_suggested" && f.partNumber === line.partNumber && f.partNumber && (
          <button type="button" className="big-btn plain-btn" onClick={() => onSave({ ...line, partNumberStatus: "user", checked: true })}>
            Part Number Is Right
          </button>
        )}
        {!isNew && (
          <div className="pc-line-actions">
            <button type="button" className="link-btn" disabled={position === 0} onClick={() => onMove(-1)}>
              ↑ Move up
            </button>
            <button type="button" className="link-btn" disabled={position === count - 1} onClick={() => onMove(1)}>
              ↓ Move down
            </button>
            <button type="button" className="link-btn" onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" className="link-btn is-danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        )}
        <button type="button" className="text-btn" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}
