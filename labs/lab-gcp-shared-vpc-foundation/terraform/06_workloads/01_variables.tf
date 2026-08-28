variable "zone" {
  description = "Zone for the VMs (must match the ingress stage's NEG zone)."
  type        = string
  default     = "europe-west3-a"
}
