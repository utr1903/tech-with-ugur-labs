# No instance profile and no key pair: the VM holds no AWS credentials and
# accepts only short-lived keys pushed through EC2 Instance Connect.
resource "aws_instance" "vm" {
  ami                         = data.aws_ami.dlami.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.vm.id]
  associate_public_ip_address = true
  user_data                   = file("${path.module}/../vm/host/boot.sh")
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
    tags                  = merge(local.tags, { Name = "${var.name_prefix}-root" })
  }

  tags = { Name = "${var.name_prefix}-vm" }
}

output "instance_id" {
  value = aws_instance.vm.id
}

output "region" {
  value = var.region
}

output "availability_zone" {
  value = aws_instance.vm.availability_zone
}

output "public_ip" {
  description = "Used only to prove that nothing listens publicly."
  value       = aws_instance.vm.public_ip
}
