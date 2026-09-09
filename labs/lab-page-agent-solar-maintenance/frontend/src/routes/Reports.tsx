import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listReports, type Report } from "../api/fleet.js";
import { useAuth } from "../auth/AuthContext.js";

export function Reports() {
  const { getToken } = useAuth();
  // null means "not loaded yet"; an empty array means "loaded, and empty".
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listReports(getToken())
      .then(setReports)
      .catch(() => setError("Could not load the reports."));
  }, [getToken]);

  if (error !== "") {
    return (
      <main>
        <h1>Reports</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (reports === null) {
    return (
      <main>
        <h1>Reports</h1>
        <p>Loading reports...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reports</h1>
      {reports.length === 0 ? <p>No reports filed yet.</p> : null}
      <ul>
        {reports.map((report) => (
          <li key={report.id} data-report-id={report.id}>
            <strong>{report.componentRef}</strong> — {report.component},{" "}
            {report.workDate}, {report.durationHours}h, by {report.engineerName}
            <p>{report.summary}</p>
            <p>
              {report.followUpRequired
                ? `Follow-up: ${report.followUpNote}`
                : "No follow-up needed."}
            </p>
          </li>
        ))}
      </ul>
      <nav>
        <Link to="/sites">Back to sites</Link>
      </nav>
    </main>
  );
}
