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

export interface Report {
  id: string;
  siteId: string;
  engineerName: string;
  component: string;
  componentRef: string;
  workDate: string;
  durationHours: number;
  summary: string;
  followUpRequired: boolean;
  followUpNote: string;
}

export const listReports = (token: string | null) =>
  apiFetch<Report[]>("/api/reports", token);

export interface NewReport {
  component: string;
  componentRef: string;
  workDate: string;
  durationHours: number;
  summary: string;
  followUpRequired: boolean;
  followUpNote: string;
}

export const fileReport = (
  token: string | null,
  siteId: string,
  body: NewReport,
) =>
  apiFetch<Report>(`/api/sites/${siteId}/reports`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const COMPONENTS = [
  "Inverter",
  "Panel string",
  "Combiner box",
  "Tracker motor",
  "Cabling",
  "Monitoring gateway",
] as const;
