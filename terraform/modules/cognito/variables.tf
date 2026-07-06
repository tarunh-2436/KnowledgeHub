variable "user_pool_name" {
  description = "Name of the Cognito User Pool."
  type        = string
}

variable "domain_prefix" {
  description = "Cognito Hosted UI domain prefix."
  type        = string
}

variable "callback_urls" {
  description = "OAuth callback URLs."
  type        = list(string)
}

variable "logout_urls" {
  description = "OAuth logout URLs."
  type        = list(string)
}

variable "tags" {
  description = "Tags applied to Cognito resources."
  type        = map(string)
  default     = {}
}