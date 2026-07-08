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

    - Verify the current document version has not changed
    - Update the DOCUMENT item
    - Create the new VERSION item

    Uses optimistic locking by placing the ConditionExpression on the
    Update operation instead of a separate ConditionCheck, since DynamoDB
    transactions cannot perform multiple operations on the same item.
    """

    dynamodb_client.transact_write_items(
        TransactItems=[
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
                    "ConditionExpression": "currentVersion = :expected",
                    "ExpressionAttributeValues": {
                        ":expected": serializer.serialize(current_version),
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
                    "ConditionExpression": (
                        "attribute_not_exists(PK) " "AND attribute_not_exists(SK)"
                    ),
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
