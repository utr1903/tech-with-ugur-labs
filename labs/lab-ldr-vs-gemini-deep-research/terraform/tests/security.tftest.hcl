# Plan-only checks of the security properties the lab promises. The AWS
# provider is mocked, so this runs without credentials and costs nothing.
mock_provider "aws" {
  override_data {
    target = data.aws_ami.dlami
    values = { id = "ami-0123456789abcdef0" }
  }
}

variables {
  allowed_ssh_cidr = "203.0.113.7/32"
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

# Unset computed attributes are unknown at plan time, so "no profile and no
# key pair" is checked on the configuration source itself.
run "vm_holds_no_credentials_and_no_key" {
  command = plan

  assert {
    condition = !anytrue([
      for f in fileset(path.module, "*.tf") :
      can(regex("(?m)^\\s*resource\\s+\"aws_iam_(instance_profile|role|user|access_key)\"", file("${path.module}/${f}")))
    ])
    error_message = "The lab creates no IAM instance profile, role, user or access key."
  }
  assert {
    condition     = !can(regex("(?m)^\\s*(iam_instance_profile|key_name)\\s*=", file("${path.module}/05_vm.tf")))
    error_message = "The VM sets neither iam_instance_profile nor key_name."
  }
}

run "ssh_only_from_your_own_address" {
  command = plan

  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.vm_ssh.from_port == 22 &&
      aws_vpc_security_group_ingress_rule.vm_ssh.to_port == 22 &&
      aws_vpc_security_group_ingress_rule.vm_ssh.ip_protocol == "tcp"
    )
    error_message = "The VM admits TCP 22 only."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.vm_ssh.cidr_ipv4 == "203.0.113.7/32"
    error_message = "SSH ingress is exactly the reader's own /32."
  }
}

run "open_ssh_range_is_rejected" {
  command = plan

  variables {
    allowed_ssh_cidr = "0.0.0.0/0"
  }

  expect_failures = [var.allowed_ssh_cidr]
}

run "wider_than_one_address_is_rejected" {
  command = plan

  variables {
    allowed_ssh_cidr = "203.0.113.0/24"
  }

  expect_failures = [var.allowed_ssh_cidr]
}
