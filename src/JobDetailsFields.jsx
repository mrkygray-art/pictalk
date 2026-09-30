import { useRef } from "react";

// Customer and Location boxes, used at End Job and on the job page. Both are optional.
// Enter in Customer moves to Location instead of submitting, so a quick "Go" on the
// phone keyboard doesn't finish the job before Location is filled in.
export default function JobDetailsFields({ customer, location, onChange }) {
  const locationInput = useRef(null);
  return (
    <div className="detail-fields">
      <label>
        Customer
        <input
          value={customer}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          onChange={(e) => onChange({ customer: e.target.value, location })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              locationInput.current?.focus();
            }
          }}
        />
      </label>
      <label>
        Location
        <input
          ref={locationInput}
          value={location}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          placeholder="Address or site name"
          onChange={(e) => onChange({ customer, location: e.target.value })}
        />
      </label>
    </div>
  );
}
