from datetime import UTC, datetime, timedelta


def export_cloudwatch_logs(
    logs_client,
    bucket_name,
    log_group,
):
    """
    Export the previous day's CloudWatch logs for the provided log groups.
    """

    previous_day = datetime.now(UTC).date() - timedelta(days=1)

    start = datetime.combine(
        previous_day,
        datetime.min.time(),
        tzinfo=UTC,
    )

    end = datetime.combine(
        previous_day + timedelta(days=1),
        datetime.min.time(),
        tzinfo=UTC,
    )

    export_task_ids = []

    response = logs_client.create_export_task(
        logGroupName=log_group,
        fromTime=int(start.timestamp() * 1000),
        to=int(end.timestamp() * 1000),
        destination=bucket_name,
        destinationPrefix=(
            f"logs/"
            f"{previous_day:%Y}/"
            f"{previous_day:%m}/"
            f"{previous_day:%d}/"
            f"{log_group.removeprefix('/aws/lambda/')}"
        ),
    )

    return response["taskId"]


def get_admin_emails(
    cognito_client,
    user_pool_id,
    admin_group,
):
    """
    Retrieve the email addresses of all administrators.
    """

    paginator = cognito_client.get_paginator("list_users_in_group")

    admin_emails = set()

    for page in paginator.paginate(
        UserPoolId=user_pool_id,
        GroupName=admin_group,
    ):

        for user in page["Users"]:

            for attribute in user["Attributes"]:

                if attribute["Name"] != "email":
                    continue

                admin_emails.add(attribute["Value"].lower())

                break

    return admin_emails


def cleanup_sns_subscriptions(
    sns_client,
    topic_arn,
    admin_emails,
):
    """
    Remove SNS email subscriptions that no longer belong to administrators.
    """

    paginator = sns_client.get_paginator("list_subscriptions_by_topic")

    removed_subscriptions = 0

    for page in paginator.paginate(
        TopicArn=topic_arn,
    ):

        for subscription in page["Subscriptions"]:

            if subscription["Protocol"] != "email":
                continue

            if subscription["SubscriptionArn"] == "PendingConfirmation":
                continue

            endpoint = subscription["Endpoint"].strip().lower()

            if endpoint in admin_emails:
                continue

            sns_client.unsubscribe(SubscriptionArn=subscription["SubscriptionArn"])

            removed_subscriptions += 1

    return removed_subscriptions
