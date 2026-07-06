output "website_url" {
  description = "CloudFront URL of the deployed website."
  value       = "https://${module.cloudfront.distribution_domain_name}"
}

output "api_endpoint" {
  description = "HTTP API endpoint."
  value       = module.api_gateway.api_endpoint
}

output "user_pool_id" {
  description = "Cognito User Pool ID."
  value       = module.cognito.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito App Client ID."
  value       = module.cognito.client_id
}