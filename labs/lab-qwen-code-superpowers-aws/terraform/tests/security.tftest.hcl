# Plan-only checks of the security properties the lab promises. The AWS
# provider is mocked, so this runs without credentials and costs nothing.
mock_provider "aws" {
  override_data {
    target = data.aws_ami.dlami
    values = { id = "ami-0123456789abcdef0" }
  }
}

run "vm_is_hardened" {
  command = plan

  assert {
    condition     = aws_instance.vm.metadata_options[0].http_tokens == "required"
    error_message = "Instance metadata must require IMDSv2 tokens."
  }
  assert {
    condition     = aws_instance.vm.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Hop limit 1 keeps containers away from instance metadata."
  }
  assert {
    condition     = aws_instance.vm.root_block_device[0].encrypted
    error_message = "The root volume must be encrypted."
  }
  assert {
    condition     = aws_instance.vm.root_block_device[0].delete_on_termination
    error_message = "The root volume must be deleted with the VM."
  }
}

run "only_the_endpoint_reaches_ssh" {
  command = plan

  assert {
    condition     = aws_ec2_instance_connect_endpoint.lab.preserve_client_ip == false
    error_message = "preserve_client_ip is set explicitly (Terraform and AWS disagree on the default)."
  }
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.vm_ssh_from_endpoint.from_port == 22 &&
      aws_vpc_security_group_ingress_rule.vm_ssh_from_endpoint.to_port == 22 &&
      aws_vpc_security_group_ingress_rule.vm_ssh_from_endpoint.ip_protocol == "tcp"
    )
    error_message = "The VM admits TCP 22 only."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.vm_ssh_from_endpoint.cidr_ipv4 == null
    error_message = "SSH ingress references the endpoint security group, never an IP range."
  }
  assert {
    condition     = aws_vpc_security_group_egress_rule.endpoint_to_vm_ssh.to_port == 22
    error_message = "The endpoint may only open port 22 towards the VM."
  }
}
