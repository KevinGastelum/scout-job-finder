variable "project_id" {
  description = "GCP project that owns the cluster, registry, and service accounts."
  type        = string
}

variable "region" {
  description = "Region for the cluster and the Artifact Registry repository."
  type        = string
  default     = "us-central1"
}

variable "name" {
  description = "Prefix for every resource this configuration creates."
  type        = string
  default     = "scout"

  validation {
    condition     = can(regex("^[a-z]([-a-z0-9]{0,18}[a-z0-9])?$", var.name))
    error_message = "Must be a valid GCP resource name: lowercase, starts with a letter, 1-20 characters."
  }
}

variable "github_repository" {
  description = <<-EOT
    owner/repo allowed to mint tokens for the deploy service account over OIDC.
    This is the whole security boundary of the keyless CI path: a federation provider
    without this restriction can be used by any repository on GitHub.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "Must be exactly owner/repo, with no leading https://github.com/ and no trailing slash."
  }
}

variable "cluster_deletion_protection" {
  description = "Refuse to destroy the cluster. Off by default because this is a demonstration cluster meant to be torn down."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to every resource that accepts them."
  type        = map(string)
  default = {
    app        = "scout"
    managed-by = "terraform"
  }
}
