output "cluster_name" {
  description = "Cluster to pass to `gcloud container clusters get-credentials`."
  value       = google_container_cluster.this.name
}

output "cluster_location" {
  description = "Region the cluster runs in."
  value       = google_container_cluster.this.location
}

output "image_repository" {
  description = "Value for the chart's image.repository, without a tag."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.this.repository_id}/scout"
}

output "deploy_service_account" {
  description = "Set as the GitHub Actions secret GCP_SERVICE_ACCOUNT."
  value       = google_service_account.deploy.email
}

output "workload_identity_provider" {
  description = "Set as the GitHub Actions secret GCP_WORKLOAD_IDENTITY_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}
