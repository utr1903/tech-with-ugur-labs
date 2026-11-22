resource "aws_s3_bucket" "data" {
  bucket        = local.bucket_name
  force_destroy = true
}

# INSECURE-BY-DESIGN: versioning disabled
# (deliberately no aws_s3_bucket_versioning resource for aws_s3_bucket.data)

# INSECURE-BY-DESIGN: no server access logging
# (deliberately no aws_s3_bucket_logging resource for aws_s3_bucket.data)

# INSECURE-BY-DESIGN: no customer-managed KMS key for PII data
# (deliberately no aws_s3_bucket_server_side_encryption_configuration resource; AWS applies SSE-S3 by default)

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  # INSECURE-BY-DESIGN: public access block disabled
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}
