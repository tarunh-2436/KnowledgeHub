variable "origin_domain_name" {
  description = "Regional domain name of the S3 origin."
  type        = string
}

variable "origin_id" {
  description = "Origin identifier."
  type        = string
}

variable "tags" {
  description = "Tags applied to CloudFront resources."
  type        = map(string)
  default     = {}
}