###############################################################################
# Terraform Configuration
###############################################################################

terraform {
  required_version = ">= 1.12"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "tarun-terraform-state"
    key          = "knowledgehub/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

###############################################################################
# Provider Configuration
###############################################################################

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

###############################################################################
# Local Values
###############################################################################

locals {

  project_name = "knowledgehub"

  tags = {
    Project   = local.project_name
    Owner     = "Tarun"
    ManagedBy = "Terraform"
  }

}

###############################################################################
# Website Bucket
###############################################################################

module "website_bucket" {
  source = "./modules/s3"

  bucket_name       = "${local.project_name}-website"
  enable_versioning = true
  enable_lifecycle  = true

  tags = local.tags
}

resource "aws_s3_bucket_policy" "website_bucket_policy" {

  bucket = module.website_bucket.bucket_id

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {

        Sid = "AllowCloudFrontService"

        Effect = "Allow"

        Principal = {
          Service = "cloudfront.amazonaws.com"
        }

        Action = [
          "s3:GetObject"
        ]

        Resource = [
          "${module.website_bucket.bucket_arn}/*"
        ]

        Condition = {

          StringEquals = {

            "AWS:SourceArn" = module.cloudfront.distribution_arn

          }

        }

      }

    ]

  })

}

###############################################################################
# Storage Bucket
###############################################################################

module "storage_bucket" {
  source = "./modules/s3"

  bucket_name       = "${local.project_name}-storage"
  enable_versioning = true
  enable_lifecycle  = true

  tags = local.tags
}

resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = module.storage_bucket.bucket_id

  cors_rule {
    allowed_headers = ["*"]

    allowed_methods = [
      "GET",
      "PUT",
      "POST",
      "HEAD"
    ]

    allowed_origins = [
      "*"
    ]

    expose_headers = [
      "ETag"
    ]

    max_age_seconds = 3000
  }
}

###############################################################################
# Log Archive Bucket
###############################################################################

module "log_archive_bucket" {
  source = "./modules/s3"

  bucket_name       = "${local.project_name}-log-archive"
  enable_versioning = true
  enable_lifecycle  = false

  tags = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "log_archive_retention" {
  bucket = module.log_archive_bucket.bucket_id

  rule {
    id     = "DeleteOldLogs"
    status = "Enabled"

    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_policy" "log_archive_bucket_policy" {

  bucket = module.log_archive_bucket.bucket_id

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {
        Sid    = "CloudWatchLogsAclCheck"
        Effect = "Allow"

        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }

        Action = "s3:GetBucketAcl"

        Resource = module.log_archive_bucket.bucket_arn
      },

      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"

        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }

        Action = "s3:PutObject"

        Resource = "${module.log_archive_bucket.bucket_arn}/*"

        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }

    ]

  })
}

###############################################################################
# DynamoDB
###############################################################################

module "dynamodb" {
  source = "./modules/dynamodb"

  table_name = "${local.project_name}-documents"

  tags = local.tags
}

###############################################################################
# Cognito
###############################################################################

module "cognito" {
  source = "./modules/cognito"

  user_pool_name = "${local.project_name}-users"

  domain_prefix = "tarun-${local.project_name}-auth"

  callback_urls = [
    "https://${module.cloudfront.distribution_domain_name}"
  ]

  logout_urls = [
    "https://${module.cloudfront.distribution_domain_name}"
  ]

  tags = local.tags
}

###############################################################################
# SNS
###############################################################################

module "notifications_topic" {
  source = "./modules/sns"

  topic_name = "${local.project_name}-notifications"

  tags = local.tags
}

resource "aws_sns_topic_subscription" "admin_email" {

  topic_arn = module.notifications_topic.topic_arn

  protocol = "email"

  endpoint = var.admin_email

}

###############################################################################
# Upload Queue
###############################################################################

module "upload_queue" {
  source = "./modules/sqs"

  queue_name                 = "${local.project_name}-upload-queue"
  visibility_timeout_seconds = 60

  tags = local.tags
}

resource "aws_lambda_event_source_mapping" "upload_queue_mapping" {

  event_source_arn = module.upload_queue.queue_arn

  function_name = module.ingestion_lambda.function_arn

  batch_size = 1

  enabled = true

}

###############################################################################
# Processing Queue
###############################################################################

module "processing_queue" {
  source = "./modules/sqs"

  queue_name                 = "${local.project_name}-processing-queue"
  visibility_timeout_seconds = 360

  tags = local.tags
}

resource "aws_lambda_event_source_mapping" "processing_queue_mapping" {

  event_source_arn = module.processing_queue.queue_arn

  function_name = module.processor_lambda.function_arn

  batch_size = 1

  enabled = true
}

###############################################################################
# API Lambda
###############################################################################

resource "aws_iam_role" "api_lambda_role" {
  name = "${local.project_name}-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Principal = {
          Service = "lambda.amazonaws.com"
        }

        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "api_lambda_policy" {
  name        = "${local.project_name}-api-lambda-policy"
  description = "Least-privilege IAM policy for the API Lambda."

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [

      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"

        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]

        Resource = "arn:aws:logs:*:*:*"
      },

      {
        Sid    = "UploadQueue"
        Effect = "Allow"

        Action = [
          "sqs:SendMessage",
        ]

        Resource = module.upload_queue.queue_arn
      },

      {
        "Effect" : "Allow",

        "Action" : [
          "sns:ListSubscriptionsByTopic",
          "sns:Subscribe"
        ],

        "Resource" : module.notifications_topic.topic_arn
      },

      {
        Sid    = "DatabaseActions"
        Effect = "Allow"

        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]

        Resource = [
          module.dynamodb.table_arn,
          "${module.dynamodb.table_arn}/index/*"
        ]
      },

      {
        Sid    = "StorageObjects"
        Effect = "Allow"

        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]

        Resource = "${module.storage_bucket.bucket_arn}/*"
      },

      {
        Sid    = "StorageBucket"
        Effect = "Allow"

        Action = [
          "s3:ListBucket"
        ]

        Resource = module.storage_bucket.bucket_arn
      },

      {
        "Sid" : "CognitoLookup",
        "Effect" : "Allow",

        "Action" : [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminGetUser",
        ],

        "Resource" : module.cognito.user_pool_arn
      }

    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_lambda_policy_attachment" {

  role       = aws_iam_role.api_lambda_role.name
  policy_arn = aws_iam_policy.api_lambda_policy.arn

}

module "api_lambda" {
  source = "./modules/lambda"

  function_name = "${local.project_name}-api"

  source_zip = "../lambda/api/lambda.zip"

  role_arn = aws_iam_role.api_lambda_role.arn

  timeout = 30

  memory_size = 256

  environment_variables = {

    TABLE_NAME = module.dynamodb.table_name

    STORAGE_BUCKET = module.storage_bucket.bucket_name

    UPLOAD_QUEUE_URL = module.upload_queue.queue_url

    USER_POOL_ID = module.cognito.user_pool_id

    USER_POOL_CLIENT_ID = module.cognito.client_id

    SNS_TOPIC_ARN = module.notifications_topic.topic_arn

  }

  tags = local.tags
}

###############################################################################
# Ingestion Lambda
###############################################################################

resource "aws_iam_role" "ingestion_lambda_role" {
  name = "${local.project_name}-ingestion-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Principal = {
          Service = "lambda.amazonaws.com"
        }

        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "ingestion_lambda_policy" {

  name        = "${local.project_name}-ingestion-lambda-policy"
  description = "Least-privilege IAM policy for the Ingestion Lambda."

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"

        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]

        Resource = "arn:aws:logs:*:*:*"
      },

      {
        Sid    = "UploadQueue"
        Effect = "Allow"

        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]

        Resource = module.upload_queue.queue_arn
      },

      {
        Sid    = "ProcessingQueue"
        Effect = "Allow"

        Action = [
          "sqs:SendMessage"
        ]

        Resource = module.processing_queue.queue_arn
      },

      {
        Sid    = "StorageBucket"
        Effect = "Allow"

        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]

        Resource = "${module.storage_bucket.bucket_arn}/*"
      },

      {
        Sid    = "ListStorageBucket"
        Effect = "Allow"

        Action = [
          "s3:ListBucket"
        ]

        Resource = module.storage_bucket.bucket_arn
      },

      {
        Sid    = "DynamoDB"
        Effect = "Allow"

        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:ConditionCheckItem",
          "dynamodb:TransactWriteItems"
        ]

        Resource = module.dynamodb.table_arn
      }

    ]

  })

}

resource "aws_iam_role_policy_attachment" "ingestion_lambda_policy_attachment" {

  role = aws_iam_role.ingestion_lambda_role.name

  policy_arn = aws_iam_policy.ingestion_lambda_policy.arn

}

module "ingestion_lambda" {
  source = "./modules/lambda"

  function_name = "${local.project_name}-ingestion"

  source_zip = "../lambda/ingestion/lambda.zip"

  role_arn = aws_iam_role.ingestion_lambda_role.arn

  timeout = 60

  memory_size = 512

  environment_variables = {

    TABLE_NAME = module.dynamodb.table_name

    STORAGE_BUCKET = module.storage_bucket.bucket_name

    PROCESSING_QUEUE_URL = module.processing_queue.queue_url

  }

  tags = local.tags
}

###############################################################################
# Processor Lambda
###############################################################################

resource "aws_iam_role" "processor_lambda_role" {
  name = "${local.project_name}-processor-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Principal = {
          Service = "lambda.amazonaws.com"
        }

        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "processor_lambda_policy" {

  name        = "${local.project_name}-processor-lambda-policy"
  description = "Least-privilege IAM policy for the Processor Lambda."

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"

        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]

        Resource = "arn:aws:logs:*:*:*"
      },

      {
        Sid    = "ProcessingQueue"
        Effect = "Allow"

        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]

        Resource = module.processing_queue.queue_arn
      },

      {
        Sid    = "StorageBucket"
        Effect = "Allow"

        Action = [
          "s3:GetObject"
        ]

        Resource = "${module.storage_bucket.bucket_arn}/*"
      },

      {
        Sid    = "DynamoDB"
        Effect = "Allow"

        Action = [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem"
        ]

        Resource = module.dynamodb.table_arn
      },

    ]

  })

}

resource "aws_iam_role_policy_attachment" "processor_lambda_policy_attachment" {

  role = aws_iam_role.processor_lambda_role.name

  policy_arn = aws_iam_policy.processor_lambda_policy.arn

}

module "processor_lambda" {
  source = "./modules/lambda"

  function_name = "${local.project_name}-processor"

  source_zip = "../lambda/processor/lambda.zip"

  role_arn = aws_iam_role.processor_lambda_role.arn

  timeout = 300

  memory_size = 1024

  environment_variables = {

    TABLE_NAME = module.dynamodb.table_name

    STORAGE_BUCKET = module.storage_bucket.bucket_name

  }

  tags = local.tags
}

###############################################################################
# API Gateway
###############################################################################

module "api_gateway" {
  source = "./modules/api_gateway"

  api_name = "${local.project_name}-api"

  tags = local.tags
}

resource "aws_apigatewayv2_authorizer" "jwt_authorizer" {

  api_id = module.api_gateway.api_id

  authorizer_type = "JWT"

  identity_sources = [
    "$request.header.Authorization"
  ]

  name = "jwt-authorizer"

  jwt_configuration {

    audience = [
      module.cognito.client_id
    ]

    issuer = "https://cognito-idp.${var.aws_region}.amazonaws.com/${module.cognito.user_pool_id}"

  }

}

resource "aws_apigatewayv2_integration" "api_lambda" {

  api_id = module.api_gateway.api_id

  integration_type = "AWS_PROXY"

  integration_uri = module.api_lambda.invoke_arn

  integration_method = "POST"

  payload_format_version = "2.0"

}

locals {

  api_routes = [

    "POST /documents/init",

    "POST /documents/complete",

    "GET /documents",

    "GET /documents/shared",

    "GET /documents/{documentId}",

    "PATCH /documents/{documentId}",

    "DELETE /documents/{documentId}",

    "POST /documents/{documentId}/versions/init",

    "POST /documents/{documentId}/versions/complete",

    "GET /documents/{documentId}/versions",

    "GET /documents/{documentId}/versions/{versionNumber}",

    "POST /documents/{documentId}/versions/{versionNumber}/restore",

    "POST /documents/{documentId}/shares",

    "GET /documents/{documentId}/shares",

    "DELETE /documents/{documentId}/shares/{userId}",

    "GET /admin/statistics",

    "GET /admin/documents",

    "GET /admin/processing"

  ]

}

resource "aws_apigatewayv2_route" "routes" {

  for_each = toset(local.api_routes)

  api_id = module.api_gateway.api_id

  route_key = each.value

  authorization_type = "JWT"

  authorizer_id = aws_apigatewayv2_authorizer.jwt_authorizer.id

  target = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"

}

resource "aws_lambda_permission" "allow_api_gateway" {

  statement_id = "AllowApiGatewayInvoke"

  action = "lambda:InvokeFunction"

  function_name = module.api_lambda.function_name

  principal = "apigateway.amazonaws.com"

  source_arn = "${module.api_gateway.execution_arn}/*/*"

}

###############################################################################
# CloudFront
###############################################################################

module "cloudfront" {
  source = "./modules/cloudfront"

  origin_domain_name = module.website_bucket.regional_domain_name

  origin_id = module.website_bucket.bucket_id

  tags = local.tags
}

###############################################################################
# Monitoring
###############################################################################

resource "aws_cloudwatch_metric_alarm" "api_lambda_errors" {
  alarm_name        = "${local.project_name}-api-lambda-errors"
  alarm_description = "Alarm when the API Lambda reports errors."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    FunctionName = module.api_lambda.function_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "ingestion_lambda_errors" {
  alarm_name        = "${local.project_name}-ingestion-lambda-errors"
  alarm_description = "Alarm when the Ingestion Lambda reports errors."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    FunctionName = module.ingestion_lambda.function_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "processor_lambda_errors" {
  alarm_name        = "${local.project_name}-processor-lambda-errors"
  alarm_description = "Alarm when the Processor Lambda reports errors."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    FunctionName = module.processor_lambda.function_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "upload_queue_depth" {
  alarm_name        = "${local.project_name}-upload-queue-depth"
  alarm_description = "Alarm when the upload queue begins backing up."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    QueueName = module.upload_queue.queue_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "processing_queue_depth" {
  alarm_name        = "${local.project_name}-processing-queue-depth"
  alarm_description = "Alarm when the processing queue begins backing up."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    QueueName = module.processing_queue.queue_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "upload_dlq_messages" {
  alarm_name        = "${local.project_name}-upload-dlq-messages"
  alarm_description = "Alarm when messages reach the Upload DLQ."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    QueueName = module.upload_queue.dlq_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "processing_dlq_messages" {
  alarm_name        = "${local.project_name}-processing-dlq-messages"
  alarm_description = "Alarm when messages reach the Processing DLQ."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    QueueName = module.processing_queue.dlq_name
  }

  alarm_actions = [
    module.notifications_topic.topic_arn
  ]

  ok_actions = [
    module.notifications_topic.topic_arn
  ]

  tags = local.tags
}

###############################################################################
# Scheduled Tasks
###############################################################################

resource "aws_iam_role" "maintenance_lambda_role" {
  name = "${local.project_name}-maintenance-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Principal = {
          Service = "lambda.amazonaws.com"
        }

        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "maintenance_lambda_policy" {

  name        = "${local.project_name}-maintenance-lambda-policy"
  description = "IAM policy for scheduled maintenance operations."

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"

        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]

        Resource = "arn:aws:logs:*:*:*"
      },

      {
        Sid = "CloudWatchExport"

        Effect = "Allow"

        Action = [
          "logs:CreateExportTask",
          "logs:DescribeExportTasks",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]

        Resource = "*"
      },

      {
        Sid = "LogArchive"

        Effect = "Allow"

        Action = [
          "s3:PutObject",
          "s3:GetBucketLocation"
        ]

        Resource = [
          module.log_archive_bucket.bucket_arn,
          "${module.log_archive_bucket.bucket_arn}/*"
        ]
      },

      {
        Sid = "Cognito"

        Effect = "Allow"

        Action = [
          "cognito-idp:ListUsersInGroup"
        ]

        Resource = module.cognito.user_pool_arn
      },

      {
        Sid = "SNS"

        Effect = "Allow"

        Action = [
          "sns:ListSubscriptionsByTopic",
          "sns:Unsubscribe"
        ]

        Resource = module.notifications_topic.topic_arn
      }

    ]
  })
}

resource "aws_iam_role_policy_attachment" "maintenance_lambda_policy_attachment" {

  role = aws_iam_role.maintenance_lambda_role.name

  policy_arn = aws_iam_policy.maintenance_lambda_policy.arn

}

module "maintenance_lambda" {
  source = "./modules/lambda"

  function_name = "${local.project_name}-maintenance"

  source_zip = "../lambda/maintenance/lambda.zip"

  role_arn = aws_iam_role.maintenance_lambda_role.arn

  timeout = 300

  memory_size = 512

  environment_variables = {

    LOG_ARCHIVE_BUCKET = module.log_archive_bucket.bucket_name

    USER_POOL_ID = module.cognito.user_pool_id

    ADMIN_GROUP = "admins"

    SNS_TOPIC_ARN = module.notifications_topic.topic_arn

    LOG_GROUP = "/aws/lambda/${local.project_name}-api"

  }

  tags = local.tags
}

resource "aws_iam_role" "scheduler_role" {

  name = "${local.project_name}-scheduler-role"

  assume_role_policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {

        Effect = "Allow"

        Principal = {
          Service = "scheduler.amazonaws.com"
        }

        Action = "sts:AssumeRole"

      }

    ]

  })

}

resource "aws_iam_policy" "scheduler_policy" {

  name = "${local.project_name}-scheduler-policy"

  policy = jsonencode({

    Version = "2012-10-17"

    Statement = [

      {

        Effect = "Allow"

        Action = [
          "lambda:InvokeFunction"
        ]

        Resource = module.maintenance_lambda.function_arn

      }

    ]

  })

}

resource "aws_iam_role_policy_attachment" "scheduler_policy_attachment" {

  role = aws_iam_role.scheduler_role.name

  policy_arn = aws_iam_policy.scheduler_policy.arn

}

resource "aws_scheduler_schedule" "daily_maintenance" {

  name = "${local.project_name}-daily-maintenance"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "cron(0 2 * * ? *)"

  target {

    arn = module.maintenance_lambda.function_arn

    role_arn = aws_iam_role.scheduler_role.arn

  }

}

resource "aws_lambda_permission" "allow_scheduler" {

  statement_id = "AllowEventBridgeScheduler"

  action = "lambda:InvokeFunction"

  function_name = module.maintenance_lambda.function_name

  principal = "scheduler.amazonaws.com"

  source_arn = aws_scheduler_schedule.daily_maintenance.arn

}

###############################################################################
# Deployment
###############################################################################

locals {

  config_js = templatefile("${path.module}/../website/config.js.tpl", {

    api_endpoint = module.api_gateway.api_endpoint

    aws_region = var.aws_region

    user_pool_id = module.cognito.user_pool_id

    user_pool_client_id = module.cognito.client_id

  })

}

locals {

  website_files = fileset("${path.module}/../website", "**")

}

resource "aws_s3_object" "website" {

  for_each = {
    for file in local.website_files :
    file => file
    if file != "config.js.tpl"
  }

  bucket = module.website_bucket.bucket_id

  key = each.key

  source = "${path.module}/../website/${each.value}"

  etag = filemd5("${path.module}/../website/${each.value}")

  content_type = lookup(
    {
      html = "text/html"
      css  = "text/css"
      js   = "application/javascript"
      png  = "image/png"
      jpg  = "image/jpeg"
      jpeg = "image/jpeg"
      svg  = "image/svg+xml"
      ico  = "image/x-icon"
    },
    split(".", each.value)[length(split(".", each.value)) - 1],
    "application/octet-stream"
  )

}

resource "aws_s3_object" "config" {

  bucket = module.website_bucket.bucket_id

  key = "config.js"

  content = local.config_js

  content_type = "application/javascript"

}