# SSH without an open port or a stored key: the endpoint carries a tunnel
# that only IAM-authorised callers can open.
resource "aws_ec2_instance_connect_endpoint" "lab" {
  subnet_id          = aws_subnet.public.id
  security_group_ids = [aws_security_group.endpoint.id]
  preserve_client_ip = false
  tags               = { Name = "${var.name_prefix}-eice" }
}
