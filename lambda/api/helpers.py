import json
import uuid
from datetime import datetime, timezone
import time
from pathlib import Path
from decimal import Decimal

SUPPORTED_FILE_TYPES = {
    ".pdf": {
        "application/pdf",
    },
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    ".txt": {
        "text/plain",
    },
    ".md": {
        "text/markdown",
        "text/plain",
        "text/x-markdown",
    },
}


def json_serializer(obj):
    """
    Convert DynamoDB Decimal objects into JSON serializable values.
    """
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)

    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def success(data=None, status_code=200):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(
            {"success": True, "data": {} if data is None else data},
            default=json_serializer,
        ),
    }


def error(message, status_code=400, code=None):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(
            {"success": False, "error": {"message": message, "code": code}}
        ),
    }


def generate_document_id():
    return str(uuid.uuid4())


def generate_upload_id():
    return str(uuid.uuid4())


def generate_restore_id():
    return str(uuid.uuid4())


def get_current_timestamp():
    return datetime.now(timezone.utc).isoformat()


def get_expiry_timestamp(hours=1):
    return int(time.time()) + (hours * 60 * 60)


def get_user(event):

    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims")
    )

    if not claims:
        raise PermissionError("Authentication required.")

    groups = claims.get("cognito:groups", [])

    if isinstance(groups, str):
        groups = groups.strip()

        if groups.startswith("[") and groups.endswith("]"):
            groups = groups[1:-1]

        groups = [
            group.strip().strip('"').strip("'")
            for group in groups.split(",")
            if group.strip()
        ]

    return {
        "userId": claims["sub"],
        "email": claims.get("email"),
        "isAdmin": "admins" in groups,
    }


def generate_upload_url(
    s3_client, bucket_name, owner_id, document_id, upload_id, filename, content_type
):
    key = f"uploads/{owner_id}/{document_id}/{upload_id}/{filename}"

    upload_url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": bucket_name, "Key": key, "ContentType": content_type},
        ExpiresIn=900,
    )

    return {"uploadUrl": upload_url, "key": key, "expiresIn": 900}


def get_document_permission(table, document_id, user):

    response = table.get_item(
        Key={
            "PK": f"DOC#{document_id}",
            "SK": "DOCUMENT",
        }
    )

    document = response.get("Item")

    if not document:
        return {
            "exists": False,
        }

    if document["ownerId"] == user["userId"]:
        return {
            "exists": True,
            "authorized": True,
            "role": "OWNER",
            "document": document,
        }

    if user["isAdmin"]:
        return {
            "exists": True,
            "authorized": True,
            "role": "ADMIN",
            "document": document,
        }

    response = table.get_item(
        Key={
            "PK": f"DOC#{document_id}",
            "SK": f"SHARE#{user['userId']}",
        }
    )

    share = response.get("Item")

    if not share:
        return {
            "exists": True,
            "authorized": False,
        }

    return {
        "exists": True,
        "authorized": True,
        "role": share["role"],
        "document": document,
        "share": share,
    }


def ensure_admin_subscription(
    user,
    cognito,
    sns,
    user_pool_id,
    topic_arn,
):
    """
    Ensure the administrator is subscribed to the SNS topic.

    Returns:
        True  -> Subscription already exists.
        False -> Subscription request was created.
    """

    response = cognito.admin_get_user(
        UserPoolId=user_pool_id,
        Username=user["userId"],
    )

    email = next(
        (
            attribute["Value"]
            for attribute in response["UserAttributes"]
            if attribute["Name"] == "email"
        ),
        None,
    )

    if not email:
        raise ValueError("Admin user does not have an email address.")

    paginator = sns.get_paginator("list_subscriptions_by_topic")

    for page in paginator.paginate(
        TopicArn=topic_arn,
    ):
        for subscription in page["Subscriptions"]:

            if (
                subscription["Protocol"] == "email"
                and subscription["Endpoint"].lower() == email.lower()
            ):
                return True

    sns.subscribe(
        TopicArn=topic_arn,
        Protocol="email",
        Endpoint=email,
    )

    return False


def validate_file_type(
    filename,
    content_type,
):
    """
    Validate the uploaded document's file extension and MIME type.
    """

    extension = Path(filename).suffix.lower()

    allowed_content_types = SUPPORTED_FILE_TYPES.get(extension)

    if allowed_content_types is None:

        raise ValueError(f"Unsupported file type: {extension}")

    if content_type not in allowed_content_types:

        raise ValueError(
            f"Invalid content type '{content_type}' for '{extension}' files."
        )
