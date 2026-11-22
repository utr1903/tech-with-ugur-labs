variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "vpc" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_vpc.this.cidr_block == "10.0.0.0/16" && aws_vpc.this.enable_dns_support && aws_vpc.this.enable_dns_hostnames
    error_message = "VPC must use var.vpc_cidr with DNS support and hostnames"
  }
  assert {
    condition     = length(aws_subnet.public) == 2 && aws_subnet.public[0].cidr_block == "10.0.0.0/20" && aws_subnet.public[1].cidr_block == "10.0.16.0/20"
    error_message = "two /20 public subnets"
  }
  assert {
    condition     = aws_subnet.public[0].availability_zone != aws_subnet.public[1].availability_zone
    error_message = "subnets must be in different AZs"
  }
  assert {
    condition     = alltrue([for s in aws_subnet.public : s.map_public_ip_on_launch])
    error_message = "subnets must auto-assign public IPs"
  }
  assert {
    condition     = alltrue([for s in aws_subnet.public : s.tags["kubernetes.io/role/elb"] == "1" && s.tags["kubernetes.io/cluster/aikido-demo-eks"] == "shared"])
    error_message = "subnets need the ELB role tag and the cluster tag"
  }
  assert {
    condition     = one(aws_default_security_group.this.ingress).protocol == "-1" && contains(one(aws_default_security_group.this.ingress).cidr_blocks, "0.0.0.0/0")
    error_message = "default SG must allow all ingress"
  }
  assert {
    condition     = one(aws_default_security_group.this.egress).protocol == "-1" && contains(one(aws_default_security_group.this.egress).cidr_blocks, "0.0.0.0/0")
    error_message = "default SG must allow all egress"
  }
  assert {
    condition     = one([for r in aws_route_table.public.route : r if r.cidr_block == "0.0.0.0/0"]) != null
    error_message = "public route table needs a default route"
  }
}
