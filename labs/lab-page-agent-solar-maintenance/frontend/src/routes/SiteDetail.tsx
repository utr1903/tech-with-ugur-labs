import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSite, type Site } from "../api/fleet.js";
import { useAuth } from "../auth/AuthContext.js";

export function SiteDetail() {
  const { getToken } = useAuth();
  const { id = "" } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSite(getToken(), id)
      .then(setSite)
      .catch(() => setError("Could not load this site."));
  }, [getToken, id]);

  // A failure must not be indistinguishable from a request still in flight.
  if (error !== "")
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );

  if (!site)
    return (
      <main>
        <p>Loading the site...</p>
      </main>
    );

  return (
    <main>
      <h1>{site.name}</h1>
      <p>{site.location}</p>
      <h2>Arrays</h2>
      <ul>
        {site.arrays.map((array) => (
          <li key={array}>{array}</li>
        ))}
      </ul>
      <Link to={`/sites/${site.id}/report`}>File a report</Link>
    </main>
  );
}
