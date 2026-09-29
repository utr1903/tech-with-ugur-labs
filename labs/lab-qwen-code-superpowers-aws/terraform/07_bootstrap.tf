# After the VM exists: push the lab files through the endpoint tunnel,
# build the images, start vLLM and wait until the model answers. Apply
# returns only when the lab is ready.
resource "terraform_data" "bootstrap" {
  triggers_replace = [
    aws_instance.vm.id,
    # instance_type stops and restarts the VM in place (aws_instance.vm.id
    # does not change), but stopping empties the instance-store NVMe, so
    # bootstrap must still re-run and re-download the weights.
    var.instance_type,
    local.pushed_files_hash,
    jsonencode(local.model_settings),
  ]

  depends_on = [
    aws_ec2_instance_connect_endpoint.lab,
    aws_vpc_security_group_ingress_rule.vm_ssh_from_endpoint,
    aws_vpc_security_group_egress_rule.endpoint_to_vm_ssh,
    aws_vpc_security_group_egress_rule.vm_all,
    aws_route_table_association.public,
  ]

  provisioner "local-exec" {
    command = "${path.module}/../scripts/bootstrap_vm.sh"
    environment = merge(local.model_settings, {
      LAB_INSTANCE_ID = aws_instance.vm.id
      LAB_REGION      = var.region
    })
  }
}
