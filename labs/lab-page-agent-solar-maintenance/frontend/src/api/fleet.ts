import { apiFetch } from "./client.js";

export interface Site {
  id: string;
  name: string;
  location: string;
  arrays: string[];
}

export const listSites = (token: string | null) =>
  apiFetch<Site[]>("/api/sites", token);
export const getSite = (token: string | null, id: string) =>
  apiFetch<Site>(`/api/sites/${id}`, token);
