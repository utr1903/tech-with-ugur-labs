resource "google_discovery_engine_data_store" "corpus" {
  project           = var.project_id
  location          = var.search_location
  data_store_id     = local.data_store_id
  display_name      = "Vertex AI Search RAG lab corpus"
  industry_vertical = "GENERIC"

  # CONTENT_REQUIRED is what makes this an unstructured-document store:
  # the documents themselves are the data, not rows of metadata.
  content_config = "CONTENT_REQUIRED"
  solution_types = ["SOLUTION_TYPE_SEARCH"]

  # The lab is disposable; let terraform destroy really destroy it.
  deletion_policy = "DELETE"

  depends_on = [google_project_service.discoveryengine]
}

output "data_store_id" {
  description = "Discovery Engine data store that holds the indexed corpus."
  value       = google_discovery_engine_data_store.corpus.data_store_id
}
