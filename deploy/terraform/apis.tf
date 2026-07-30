locals {
  services = [
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = toset(local.services)

  project = var.project_id
  service = each.value

  # Destroying this configuration should not disable APIs that other things in the project
  # may be using.
  disable_on_destroy = false
}
