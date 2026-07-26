# The two Node services (ADR-0012 T2: one image, two commands).
#
# Secrets are referenced, never declared: bootstrap created them with gcloud so
# no plaintext value reaches Terraform state (T3). Terraform only grants each
# runtime identity access to exactly the secrets its service needs.

locals {
  # Secret Manager entry NAMES, seeded by infra/scripts/bootstrap.sh. These are
  # identifiers, never values — the values exist only in Secret Manager (T3).
  #
  # Each service reads an env var of the SAME name as its secret, so one list
  # drives both the IAM grant and the container env. Keeping them as list
  # elements rather than `name = "VALUE"` assignments also matters: a
  # `<identifier> = "<uppercase literal>"` line in a .tf file is exactly what a
  # committed credential looks like, and secret scanners rightly flag it. Do not
  # "tidy" these back into individual locals.
  control_plane_secrets = ["DATABASE_URL", "APP_RUNTIME_PASSWORD", "CONTROL_PLANE_TOKEN"]
  executor_secrets      = ["DATABASE_URL", "APP_RUNTIME_PASSWORD", "EXECUTOR_TOKEN"]
}

# --- runtime identities ------------------------------------------------------
# One per service, so a compromise of one does not carry the other's rights.
# Neither gets project-level data roles; the executor's reach comes solely from
# being allowed to impersonate individual tenant SAs (see tenants.tf).

resource "google_service_account" "control_plane" {
  account_id   = "control-plane-run"
  display_name = "Control-plane Cloud Run runtime"
  project      = var.project_id
}

resource "google_service_account" "executor" {
  account_id   = "executor-run"
  display_name = "Executor Cloud Run runtime"
  project      = var.project_id
}

# --- secret access (least privilege) ----------------------------------------

resource "google_secret_manager_secret_iam_member" "control_plane_db" {
  for_each  = toset(local.control_plane_secrets)
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

resource "google_secret_manager_secret_iam_member" "executor_db" {
  for_each  = toset(local.executor_secrets)
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.executor.email}"
}

# The executor submits BigQuery jobs as the impersonated tenant SA, but the job
# still has to be created in this project. jobUser grants no data access.
resource "google_project_iam_member" "executor_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.executor.email}"
}

# --- services ----------------------------------------------------------------

resource "google_cloud_run_v2_service" "control_plane" {
  name     = "control-plane"
  location = var.region
  project  = var.project_id
  # ADR-0012's whole point is that the environment can be torn down in one
  # command; the provider defaults this to true, which would make `make destroy`
  # fail on the very resources that cost money (LOG-0057).
  deletion_protection = false
  # Public at the network layer, authenticated by the shared secret in the
  # handler (ADR-0012 T4). The caller is a Cloudflare Worker, which has no
  # keyless way to present GCP IAM credentials.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.control_plane.email
    scaling { min_instance_count = var.min_instances }

    containers {
      image   = var.image
      command = ["node", "src/main/control-plane-server.ts"]

      # What actually runs in production — Cloud Run ignores the image's
      # HEALTHCHECK. Startup gates traffic until /health answers; liveness
      # restarts an instance that stops answering.
      startup_probe {
        http_get { path = "/health" }
        timeout_seconds   = 3
        period_seconds    = 5
        failure_threshold = 5
      }
      liveness_probe {
        http_get { path = "/health" }
        timeout_seconds   = 3
        period_seconds    = 30
        failure_threshold = 3
      }

      dynamic "env" {
        for_each = toset(local.control_plane_secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.control_plane_db]
}

resource "google_cloud_run_v2_service" "executor" {
  name                = "executor"
  location            = var.region
  project             = var.project_id
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.executor.email
    scaling { min_instance_count = var.min_instances }

    containers {
      image   = var.image
      command = ["node", "src/main/executor-server.ts"]

      startup_probe {
        http_get { path = "/health" }
        timeout_seconds   = 3
        period_seconds    = 5
        failure_threshold = 5
      }
      liveness_probe {
        http_get { path = "/health" }
        timeout_seconds   = 3
        period_seconds    = 30
        failure_threshold = 3
      }

      env {
        name  = "QUERY_POLICY"
        value = var.query_policy
      }

      dynamic "env" {
        for_each = toset(local.executor_secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.executor_db]
}

# --- invoker -----------------------------------------------------------------
# See T4. Unauthenticated at the network layer BY DESIGN; the handlers compare
# the shared secret in constant time before trusting anything on the wire, and
# the tenant boundary is resolved server-side regardless of the caller.

resource "google_cloud_run_v2_service_iam_member" "control_plane_public" {
  count    = var.allow_public_invoke ? 1 : 0
  name     = google_cloud_run_v2_service.control_plane.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "executor_public" {
  count    = var.allow_public_invoke ? 1 : 0
  name     = google_cloud_run_v2_service.executor.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
