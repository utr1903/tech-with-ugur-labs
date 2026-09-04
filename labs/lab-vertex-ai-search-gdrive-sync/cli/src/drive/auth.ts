import { docs, type docs_v1 } from "@googleapis/docs";
import { drive, type drive_v3, type GlobalOptions } from "@googleapis/drive";
import { GoogleAuth, Impersonated } from "google-auth-library";
import type { LabConfig } from "../config/config.js";

/**
 * This cast gives NO compile-time guarantee — `as unknown as ClientAuth` is a
 * deliberate bypass, not a verified widening. `ClientAuth` resolves to the
 * `OAuth2Client` etc. of the nested `google-auth-library@10.5.0` that
 * `googleapis-common` pulls in (via `@googleapis/drive`/`docs`), which is a
 * different class identity from our pinned `google-auth-library@11.0.2`, so
 * `Impersonated` is not a member of that union even nominally.
 *
 * It is safe at runtime only because `googleapis-common`'s
 * `build/src/apirequest.js` dispatches on the auth client by duck-typing —
 * `typeof authClient === "object"`, then `authClient.getRequestHeaders(url)`
 * or `authClient.request(options)` — and never checks `instanceof`.
 * `Impersonated` (extending the top-level `OAuth2Client`) provides both.
 * `getUniverseDomain` is absent on it, but apirequest.js guards that call with
 * `typeof ... === "function"`, so universe validation is skipped, not thrown.
 *
 * Tripwire: if a future `googleapis-common` starts using `instanceof` on the
 * auth client, or requires `getUniverseDomain`, this breaks at runtime on the
 * first Drive call. The fix then is an npm `overrides` entry deduplicating
 * `google-auth-library`, not a wider cast.
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
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

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
async function impersonatedAuth(serviceAccount: string, scopes: string[]): Promise<Impersonated> {
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
