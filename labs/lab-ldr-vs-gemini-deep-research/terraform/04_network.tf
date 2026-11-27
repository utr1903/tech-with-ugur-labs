resource "aws_vpc" "lab" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "lab" {
  vpc_id = aws_vpc.lab.id
  tags   = { Name = "${var.name_prefix}-igw" }
}

# Public subnet: the VM needs a public IP so you can SSH to it directly
# and so it can download weights and images.
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.lab.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name_prefix}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.lab.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.lab.id
  }

  tags = { Name = "${var.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "vm" {
  name        = "${var.name_prefix}-vm"
  description = "GPU VM: SSH from your own address only"
  vpc_id      = aws_vpc.lab.id
}

# Direct SSH from your /32 rather than an EC2 Instance Connect Endpoint:
# the endpoint caps every connection at one hour, which would cut the
# long-lived tunnel the research runs use to reach the model.
# vLLM itself listens on 127.0.0.1 only and is reached through that tunnel.
resource "aws_vpc_security_group_ingress_rule" "vm_ssh" {
  security_group_id = aws_security_group.vm.id
  cidr_ipv4         = var.allowed_ssh_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

# Outbound stays open: the VM downloads weights and container images.
# The README states this trade-off.
resource "aws_vpc_security_group_egress_rule" "vm_all" {
  security_group_id = aws_security_group.vm.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
