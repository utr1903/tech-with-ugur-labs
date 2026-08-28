import { GoogleAuth, Impersonated } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export async function impersonatedAuth(
	targetPrincipal: string,
): Promise<GoogleAuth> {
	const baseAuth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
	const sourceClient = await baseAuth.getClient();
	const client = new Impersonated({
		sourceClient,
		targetPrincipal,
		targetScopes: [CLOUD_PLATFORM_SCOPE],
		lifetime: 3600,
	});
	return new GoogleAuth({ authClient: client });
}
