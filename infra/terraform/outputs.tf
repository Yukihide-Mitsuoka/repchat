output "control_plane_url" {
  description = "Set this as CONTROL_PLANE_URL for the gate (wrangler)."
  value       = google_cloud_run_v2_service.control_plane.uri
}

output "executor_url" {
  description = "Set this as EXECUTOR_URL for the gate (wrangler)."
  value       = google_cloud_run_v2_service.executor.uri
}

output "executor_service_account" {
  description = "Runtime identity that impersonates tenant SAs (ADR-0010 D1)."
  value       = google_service_account.executor.email
}

output "tenant_service_accounts" {
  description = "slug -> service-account email. Put these in datasources.connection_ref."
  value       = { for slug, sa in google_service_account.tenant_reader : slug => sa.email }
}
