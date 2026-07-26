terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Bucket and prefix come from -backend-config (infra/scripts/*.sh), because the
  # bucket name is derived from the project id and the bucket itself is created
  # by bootstrap — it cannot be hardcoded here (ADR-0012 T6).
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
