mock_provider "google" {}
variables {
  project_id      = "test-project"
  server_image    = "europe-west1-docker.pkg.dev/test-project/number-pipeline-server/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  processor_image = "europe-west1-docker.pkg.dev/test-project/number-pipeline-processor/app@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
run "private_delivery" {
  command = apply
  assert {
    condition     = google_cloud_run_v2_service_iam_member.server_invoker.member == "allUsers" && google_cloud_run_v2_service_iam_member.processor_invoker.member == "serviceAccount:number-pipeline-push@test-project.iam.gserviceaccount.com" && google_cloud_run_v2_service_iam_member.processor_invoker.role == "roles/run.invoker" && google_cloud_run_v2_service_iam_member.processor_invoker.name == google_cloud_run_v2_service.processor.name
    error_message = "Only server is public; push identity invokes processor."
  }
  assert {
    condition     = google_pubsub_subscription.processor.push_config[0].oidc_token[0].audience == google_cloud_run_v2_service.processor.uri && google_pubsub_subscription.processor.push_config[0].oidc_token[0].service_account_email == "number-pipeline-push@test-project.iam.gserviceaccount.com" && google_pubsub_subscription.processor.push_config[0].push_endpoint == google_cloud_run_v2_service.processor.uri
    error_message = "Push identity, endpoint, and OIDC audience must match."
  }
  assert {
    condition     = !google_cloud_run_v2_service.server.deletion_protection && !google_cloud_run_v2_service.processor.deletion_protection && google_cloud_run_v2_service.server.template[0].service_account == "number-pipeline-server@test-project.iam.gserviceaccount.com" && google_cloud_run_v2_service.processor.template[0].service_account == "number-pipeline-processor@test-project.iam.gserviceaccount.com"
    error_message = "Services must be disposable and have separate runtime accounts."
  }
}
run "reject_mutable_server_image" {
  command = plan
  variables { server_image = "europe-west1-docker.pkg.dev/test-project/number-pipeline-server/app:latest" }
  expect_failures = [var.server_image]
}
run "reject_wrong_processor_repository" {
  command = plan
  variables { processor_image = "europe-west1-docker.pkg.dev/other-project/number-pipeline-processor/app@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  expect_failures = [var.processor_image]
}
