variable "api_name" {
  description = "Name of the HTTP API."
  type        = string
}

variable "tags" {
  description = "Tags applied to API Gateway resources."
  type        = map(string)
  default     = {}
}