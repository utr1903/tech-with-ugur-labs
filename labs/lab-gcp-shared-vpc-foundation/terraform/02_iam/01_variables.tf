variable "verifier_principal" {
  description = "IAM principal the verifier runs as, format user:<your_email> — must be the account behind your Application Default Credentials (gcloud auth application-default login); it is granted serviceAccountTokenCreator on the lab service accounts so the proofs can impersonate them."
  type        = string
}
