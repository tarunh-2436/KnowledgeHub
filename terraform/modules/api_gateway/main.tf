resource "aws_apigatewayv2_api" "this" {
  name          = var.api_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]

    allow_methods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "OPTIONS"
    ]

    allow_headers = [
      "Authorization",
      "Content-Type"
    ]

    expose_headers = ["*"]

    max_age = 300
  }

  tags = var.tags
}

resource "aws_apigatewayv2_stage" "this" {
  api_id = aws_apigatewayv2_api.this.id

  name = "$default"

  auto_deploy = true

  tags = var.tags
}