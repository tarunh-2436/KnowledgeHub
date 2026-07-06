resource "aws_lambda_function" "this" {
  function_name = var.function_name

  filename         = var.source_zip
  source_code_hash = filebase64sha256(var.source_zip)

  role = var.role_arn

  runtime = "python3.13"
  handler = "lambda_function.lambda_handler"

  timeout     = var.timeout
  memory_size = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = var.tags

  depends_on = [
    aws_cloudwatch_log_group.this
  ]
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 30

  tags = var.tags
}