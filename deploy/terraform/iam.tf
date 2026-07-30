resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "${var.name}-deploy"
  display_name = "Scout CI deployer"
  description  = "Impersonated by GitHub Actions over OIDC to push images and roll the release."
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${var.name}-github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Two independent restrictions, and both are load-bearing. This one stops the provider
  # itself from minting tokens for any other repository on GitHub; without it, a provider
  # trusting token.actions.githubusercontent.com trusts every workflow in the world.
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# And this one restricts which principals of the pool may act as the deploy account. Scoping
# to the repository attribute rather than the whole pool means a second repository added to
# the pool later does not inherit deploy rights.
resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "deploy_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.this.location
  repository = google_artifact_registry_repository.this.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deploy.member
}

# container.developer, not container.admin: CI applies workloads, and changing the shape of
# the cluster stays a deliberate terraform apply.
resource "google_project_iam_member" "deploy_cluster" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = google_service_account.deploy.member
}
