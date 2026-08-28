variable "region" {
  description = "Region for regional resources."
  type        = string
  default     = "europe-west3"
}

variable "zone" {
  description = "Zone for the network endpoint groups (must match the workloads stage)."
  type        = string
  default     = "europe-west3-a"
}

variable "allowlist_cidrs" {
  description = "Caller CIDRs the host admits at the edge. Empty means the front door is closed."
  type        = list(string)
  default     = []
}
