terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source = "hashicorp/google"
      # Pinned to a minor line: the GKE and Workload Identity Federation resources here have
      # changed shape across majors more than once.
      version = "~> 6.20"
    }
  }

  # State holds the project id and every resource's identity, so it does not belong in the
  # repository. The bucket has to exist before the first init, which is the one thing this
  # configuration cannot create for itself:
  #
  #   gcloud storage buckets create gs://BUCKET --location=US --uniform-bucket-level-access
  #   gcloud storage buckets update gs://BUCKET --versioning
  #   terraform init -backend-config="bucket=BUCKET"
  #
  # backend "gcs" {
  #   prefix = "scout"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
