# The two settings that decide whether grounded answers exist at all:
# the Enterprise tier and the LLM add-on. Without both, answerQuery fails.
resource "google_discovery_engine_search_engine" "app" {
  project        = var.project_id
  engine_id      = local.engine_id
  collection_id  = "default_collection"
  location       = google_discovery_engine_data_store.corpus.location
  display_name   = "Google Drive corpus search app"
  data_store_ids = [google_discovery_engine_data_store.corpus.data_store_id]

  search_engine_config {
    search_tier    = "SEARCH_TIER_ENTERPRISE"
    search_add_ons = ["SEARCH_ADD_ON_LLM"]
  }
}

output "engine_id" {
  description = "Vertex AI Search app the CLI queries."
  value       = google_discovery_engine_search_engine.app.engine_id
}
