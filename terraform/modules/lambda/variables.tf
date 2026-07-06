variable "function_name" {
  description = "Name of the Lambda function."
  type        = string
}

variable "source_zip" {
  description = "Path to the Lambda deployment package."
  type        = string
}

variable "role_arn" {
  description = "IAM role ARN assumed by the Lambda function."
  type        = string
}

variable "timeout" {
  description = "Lambda execution timeout in seconds."
  type        = number
}

variable "memory_size" {
  description = "Lambda memory allocation in MB."
  type        = number
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags applied to Lambda resources."
  type        = map(string)
  default     = {}
}