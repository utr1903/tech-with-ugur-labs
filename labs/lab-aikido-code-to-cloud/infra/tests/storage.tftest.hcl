variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "storage" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_s3_bucket.data.bucket == "aikido-demo-data-${data.aws_caller_identity.current.account_id}" && aws_s3_bucket.data.force_destroy
    error_message = "bucket name / force_destroy"
  }
  assert {
    condition = (
      aws_s3_bucket_public_access_block.data.block_public_acls == false &&
      aws_s3_bucket_public_access_block.data.block_public_policy == false &&
      aws_s3_bucket_public_access_block.data.ignore_public_acls == false &&
      aws_s3_bucket_public_access_block.data.restrict_public_buckets == false
    )
    error_message = "TF-S3-1: all four public access block flags must be false"
  }
  assert {
    condition     = aws_ecr_repository.server.name == "aikido-demo/chatbot-server" && aws_ecr_repository.server.force_delete
    error_message = "ECR name / force_delete"
  }
  assert {
    condition     = aws_ecr_repository.server.image_tag_mutability == "MUTABLE" && aws_ecr_repository.server.image_scanning_configuration[0].scan_on_push == false
    error_message = "ECR must keep mutable tags and scan on push off"
  }
}
