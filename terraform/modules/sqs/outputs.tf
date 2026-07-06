output "queue_name" {
  description = "Name of the SQS queue."
  value       = aws_sqs_queue.this.name
}

output "queue_url" {
  description = "URL of the SQS queue."
  value       = aws_sqs_queue.this.id
}

output "queue_arn" {
  description = "ARN of the SQS queue."
  value       = aws_sqs_queue.this.arn
}

output "dlq_name" {
  description = "Name of the Dead Letter Queue."
  value       = aws_sqs_queue.dlq.name
}

output "dlq_url" {
  description = "URL of the Dead Letter Queue."
  value       = aws_sqs_queue.dlq.id
}

output "dlq_arn" {
  description = "ARN of the Dead Letter Queue."
  value       = aws_sqs_queue.dlq.arn
}