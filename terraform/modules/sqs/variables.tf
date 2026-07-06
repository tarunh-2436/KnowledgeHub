variable "queue_name" {
  description = "Name of the SQS queue."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout for the queue."
  type        = number
}

variable "message_retention_seconds" {
  description = "Message retention period."
  type        = number
  default     = 345600
}

variable "max_receive_count" {
  description = "Maximum receives before sending to the DLQ."
  type        = number
  default     = 5
}

variable "tags" {
  description = "Tags applied to the queues."
  type        = map(string)
  default     = {}
}