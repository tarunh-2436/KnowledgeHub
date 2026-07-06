variable "bucket_name" {
  description = "Name of the S3 bucket."
  type        = string
}

variable "enable_versioning" {
  description = "Enable bucket versioning."
  type        = bool
  default     = true
}

variable "enable_lifecycle" {
  description = "Enable lifecycle rule to delete non-current object versions after 30 days."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Bucket tags."
  type        = map(string)
  default     = {}
}