variable "topic_name" {
  description = "Name of the SNS topic."
  type        = string
}

variable "tags" {
  description = "Tags applied to the SNS topic."
  type        = map(string)
  default     = {}
}