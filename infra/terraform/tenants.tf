# The D1 connection identity, per tenant (ADR-0010 D1, ADR-0012 T5).
#
# Three resources per tenant, and all three are load-bearing:
#   1. a service account            — the identity queries run AS
#   2. READER on its OWN dataset    — the ③ data-layer backstop itself
#   3. tokenCreator for the executor — so the runtime can impersonate it
#
# (2) is what LOG-0052 measured: with only its own dataset granted, a query
# naming another tenant's dataset is refused by BigQuery, even if the AST binder
# failed completely. Widening this grant would silently remove that backstop.

locals {
  tenants_by_slug = { for t in var.tenants : t.slug => t }
}

resource "google_service_account" "tenant_reader" {
  for_each     = local.tenants_by_slug
  account_id   = "t-${each.key}-reader"
  display_name = "RepChat tenant ${each.key} read-only"
  project      = var.project_id
}

# Uses the dataset's native access list rather than setIamPolicy: LOG-0052
# measured `bq add-iam-policy-binding` failing with "requires allowlisting",
# while updating the access list worked. Same reason applies to the IAM-policy
# resources here, so use the one that is known to work.
resource "google_bigquery_dataset_access" "tenant_reader" {
  for_each      = local.tenants_by_slug
  project       = var.project_id
  dataset_id    = each.value.dataset
  role          = "READER"
  user_by_email = google_service_account.tenant_reader[each.key].email
}

# The executor's runtime identity mints short-lived tokens as this SA. In the
# LOG-0052 spike this binding pointed at the owner's own account; production
# must point it at the service, and that move is exactly what Terraform owns.
resource "google_service_account_iam_member" "executor_can_impersonate" {
  for_each           = local.tenants_by_slug
  service_account_id = google_service_account.tenant_reader[each.key].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.executor.email}"
}
