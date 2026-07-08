import json
import logging
import os
import boto3

from helpers import (
    build_permanent_s3_key,
    copy_s3_object,
    delete_s3_object,
    transact_write_items,
    transact_create_version,
    send_processor_message,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["TABLE_NAME"]
STORAGE_BUCKET = os.environ["STORAGE_BUCKET"]
PROCESSING_QUEUE_URL = os.environ["PROCESSING_QUEUE_URL"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

dynamodb_client = boto3.client("dynamodb")
s3 = boto3.client("s3")
sqs = boto3.client("sqs")


def lambda_handler(event, context):

    logger.info(
        "Received %d ingestion request(s).",
        len(event["Records"]),
    )

    for record in event["Records"]:

        try:

            body = json.loads(record["body"])

            document_id = body["documentId"]

            if "uploadId" in body:

                response = table.get_item(
                    Key={
                        "PK": f"PENDING#{document_id}",
                        "SK": f"UPLOAD#{body['uploadId']}",
                    }
                )

            elif "restoreId" in body:

                response = table.get_item(
                    Key={
                        "PK": f"PENDING#{document_id}",
                        "SK": f"RESTORE#{body['restoreId']}",
                    }
                )

            else:

                logger.error(
                    "Invalid ingestion message: %s",
                    body,
                )

                raise ValueError(f"Invalid ingestion message: {body}")

            pending = response.get("Item")

            if pending is None:

                logger.info(
                    "Pending record already processed. documentId=%s",
                    document_id,
                )

                continue

            entity_type = pending["entityType"]

            logger.info(
                "Processing %s for documentId=%s",
                entity_type,
                document_id,
            )

            if entity_type == "PENDING_DOCUMENT_UPLOAD":

                process_new_document(pending)

            elif entity_type == "PENDING_VERSION_UPLOAD":

                process_new_version(pending)

            elif entity_type == "PENDING_VERSION_RESTORE":

                process_restore(pending)

            else:

                logger.error(
                    "Unknown pending entity type: %s",
                    entity_type,
                )

        except Exception:

            logger.exception(
                "Failed processing ingestion message: %s",
                record,
            )

            raise

    return {
        "statusCode": 200,
    }


def process_new_document(pending):

    document_id = pending["documentId"]
    owner_id = pending["ownerId"]
    uploaded_by = pending["uploadedBy"]

    version_number = 1

    permanent_s3_key = build_permanent_s3_key(
        document_id=document_id,
        version_number=version_number,
        filename=pending["filename"],
    )

    document_item = {
        "PK": f"DOC#{document_id}",
        "SK": "DOCUMENT",
        "entityType": "DOCUMENT",
        "documentId": document_id,
        "ownerId": owner_id,
        "title": pending["title"],
        "tags": pending["tags"],
        "currentVersion": version_number,
        "processingStatus": "PROCESSING",
        "createdAt": pending["createdAt"],
        "updatedAt": pending["createdAt"],
        "OwnerGSI": f"OWNER#{owner_id}",
        "AdminGSI": "DOCUMENT",
        "ProcessingGSI": "PROCESSING",
    }

    version_item = {
        "PK": f"DOC#{document_id}",
        "SK": f"VERSION#{int(version_number):06d}",
        "entityType": "VERSION",
        "versionNumber": version_number,
        "ownerId": owner_id,
        "uploadedBy": uploaded_by,
        "filename": pending["filename"],
        "contentType": pending["contentType"],
        "fileSize": pending["fileSize"],
        "etag": pending["etag"],
        "s3Key": permanent_s3_key,
        "versionNotes": pending["versionNotes"],
        "processingStatus": "PROCESSING",
        "createdAt": pending["createdAt"],
        "updatedAt": pending["createdAt"],
    }

    transaction_completed = False

    try:

        logger.info(
            "Moving uploaded document to permanent storage. documentId=%s",
            document_id,
        )

        original_key = pending["temporaryS3Key"]

        copy_s3_object(
            s3=s3,
            bucket_name=STORAGE_BUCKET,
            source_key=original_key,
            destination_key=permanent_s3_key,
        )

        logger.info(
            "Creating document metadata. documentId=%s",
            document_id,
        )

        transact_write_items(
            dynamodb_client=dynamodb_client,
            table_name=TABLE_NAME,
            items=[
                document_item,
                version_item,
            ],
        )

        transaction_completed = True

        send_processor_message(
            sqs=sqs,
            queue_url=PROCESSING_QUEUE_URL,
            message={
                "documentId": document_id,
                "versionNumber": version_number,
            },
        )

        logger.info(
            "Queued document for AI processing. documentId=%s version=%s",
            document_id,
            version_number,
        )

        table.delete_item(
            Key={
                "PK": pending["PK"],
                "SK": pending["SK"],
            },
            ConditionExpression="attribute_exists(PK) AND attribute_exists(SK)",
        )

        s3.delete_object(
            Bucket=STORAGE_BUCKET,
            Key=original_key,
        )

        logger.info(
            "Pending upload removed. documentId=%s",
            document_id,
        )

    except Exception:

        logger.exception(
            "Document ingestion failed. transactionCompleted=%s documentId=%s",
            transaction_completed,
            document_id,
        )

        if not transaction_completed:

            try:

                delete_s3_object(
                    s3=s3,
                    bucket_name=STORAGE_BUCKET,
                    object_key=permanent_s3_key,
                )

            except Exception:

                logger.exception(
                    "Rollback failed. Permanent object could not be deleted. documentId=%s",
                    document_id,
                )

        raise


def process_new_version(pending):

    document_id = pending["documentId"]

    response = table.get_item(
        Key={
            "PK": f"DOC#{document_id}",
            "SK": "DOCUMENT",
        }
    )

    document = response.get("Item")

    if document is None:
        raise Exception(f"Document {document_id} not found.")

    current_version = int(document["currentVersion"])
    next_version = current_version + 1

    permanent_s3_key = build_permanent_s3_key(
        document_id=document_id,
        version_number=next_version,
        filename=pending["filename"],
    )

    version_item = {
        "PK": f"DOC#{document_id}",
        "SK": f"VERSION#{int(next_version):06d}",
        "entityType": "VERSION",
        "versionNumber": int(next_version),
        "ownerId": pending["ownerId"],
        "uploadedBy": pending["uploadedBy"],
        "filename": pending["filename"],
        "contentType": pending["contentType"],
        "fileSize": pending["fileSize"],
        "etag": pending["etag"],
        "s3Key": permanent_s3_key,
        "versionNotes": pending["versionNotes"],
        "processingStatus": "PROCESSING",
        "createdAt": pending["createdAt"],
        "updatedAt": pending["updatedAt"],
    }

    transaction_completed = False

    try:

        logger.info(
            "Moving uploaded version to permanent storage. documentId=%s version=%s",
            document_id,
            next_version,
        )

        original_key = pending["temporaryS3Key"]

        copy_s3_object(
            s3=s3,
            bucket_name=STORAGE_BUCKET,
            source_key=original_key,
            destination_key=permanent_s3_key,
        )

        transact_create_version(
            dynamodb_client=dynamodb_client,
            table_name=TABLE_NAME,
            document_id=document_id,
            current_version=current_version,
            next_version=next_version,
            updated_at=pending["updatedAt"],
            version_item=version_item,
        )

        transaction_completed = True

        send_processor_message(
            sqs=sqs,
            queue_url=PROCESSING_QUEUE_URL,
            message={
                "documentId": document_id,
                "versionNumber": next_version,
            },
        )

        logger.info(
            "Queued version for AI processing. documentId=%s version=%s",
            document_id,
            next_version,
        )

        s3.delete_object(
            Bucket=STORAGE_BUCKET,
            Key=original_key,
        )

        table.delete_item(
            Key={
                "PK": pending["PK"],
                "SK": pending["SK"],
            },
            ConditionExpression="attribute_exists(PK) AND attribute_exists(SK)",
        )

        logger.info(
            "Pending version upload removed. documentId=%s version=%s",
            document_id,
            next_version,
        )

    except Exception:

        logger.exception(
            "Document ingestion failed. transactionCompleted=%s documentId=%s",
            transaction_completed,
            document_id,
        )

        if not transaction_completed:
            try:

                delete_s3_object(
                    s3=s3,
                    bucket_name=STORAGE_BUCKET,
                    object_key=permanent_s3_key,
                )

            except Exception:

                logger.exception(
                    "Failed rolling back permanent object. documentId=%s",
                    document_id,
                )

        raise


def process_restore(pending):

    document_id = pending["documentId"]

    document = table.get_item(
        Key={
            "PK": f"DOC#{document_id}",
            "SK": "DOCUMENT",
        }
    ).get("Item")

    if document is None:
        raise Exception(f"Document {document_id} not found.")

    source_version = table.get_item(
        Key={
            "PK": f"DOC#{document_id}",
            "SK": f"VERSION#{int(pending['sourceVersion']):06d}",
        }
    ).get("Item")

    if source_version is None:
        raise Exception(f"Source version {pending['sourceVersion']} not found.")

    current_version = int(document["currentVersion"])
    next_version = current_version + 1

    permanent_s3_key = build_permanent_s3_key(
        document_id=document_id,
        version_number=next_version,
        filename=source_version["filename"],
    )

    restored_version = source_version.copy()

    restored_version["SK"] = f"VERSION#{int(next_version):06d}"
    restored_version["versionNumber"] = int(next_version)
    restored_version["s3Key"] = permanent_s3_key
    restored_version["uploadedBy"] = pending["restoredBy"]
    restored_version["createdAt"] = pending["createdAt"]
    restored_version["updatedAt"] = pending["updatedAt"]
    restored_version["restoredFrom"] = source_version["versionNumber"]

    transaction_completed = False

    try:

        copy_s3_object(
            s3=s3,
            bucket_name=STORAGE_BUCKET,
            source_key=source_version["s3Key"],
            destination_key=permanent_s3_key,
        )

        transact_create_version(
            dynamodb_client=dynamodb_client,
            table_name=TABLE_NAME,
            document_id=document_id,
            current_version=current_version,
            next_version=next_version,
            updated_at=pending["updatedAt"],
            version_item=restored_version,
        )

        transaction_completed = True

        table.delete_item(
            Key={
                "PK": pending["PK"],
                "SK": pending["SK"],
            },
            ConditionExpression="attribute_exists(PK) AND attribute_exists(SK)",
        )

        logger.info(
            "Version restored successfully. documentId=%s restoredVersion=%s newVersion=%s",
            document_id,
            pending["sourceVersion"],
            next_version,
        )

    except Exception:

        logger.exception(
            "Document ingestion failed. transactionCompleted=%s documentId=%s",
            transaction_completed,
            document_id,
        )

        if not transaction_completed:

            try:

                delete_s3_object(
                    s3=s3,
                    bucket_name=STORAGE_BUCKET,
                    object_key=permanent_s3_key,
                )

            except Exception:

                logger.exception(
                    "Failed rolling back restored object. documentId=%s",
                    document_id,
                )

        raise
