.PHONY: foundation iam network ingress egress workloads deploy verify destroy

foundation:
	./scripts/deploy_cloud.sh --stage 01_foundation

iam:
	./scripts/deploy_cloud.sh --stage 02_iam

network:
	./scripts/deploy_cloud.sh --stage 03_network

ingress:
	./scripts/deploy_cloud.sh --stage 04_ingress

egress:
	./scripts/deploy_cloud.sh --stage 05_egress

workloads:
	./scripts/deploy_cloud.sh --stage 06_workloads

deploy: foundation iam network ingress egress workloads

verify:
	./scripts/verify.sh

destroy:
	./scripts/deploy_cloud.sh --stage 06_workloads --destroy
	./scripts/deploy_cloud.sh --stage 05_egress --destroy
	./scripts/deploy_cloud.sh --stage 04_ingress --destroy
	./scripts/deploy_cloud.sh --stage 03_network --destroy
	./scripts/deploy_cloud.sh --stage 02_iam --destroy
	./scripts/deploy_cloud.sh --stage 01_foundation --destroy
	rm -f terraform/04_ingress/allowlist.auto.tfvars verifier-config.json
