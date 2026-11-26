variable "region" {
  type        = string
  default     = "eu-central-1"
  description = "AWS Region."
}

variable "availability_zone" {
  type        = string
  default     = "eu-central-1a"
  description = "g6e.2xlarge is offered in several eu-central-1 zones. Switch zones if capacity is short."
}

variable "instance_type" {
  type        = string
  default     = "g6e.2xlarge"
  description = "One NVIDIA L40S (44.7 GiB), enough for the 27B FP8 model plus its KV cache."
}

variable "ami_name" {
  type        = string
  default     = "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04) 20261120"
  description = "Exact AMI name, pinned so every deployment boots the same image."
}

variable "root_volume_gb" {
  type        = number
  default     = 100
  description = "Root volume size. Weights and Docker data live on the local NVMe, not here."
}

variable "allowed_ssh_cidr" {
  type        = string
  description = "Your own public IP as a /32 (for example 203.0.113.7/32). The only address allowed to reach SSH. No default: a wrong default would be unsafe in public."

  validation {
    condition     = can(cidrhost(var.allowed_ssh_cidr, 0)) && can(regex("^\\d{1,3}(\\.\\d{1,3}){3}/32$", var.allowed_ssh_cidr))
    error_message = "allowed_ssh_cidr must be a single IPv4 address in /32 form, such as 203.0.113.7/32."
  }
}

variable "model_id" {
  type        = string
  default     = "Qwen/Qwen3.6-27B-FP8"
  description = "Hugging Face model served by vLLM."
}

variable "model_revision" {
  type        = string
  default     = "a56219b8202864dc6d3e565be5ff1eea01f54cb4"
  description = "Hugging Face commit of the model, pinned."
}

variable "served_model_name" {
  type        = string
  default     = "qwen3.6-27b"
  description = "Name clients use to address the model."
}

variable "max_model_len" {
  type        = number
  default     = 65536
  description = "Context length in tokens."
}

variable "max_num_seqs" {
  type        = number
  default     = 8
  description = "Max sequences vLLM decodes at once. Research agents issue a handful of parallel requests; vLLM's default of 1024 would reserve far more state than the GPU has room for."
}

variable "gpu_memory_utilization" {
  type        = number
  default     = 0.90
  description = "Share of GPU memory vLLM reserves. 0.95 is reported to run out of memory."
}

variable "vllm_extra_args" {
  type        = string
  default     = ""
  description = "Extra vLLM flags, space separated."
}

variable "name_prefix" {
  type        = string
  default     = "ldr-lab"
  description = "Prefix for resource names."
}
