mock_provider "google" {}
mock_provider "google-beta" {}
override_resource {
  target = google_service_account.apps["push"]
  values = {
    name  = "projects/test-project/serviceAccounts/number-pipeline-push@test-project.iam.gserviceaccount.com"
    email = "number-pipeline-push@test-project.iam.gserviceaccount.com"
  }
}
variables { project_id = "test-project" }
run "resource_scoped_access" {
  command = apply
  assert {
    condition     = google_pubsub_topic_iam_member.publisher.role == "roles/pubsub.publisher" && google_pubsub_topic_iam_member.publisher.topic == google_pubsub_topic.numbers.name && google_pubsub_topic_iam_member.publisher.member == "serviceAccount:${google_service_account.apps["server"].email}"
    error_message = "Publisher grant must be scoped to the topic and server."
  }
  assert {
    condition     = google_storage_bucket_iam_member.creator.role == "roles/storage.objectCreator" && google_storage_bucket_iam_member.creator.bucket == google_storage_bucket.results.name && google_storage_bucket_iam_member.creator.member == "serviceAccount:${google_service_account.apps["processor"].email}"
    error_message = "Processor must only create objects in the lab bucket."
  }
  assert {
    condition     = google_storage_bucket.results.uniform_bucket_level_access && google_storage_bucket.results.public_access_prevention == "enforced" && google_storage_bucket.results.force_destroy && google_storage_bucket.results.soft_delete_policy[0].retention_duration_seconds == 0
    error_message = "Bucket must be private and disposable without soft-delete retention."
  }
  assert {
    condition     = alltrue([for api in google_project_service.apis : !api.disable_on_destroy]) && alltrue([for repo in google_artifact_registry_repository.images : repo.deletion_policy == "DELETE"])
    error_message = "Destroy must preserve APIs and remove lab registries."
  }
  assert {
    condition     = length(google_service_account_iam_member.legacy_token_creator) == 0 && length(google_service_account.apps) == 3
    error_message = "Three distinct identities; no redundant token grant by default."
  }
}
run "legacy_scope" {
  command = apply
  variables { legacy_token_creator = true }
  assert {
    condition     = google_service_account_iam_member.legacy_token_creator[0].service_account_id == google_service_account.apps["push"].name && google_service_account_iam_member.legacy_token_creator[0].member == "serviceAccount:${google_project_service_identity.pubsub.email}" && google_service_account_iam_member.legacy_token_creator[0].role == "roles/iam.serviceAccountTokenCreator"
    error_message = "Optional token minting must target only the push account."
  }
}
