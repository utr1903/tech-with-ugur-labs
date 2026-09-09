import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSites, type Site } from "../api/fleet.js";
import { useAuth } from "../auth/AuthContext.js";

export function Sites() {
  const { getToken } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listSites(getToken())
      .then(setSites)
      .catch(() => setError("Could not load the sites."));
  }, [getToken]);

  return (
    <main>
      <h1>Sites</h1>
      {error !== "" ? <p role="alert">{error}</p> : null}
      <ul>
        {sites.map((site) => (
          <li key={site.id}>
            <Link to={`/sites/${site.id}`}>{site.name}</Link>
            <span> — {site.location}</span>
          </li>
        ))}
      </ul>
      <nav>
        <Link to="/reports">All reports</Link>
      </nav>
    </main>
  );
}
