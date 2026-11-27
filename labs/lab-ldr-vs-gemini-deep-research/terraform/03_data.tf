data "aws_ami" "dlami" {
  owners = ["898082745236"]

  filter {
    name   = "name"
    values = [var.ami_name]
  }
}
