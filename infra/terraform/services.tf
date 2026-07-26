# The two Node services (ADR-0012 T2: one image, two commands).
#
# Secrets are referenced, never declared: bootstrap created them with gcloud so
# no plaintext value reaches Terraform state (T3). Terraform only grants each
# runtime identity access to exactly the secrets its service needs.

locals {
  # Secret Manager entry names, seeded by infra/scripts/bootstrap.sh.
  secret_database_url = "DATABASE_URL"
  secret_app_password = "APP_RUNTIME_PASSWORD"
  secret_cp_token     = "CONTROL_PLANE_TOKEN"
  secret_ex_token     = "EXECUTOR_TOKEN"
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
  for_each  = toset([local.secret_database_url, local.secret_app_password, local.secret_cp_token])
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

resource "google_secret_manager_secret_iam_member" "executor_db" {
  for_each  = toset([local.secret_database_url, local.secret_app_password, local.secret_ex_token])
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

      dynamic "env" {
        for_each = {
          DATABASE_URL         = local.secret_database_url
          APP_RUNTIME_PASSWORD = local.secret_app_password
          CONTROL_PLANE_TOKEN  = local.secret_cp_token
        }
        content {
          name = env.key
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
  name     = "executor"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.executor.email
    scaling { min_instance_count = var.min_instances }

    containers {
      image   = var.image
      command = ["node", "src/main/executor-server.ts"]

      env {
        name  = "QUERY_POLICY"
        value = var.query_policy
      }

      dynamic "env" {
        for_each = {
          DATABASE_URL         = local.secret_database_url
          APP_RUNTIME_PASSWORD = local.secret_app_password
          EXECUTOR_TOKEN       = local.secret_ex_token
        }
        content {
          name = env.key
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
  name     = google_cloud_run_v2_service.control_plane.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "executor_public" {
  name     = google_cloud_run_v2_service.executor.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
