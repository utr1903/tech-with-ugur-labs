variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "skeleton" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = output.region == "eu-central-1"
    error_message = "region output must default to eu-central-1"
  }
  assert {
    condition     = output.account_id == data.aws_caller_identity.current.account_id
    error_message = "account_id output must be the caller's account"
  }
  assert {
    condition     = local.cluster_name == "aikido-demo-eks" && local.ecr_repository_name == "aikido-demo/chatbot-server"
    error_message = "derived names must follow the aikido-demo prefix"
  }
  assert {
    condition     = local.bucket_name == "aikido-demo-data-${data.aws_caller_identity.current.account_id}"
    error_message = "bucket name must be <prefix>-data-<account_id>"
  }
  assert {
    condition     = length(local.azs) == 2 && local.azs[0] != local.azs[1]
    error_message = "exactly two distinct AZs"
  }
  assert {
    condition     = var.kubernetes_version == "1.37" && var.node_instance_type == "t3.medium" && var.node_count == 2 && var.vpc_cidr == "10.0.0.0/16"
    error_message = "variable defaults drifted"
  }
  assert {
    condition     = var.app_namespace == "chatbot" && var.app_service_account == "chatbot-server" && var.aikido_external_id == "aikido-123456"
    error_message = "variable defaults drifted"
  }
}

run "external_id_rejects_garbage" {
  command = plan

  module {
    source = "./modules/aws-env"
  }
  variables {
    aikido_external_id = "178288"
  }
  expect_failures = [var.aikido_external_id]
}

# The root wires the AWS module through to the outputs the scripts consume.
run "root_wiring_aws" {
  command = plan

  override_resource {
    target          = module.aws.aws_ecr_repository.server
    override_during = plan
    values = {
      repository_url = "123456789012.dkr.ecr.eu-central-1.amazonaws.com/aikido-demo/chatbot-server"
    }
  }

  assert {
    condition     = output.region == "eu-central-1" && output.cluster_name == "aikido-demo-eks"
    error_message = "root outputs region and cluster_name must come from module.aws"
  }
  assert {
    condition     = output.data_bucket_name == "aikido-demo-data-${output.account_id}"
    error_message = "root output data_bucket_name must come from module.aws"
  }
  assert {
    condition     = output.ecr_repository_url == "123456789012.dkr.ecr.eu-central-1.amazonaws.com/aikido-demo/chatbot-server"
    error_message = "root output ecr_repository_url must come from module.aws"
  }
}

run "gcp_envs_rejects_other_sets" {
  command = plan

  variables {
    gcp_envs = ["staging"]
  }
  expect_failures = [var.gcp_envs]
}
