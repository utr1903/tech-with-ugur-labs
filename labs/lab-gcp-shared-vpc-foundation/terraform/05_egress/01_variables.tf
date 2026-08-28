variable "region" {
  description = "Region for the Secure Web Proxy."
  type        = string
  default     = "europe-west3"
}

variable "allowed_domains" {
  description = "Domains the host allows out through the proxy."
  type        = list(string)
  default     = ["github.com"]
}
