resource "google_container_cluster" "this" {
  project  = var.project_id
  name     = var.name
  location = var.region

  # Autopilot rather than Standard: Scout is one small Deployment and one CronJob, so paying
  # for a node pool sized to a peak that never comes is the wrong trade. Autopilot also
  # enforces the NetworkPolicy the chart ships, which Standard does not unless asked.
  enable_autopilot = true

  deletion_protection = var.cluster_deletion_protection

  network    = google_compute_network.this.id
  subnetwork = google_compute_subnetwork.this.id

  ip_allocation_policy {
    cluster_secondary_range_name  = google_compute_subnetwork.this.secondary_ip_range[0].range_name
    services_secondary_range_name = google_compute_subnetwork.this.secondary_ip_range[1].range_name
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false

    master_ipv4_cidr_block = "172.16.0.0/28"
  }

  # Without this the control plane endpoint is open to the entire internet. Empty by default
  # so that applying this configuration cannot silently publish the API server; add your own
  # address here before the first apply.
  master_authorized_networks_config {
    gcp_public_cidrs_access_enabled = false
  }

  release_channel {
    channel = "REGULAR"
  }

  resource_labels = var.labels

  depends_on = [google_project_service.this]
}
