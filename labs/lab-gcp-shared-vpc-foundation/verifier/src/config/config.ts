export type VerifierConfig = {
	hostProjectId: string;
	serviceAProjectId: string;
	serviceBProjectId: string;
	hostSaEmail: string;
	serviceASaEmail: string;
	serviceBSaEmail: string;
	networkSelfLink: string;
	subnetASelfLink: string;
	subnetBSelfLink: string;
	vmIpA: string;
	vmIpB: string;
	swpIp: string;
	lbIp: string;
	vmZone: string;
	sshKeyPath: string;
	allowedDomain: string;
	deniedDomain: string;
	tunnelPortA: number;
	tunnelPortB: number;
};

const stringKeys = {
	host_project_id: "hostProjectId",
	service_a_project_id: "serviceAProjectId",
	service_b_project_id: "serviceBProjectId",
	host_sa_email: "hostSaEmail",
	service_a_sa_email: "serviceASaEmail",
	service_b_sa_email: "serviceBSaEmail",
	network_self_link: "networkSelfLink",
	subnet_service_a_self_link: "subnetASelfLink",
	subnet_service_b_self_link: "subnetBSelfLink",
	vm_ip_a: "vmIpA",
	vm_ip_b: "vmIpB",
	swp_ip: "swpIp",
	lb_ip: "lbIp",
	vm_zone: "vmZone",
	ssh_key_path: "sshKeyPath",
	allowed_domain: "allowedDomain",
	denied_domain: "deniedDomain",
} as const;

const numberKeys = {
	tunnel_port_a: "tunnelPortA",
	tunnel_port_b: "tunnelPortB",
} as const;

type RawOutputs = Record<string, { value?: unknown } | undefined>;

export function parseConfig(raw: string): VerifierConfig {
	const outputs = JSON.parse(raw) as RawOutputs;
	const missing: string[] = [];
	const config: Record<string, string | number> = {};

	for (const [rawKey, field] of Object.entries(stringKeys)) {
		const value = outputs[rawKey]?.value;
		if (typeof value === "string" && value.length > 0) config[field] = value;
		else missing.push(rawKey);
	}
	for (const [rawKey, field] of Object.entries(numberKeys)) {
		const value = outputs[rawKey]?.value;
		if (typeof value === "number") config[field] = value;
		else missing.push(rawKey);
	}

	if (missing.length > 0) {
		throw new Error(
			`verifier-config.json is missing outputs: ${missing.join(", ")}`,
		);
	}
	return config as VerifierConfig;
}
