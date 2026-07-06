variable "aws_region" {
  description = "AWS region where resources will be deployed."
  type        = string

  default = "us-east-1"
}

variable "admin_email" {
  description = "Email address for CloudWatch alarm notifications."
  type        = string
}