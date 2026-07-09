import json
import logging
import os

import boto3

from helpers import (
    cleanup_sns_subscriptions,
    export_cloudwatch_logs,
    get_admin_emails,
)

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)


LOG_ARCHIVE_BUCKET = os.environ["LOG_ARCHIVE_BUCKET"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
ADMIN_GROUP = os.environ["ADMIN_GROUP"]
SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
LOG_GROUP = os.environ["LOG_GROUP"]


logs_client = boto3.client("logs")
sns_client = boto3.client("sns")
cognito_client = boto3.client("cognito-idp")


def lambda_handler(event, context):
    """
    Perform scheduled maintenance tasks.

    Responsibilities
    ----------------
    1. Export the previous day's CloudWatch Logs to S3.
    2. Remove SNS subscriptions that no longer belong to administrators.
    """

    try:

        LOGGER.info("Starting scheduled maintenance.")

        export_task_id = export_cloudwatch_logs(
            logs_client=logs_client,
            bucket_name=LOG_ARCHIVE_BUCKET,
            log_group=LOG_GROUP,
        )

        LOGGER.info(
            "Started API Logs CloudWatch export task.",
        )

        admin_emails = get_admin_emails(
            cognito_client=cognito_client,
            user_pool_id=USER_POOL_ID,
            admin_group=ADMIN_GROUP,
        )

        LOGGER.info(
            "Retrieved %d administrator email(s).",
            len(admin_emails),
        )

        removed_subscriptions = cleanup_sns_subscriptions(
            sns_client=sns_client,
            topic_arn=SNS_TOPIC_ARN,
            admin_emails=admin_emails,
        )

        LOGGER.info(
            "Removed %d obsolete SNS subscription(s).",
            removed_subscriptions,
        )

        LOGGER.info("Scheduled maintenance completed successfully.")

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "success": True,
                    "message": "Scheduled maintenance completed successfully.",
                    "cloudwatchExportTask": export_task_id,
                    "subscriptionsRemoved": removed_subscriptions,
                }
            ),
        }

    except Exception:

        LOGGER.exception("Scheduled maintenance failed.")

        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "success": False,
                    "message": "Scheduled maintenance failed.",
                }
            ),
        }
