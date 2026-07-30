resource "google_compute_network" "this" {
  project                 = var.project_id
  name                    = var.name
  auto_create_subnetworks = false

  depends_on = [google_project_service.this]
}

resource "google_compute_subnetwork" "this" {
  project       = var.project_id
  name          = var.name
  region        = var.region
  network       = google_compute_network.this.id
  ip_cidr_range = "10.16.0.0/20"

  # Nodes have no external addresses, so this is what lets them reach the Artifact Registry
  # endpoint without a NAT gateway.
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.32.0.0/14"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.36.0.0/20"
  }
}

# Scout's scan fetches from sixteen job boards on the public internet. Private nodes have no
# route there on their own, so without this the cluster comes up healthy and every scan fails.
resource "google_compute_router" "this" {
  project = var.project_id
  name    = var.name
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_router_nat" "this" {
  project = var.project_id
  name    = var.name
  region  = var.region
  router  = google_compute_router.this.name

  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
