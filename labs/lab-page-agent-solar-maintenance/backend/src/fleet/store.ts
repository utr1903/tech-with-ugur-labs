import type { SessionUser } from "../auth/tokens.js";
import { SEED_SITES } from "./seed.js";

export interface Site {
  id: string;
  name: string;
  location: string;
  arrays: string[];
}

export const COMPONENTS = [
  "Inverter",
  "Panel string",
  "Combiner box",
  "Tracker motor",
  "Cabling",
  "Monitoring gateway",
] as const;

// NOT exported: nothing outside this file names the type directly — it only
// ever surfaces nested inside NewReport/Report, so exporting it is dead per
// knip. A later consumer can re-export it once something actually imports it.
type Component = (typeof COMPONENTS)[number];

export interface NewReport {
  siteId: string;
  component: Component;
  componentRef: string;
  workDate: string;
  durationHours: number;
  summary: string;
  followUpRequired: boolean;
  followUpNote: string;
}

export interface Report extends NewReport {
  id: string;
  engineerId: string;
  engineerName: string;
  createdAt: string;
}

/**
 * Copies a site deeply enough that a caller cannot reach back into the store.
 * A bare `{ ...site }` is not enough: it shares the `arrays` array, and since
 * the constructor also spreads shallowly, that array is the very one held by
 * the module-level SEED_SITES — so one caller pushing to it would corrupt
 * every FleetStore created afterwards in the same process.
 */
function copySite(site: Site): Site {
  return { ...site, arrays: [...site.arrays] };
}

export class FleetStore {
  readonly #sites: Site[] = SEED_SITES.map(copySite);
  readonly #reports: Report[] = [];
  #nextId = 1;

  listSites(): Site[] {
    return this.#sites.map(copySite);
  }

  getSite(id: string): Site | undefined {
    const site = this.#sites.find((s) => s.id === id);
    return site ? copySite(site) : undefined;
  }

  listReports(): Report[] {
    return this.#reports.map((report) => ({ ...report })).reverse();
  }

  addReport(input: NewReport, user: SessionUser): Report {
    if (!this.getSite(input.siteId))
      throw new Error(`Unknown site "${input.siteId}".`);
    const report: Report = {
      ...input,
      id: `r-${this.#nextId++}`,
      engineerId: user.id,
      engineerName: user.name,
      createdAt: new Date().toISOString(),
    };
    this.#reports.push(report);
    return { ...report };
  }
}
