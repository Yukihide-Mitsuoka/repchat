variable "project_id" {
  description = "GCP project the services and tenant identities live in."
  type        = string
}

variable "region" {
  description = <<-EOT
    Cloud Run region. Defaults to Singapore to sit next to Neon: the DB leg is
    chatty (a transaction per control-plane call), while the gate->service leg is
    exactly one round trip, so the ocean crossing belongs on the cheaper leg.
    This is an estimate, not a measurement — moving region is stateless, so
    measure after deploy and change this variable if it is wrong.
  EOT
  type        = string
  default     = "asia-southeast1"
}

variable "image" {
  description = "Fully qualified image (Artifact Registry) both services run."
  type        = string
}

variable "min_instances" {
  description = <<-EOT
    Warm instances per service. 0 keeps the bill at zero while there is no
    traffic, at the cost of cold starts. The control plane is on the hot path of
    EVERY request (the epoch/principal checks deliberately bypass the authz
    cache), so set this to 1 before promising the p95 < 1.5s SLA.
  EOT
  type        = number
  default     = 0
}

variable "query_policy" {
  description = <<-EOT
    Executor table allowlist, as JSON. The service fails closed when this is
    absent or malformed: no table is queryable and every request is refused.
  EOT
  type        = string
  default     = "{\"tables\":[]}"
}

variable "tenants" {
  description = <<-EOT
    Tenants Terraform provisions the D1 connection identity for. Each gets a
    per-tenant service account, READER on its own dataset only, and permission
    for the executor's runtime identity to impersonate it.

    Empty means "no tenants declared yet" — NOT "tenants are unmanaged".
    The LOG-0052 spike fixtures (t-alpha-reader / t-bravo-reader, bound to
    synthetic test datasets) are deliberately left out so test artefacts never
    enter production state.
  EOT
  type = list(object({
    slug    = string # e.g. "acme" -> service account t-acme-reader
    dataset = string # BigQuery dataset holding only this tenant's data
  }))
  default = []
}
