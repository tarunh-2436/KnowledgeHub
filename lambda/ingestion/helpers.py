import json

from botocore.exceptions import ClientError
from boto3.dynamodb.types import TypeSerializer

serializer = TypeSerializer()


def build_permanent_s3_key(
    document_id,
    version_number,
    filename,
):
    """
    Build the permanent storage key for a document version.
    """

    return f"documents/" f"{document_id}/" f"v{version_number:06d}/" f"{filename}"


def move_s3_object(
    s3,
    bucket_name,
    source_key,
    destination_key,
):
    """
    Move an object within the same bucket.
    Implemented as CopyObject followed by DeleteObject.
    """

    s3.copy_object(
        Bucket=bucket_name,
        CopySource={
            "Bucket": bucket_name,
            "Key": source_key,
        },
        Key=destination_key,
    )

    s3.delete_object(
        Bucket=bucket_name,
        Key=source_key,
    )


def copy_s3_object(
    s3,
    bucket_name,
    source_key,
    destination_key,
):
    """
    Copy an object within the same bucket.
    Used during version restoration.
    """

    s3.copy_object(
        Bucket=bucket_name,
        CopySource={
            "Bucket": bucket_name,
            "Key": source_key,
        },
        Key=destination_key,
    )


def delete_s3_object(
    s3,
    bucket_name,
    object_key,
):
    """
    Delete an object from S3.
    Used during cleanup of failed ingestion operations.
    """

    s3.delete_object(
        Bucket=bucket_name,
        Key=object_key,
    )


def transact_write_items(
    dynamodb_client,
    table_name,
    items,
):
    """
    Atomically write multiple DynamoDB items.
    """

    transact_items = []

    for item in items:

        transact_items.append(
            {
                "Put": {
                    "TableName": table_name,
                    "Item": {
                        key: serializer.serialize(value) for key, value in item.items()
                    },
                }
            }
        )

    dynamodb_client.transact_write_items(
        TransactItems=transact_items,
    )


def transact_create_version(
    dynamodb_client,
    table_name,
    document_id,
    current_version,
    next_version,
    updated_at,
    version_item,
):
    """
    Atomically:

    - Verify current version
    - Update DOCUMENT
    - Create VERSION
    """

    dynamodb_client.transact_write_items(
        TransactItems=[
            {
                "ConditionCheck": {
                    "TableName": table_name,
                    "Key": {
                        "PK": serializer.serialize(f"DOC#{document_id}"),
                        "SK": serializer.serialize("DOCUMENT"),
                    },
                    "ConditionExpression": "currentVersion = :expected",
                    "ExpressionAttributeValues": {
                        ":expected": serializer.serialize(current_version),
                    },
                }
            },
            {
                "Update": {
                    "TableName": table_name,
                    "Key": {
                        "PK": serializer.serialize(f"DOC#{document_id}"),
                        "SK": serializer.serialize("DOCUMENT"),
                    },
                    "UpdateExpression": (
                        "SET currentVersion = :next, "
                        "processingStatus = :status, "
                        "updatedAt = :updatedAt"
                    ),
                    "ExpressionAttributeValues": {
                        ":next": serializer.serialize(next_version),
                        ":status": serializer.serialize("PROCESSING"),
                        ":updatedAt": serializer.serialize(updated_at),
                    },
                }
            },
            {
                "Put": {
                    "TableName": table_name,
                    "Item": {
                        key: serializer.serialize(value)
                        for key, value in version_item.items()
                    },
                }
            },
        ]
    )


def send_processor_message(
    sqs,
    queue_url,
    message,
):
    """
    Queue a document version for asynchronous AI processing.
    """

    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(message),
    )
