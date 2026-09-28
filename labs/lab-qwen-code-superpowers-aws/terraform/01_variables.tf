variable "region" {
  type        = string
  default     = "eu-central-1"
  description = "AWS Region. Set it through REGION in the Makefile, not in terraform.tfvars."
}

variable "availability_zone" {
  type        = string
  default     = "eu-central-1a"
  description = "g7e.2xlarge is offered in eu-central-1a and eu-central-1b. Switch zones if capacity is short."
}

variable "instance_type" {
  type        = string
  default     = "g7e.2xlarge"
  description = "One NVIDIA RTX PRO 6000 (96 GiB). Fallback: g6e.2xlarge (L40S, 44.7 GiB) with the smaller model."
}

variable "ami_name" {
  type        = string
  default     = "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04) 20260925"
  description = "Exact AMI name, pinned so every deployment boots the same image."
}

variable "root_volume_gb" {
  type        = number
  default     = 100
  description = "Root volume size. Weights and Docker data live on the local NVMe, not here."
}

variable "model_id" {
  type        = string
  default     = "Qwen/Qwen3-Coder-Next-FP8"
  description = "Hugging Face model served by vLLM."
}

variable "model_revision" {
  type        = string
  default     = "da6e2ed27304dd39abadd9c82ef50e8de67bdd4c"
  description = "Hugging Face commit of the model, pinned."
}

variable "served_model_name" {
  type        = string
  default     = "qwen3-coder-next"
  description = "Name the agent uses to address the model."
}

variable "max_model_len" {
  type        = number
  default     = 262144
  description = "Context length in tokens."
}

variable "gpu_memory_utilization" {
  type        = number
  default     = 0.90
  description = "Share of GPU memory vLLM reserves. 0.95 is reported to run out of memory."
}

variable "vllm_extra_args" {
  type        = string
  default     = ""
  description = "Extra vLLM flags, space separated. The fallback model needs some; see terraform.tfvars.example."
}

variable "max_num_seqs" {
  type        = number
  default     = 16
  description = "Max sequences vLLM decodes at once. Qwen3-Coder-Next is a hybrid model: its linear-attention layers keep one fixed-size Mamba cache state per in-flight sequence, so this is capped by the state slots vLLM preallocates, not by GPU memory alone. One agent plus a handful of subagents needs far fewer than vLLM's default of 1024."
}

variable "name_prefix" {
  type        = string
  default     = "qwen-coder"
  description = "Prefix for resource names."
}
