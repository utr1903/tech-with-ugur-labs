locals {
  lab_name = "qwen-code-superpowers-aws"
  tags     = { lab = local.lab_name }

  # Files pushed to the VM. A change to any of them re-runs bootstrap
  # without replacing the VM, so weights stay downloaded.
  pushed_files = sort(concat(
    [for f in fileset("${path.module}/../vm", "**") : "vm/${f}" if !strcontains(f, "node_modules")],
    [for f in fileset("${path.module}/../tasks", "**") : "tasks/${f}"],
  ))
  pushed_files_hash = sha1(join(",", [for f in local.pushed_files : "${f}:${filesha1("${path.module}/../${f}")}"]))

  model_settings = {
    MODEL_ID               = var.model_id
    MODEL_REVISION         = var.model_revision
    SERVED_MODEL_NAME      = var.served_model_name
    MAX_MODEL_LEN          = tostring(var.max_model_len)
    GPU_MEMORY_UTILIZATION = tostring(var.gpu_memory_utilization)
    VLLM_EXTRA_ARGS        = var.vllm_extra_args
  }
}
