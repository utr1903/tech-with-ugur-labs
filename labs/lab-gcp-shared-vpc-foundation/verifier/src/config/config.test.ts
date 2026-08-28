import { describe, expect, it } from "bun:test";
import { parseConfig } from "./config";

function validRaw(): string {
	return JSON.stringify({
		host_project_id: { value: "svpc-host-abc123" },
		service_a_project_id: { value: "svpc-service-a-abc123" },
		service_b_project_id: { value: "svpc-service-b-abc123" },
		host_sa_email: {
			value: "sa-host@svpc-host-abc123.iam.gserviceaccount.com",
		},
		service_a_sa_email: {
			value: "sa-service-a@svpc-service-a-abc123.iam.gserviceaccount.com",
		},
		service_b_sa_email: {
			value: "sa-service-b@svpc-service-b-abc123.iam.gserviceaccount.com",
		},
		network_self_link: {
			value:
				"https://www.googleapis.com/compute/v1/projects/svpc-host-abc123/global/networks/svpc",
		},
		subnet_service_a_self_link: {
			value:
				"https://www.googleapis.com/compute/v1/projects/svpc-host-abc123/regions/europe-west3/subnetworks/snet-service-a",
		},
		subnet_service_b_self_link: {
			value:
				"https://www.googleapis.com/compute/v1/projects/svpc-host-abc123/regions/europe-west3/subnetworks/snet-service-b",
		},
		vm_ip_a: { value: "10.10.1.10" },
		vm_ip_b: { value: "10.10.2.10" },
		swp_ip: { value: "10.10.0.10" },
		lb_ip: { value: "203.0.113.7" },
		vm_zone: { value: "europe-west3-a" },
		ssh_key_path: { value: "/tmp/ssh_key" },
		allowed_domain: { value: "github.com" },
		denied_domain: { value: "example.com" },
		tunnel_port_a: { value: 10022 },
		tunnel_port_b: { value: 10023 },
	});
}

describe("parseConfig", () => {
	it("maps terraform output JSON to a typed config", () => {
		const config = parseConfig(validRaw());
		expect(config.hostProjectId).toBe("svpc-host-abc123");
		expect(config.subnetBSelfLink).toContain("snet-service-b");
		expect(config.tunnelPortA).toBe(10022);
		expect(config.deniedDomain).toBe("example.com");
	});

	it("throws listing every missing key", () => {
		const raw = JSON.parse(validRaw());
		delete raw.lb_ip;
		delete raw.tunnel_port_b;
		expect(() => parseConfig(JSON.stringify(raw))).toThrow(
			/lb_ip.*tunnel_port_b|tunnel_port_b.*lb_ip/,
		);
	});
});
