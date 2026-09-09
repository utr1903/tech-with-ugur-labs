import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { COMPONENTS, fileReport, getSite, type Site } from "../api/fleet.js";
import { useAuth } from "../auth/AuthContext.js";

export function ReportForm() {
  const { getToken } = useAuth();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [siteError, setSiteError] = useState("");
  const [component, setComponent] = useState("");
  const [componentRef, setComponentRef] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [summary, setSummary] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNote, setFollowUpNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getSite(getToken(), id)
      .then(setSite)
      .catch(() => setSiteError("Could not load this site."));
  }, [getToken, id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await fileReport(getToken(), id, {
        component,
        componentRef,
        workDate,
        durationHours: Number(durationHours),
        summary,
        followUpRequired,
        followUpNote: followUpRequired ? followUpNote : "",
      });
      navigate("/reports");
    } catch {
      setError("The report could not be filed. Check every field is complete.");
    }
  }

  return (
    <main>
      <h1>File a report</h1>
      {/* Loading and failed must never render as the same thing. */}
      {siteError === "" ? (
        <p>{site ? site.name : "Loading the site..."}</p>
      ) : (
        <p role="alert">{siteError}</p>
      )}
      <form onSubmit={onSubmit}>
        <label htmlFor="component">Component</label>
        <select
          id="component"
          name="component"
          required
          value={component}
          onChange={(e) => setComponent(e.target.value)}
        >
          <option value="">Choose a component</option>
          {COMPONENTS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <label htmlFor="component-ref">Unit</label>
        <input
          id="component-ref"
          name="component-ref"
          type="text"
          required
          maxLength={120}
          value={componentRef}
          onChange={(e) => setComponentRef(e.target.value)}
        />

        <label htmlFor="work-date">Work date</label>
        <input
          id="work-date"
          name="work-date"
          type="date"
          required
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
        />

        <label htmlFor="duration-hours">Hours</label>
        <input
          id="duration-hours"
          name="duration-hours"
          type="number"
          required
          min="0"
          max="24"
          step="0.5"
          value={durationHours}
          onChange={(e) => setDurationHours(e.target.value)}
        />

        <label htmlFor="summary">Summary</label>
        <textarea
          id="summary"
          name="summary"
          required
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        <label htmlFor="follow-up-required">Follow-up needed</label>
        <input
          id="follow-up-required"
          name="follow-up-required"
          type="checkbox"
          checked={followUpRequired}
          onChange={(e) => setFollowUpRequired(e.target.checked)}
        />

        {followUpRequired ? (
          <>
            <label htmlFor="follow-up-note">Follow-up note</label>
            <input
              id="follow-up-note"
              name="follow-up-note"
              type="text"
              value={followUpNote}
              onChange={(e) => setFollowUpNote(e.target.value)}
            />
          </>
        ) : null}

        <button type="submit" name="submit-report">
          Submit report
        </button>
        {error !== "" ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
