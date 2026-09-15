# Optional inputs are inherited by scripts; saved config wins on later runs.
export PROJECT_ID REGION LAB_NAME LEGACY_TOKEN_CREATOR
.PHONY: bootstrap e2e teardown check-local
bootstrap:
	./scripts/deploy_cloud.sh
e2e:
	./scripts/e2e.sh
teardown:
	./scripts/deploy_cloud.sh --destroy
check-local:
	./scripts/check_local.sh
