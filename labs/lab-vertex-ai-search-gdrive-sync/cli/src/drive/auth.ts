import { docs, type docs_v1 } from "@googleapis/docs";
import { drive, type drive_v3, type GlobalOptions } from "@googleapis/drive";
import { GoogleAuth, Impersonated } from "google-auth-library";
import type { LabConfig } from "../config/config.js";

/**
 * `@googleapis/drive` and `@googleapis/docs` pull in their own nested copy of
 * `google-auth-library` (via `googleapis-common`), so their `auth` option's
 * `OAuth2Client` type is a structurally-identical but nominally distinct class
 * from the one `Impersonated` extends here. Widen through the clients' own
 * declared auth union rather than reaching for `any`.
 */
type ClientAuth = GlobalOptions["auth"];

function asClientAuth(auth: Impersonated): ClientAuth {
  return auth as unknown as ClientAuth;
}

/** Reading the corpus. `sync` holds this and nothing more, so it cannot write to Drive. */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
/** Creating and moving. Only `seed` and the verify harness's deliberate mutations use this. */
export const DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";
/** The source credential's scope — enough to call generateAccessToken on the service account. */
export const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export interface ImpersonationOptions {
  targetPrincipal: string;
  targetScopes: string[];
  lifetime: number;
  delegates: string[];
}

export function impersonationOptions(
  serviceAccount: string,
  scopes: string[],
): ImpersonationOptions {
  if (scopes.length === 0) {
    throw new Error("Refusing to impersonate with an empty scope list.");
  }
  return {
    targetPrincipal: serviceAccount,
    targetScopes: scopes,
    lifetime: 3600,
    delegates: [],
  };
}

export function applicationAuth(): GoogleAuth {
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
}

/**
 * No key file anywhere: the operator's ADC asks IAM Credentials for a
 * short-lived token belonging to the service account, carrying only the scopes
 * this command needs. The service account's Drive access comes from shared-drive
 * membership, not from any IAM role.
 */
export async function impersonatedAuth(
  serviceAccount: string,
  scopes: string[],
): Promise<Impersonated> {
  const sourceClient = await applicationAuth().getClient();
  return new Impersonated({ sourceClient, ...impersonationOptions(serviceAccount, scopes) });
}

export async function driveClient(config: LabConfig, scopes: string[]): Promise<drive_v3.Drive> {
  const auth = await impersonatedAuth(config.syncServiceAccount, scopes);
  return drive({ version: "v3", auth: asClientAuth(auth) });
}

export async function docsClient(config: LabConfig): Promise<docs_v1.Docs> {
  const auth = await impersonatedAuth(config.syncServiceAccount, [DRIVE_WRITE_SCOPE]);
  return docs({ version: "v1", auth: asClientAuth(auth) });
}
