import json
import logging
import os
from pathlib import Path

import boto3

from helpers import (
    extract_pdf_text,
    extract_docx_text,
    extract_plain_text,
    normalize_text,
    generate_summary,
    generate_keywords,
    get_current_timestamp,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["TABLE_NAME"]
DOCUMENT_BUCKET = os.environ["DOCUMENT_BUCKET"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

s3 = boto3.client("s3")


def lambda_handler(event, context):

    logger.info(
        "Received %d processor request(s).",
        len(event["Records"]),
    )

    for record in event["Records"]:

        try:

            body = json.loads(record["body"])

            process_document(
                document_id=body["documentId"],
                version_number=int(body["versionNumber"]),
            )

        except Exception:

            logger.exception(
                "Failed processing processor message: %s",
                record,
            )

            raise

    return {
        "statusCode": 200,
    }


def process_document(
    document_id,
    version_number,
):

    try:

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"VERSION#{version_number:06d}",
            }
        )

        version = response.get("Item")

        if version is None:
            raise Exception(
                f"Document version not found. documentId={document_id} version={version_number}"
            )

        logger.info(
            "Processing document. documentId=%s version=%s",
            document_id,
            version_number,
        )

        response = s3.get_object(
            Bucket=DOCUMENT_BUCKET,
            Key=version["s3Key"],
        )

        file_bytes = response["Body"].read()

        extension = Path(version["filename"]).suffix.lower()

        if extension == ".pdf":

            text = extract_pdf_text(file_bytes)

        elif extension == ".docx":

            text = extract_docx_text(file_bytes)

        elif extension in [
            ".txt",
            ".md",
        ]:

            text = extract_plain_text(file_bytes)

        else:

            raise ValueError(f"Unsupported file type: {extension}")

        text = normalize_text(text)

        if not text:

            raise Exception("No extractable text found.")

        summary = generate_summary(text)

        keywords = generate_keywords(text)

        timestamp = get_current_timestamp()

        logger.info(
            "Updating processed metadata. documentId=%s version=%s",
            document_id,
            version_number,
        )

        table.update_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"VERSION#{version_number:06d}",
            },
            UpdateExpression="""
                SET
                    processingStatus = :status,
                    summary = :summary,
                    keywords = :keywords,
                    processedAt = :processedAt,
                    updatedAt = :updatedAt
                REMOVE processingError
            """,
            ExpressionAttributeValues={
                ":status": "READY",
                ":summary": summary,
                ":keywords": keywords,
                ":processedAt": timestamp,
                ":updatedAt": timestamp,
            },
        )

        table.update_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": "DOCUMENT",
            },
            UpdateExpression="""
                SET
                    processingStatus = :status,
                    updatedAt = :updatedAt
                REMOVE processingError
            """,
            ExpressionAttributeValues={
                ":status": "READY",
                ":updatedAt": timestamp,
            },
        )

        logger.info(
            "Document processed successfully. documentId=%s version=%s",
            document_id,
            version_number,
        )

    except Exception as error:

        logger.exception(
            "Document processing failed. documentId=%s version=%s",
            document_id,
            version_number,
        )

        timestamp = get_current_timestamp()

        try:

            table.update_item(
                Key={
                    "PK": f"DOC#{document_id}",
                    "SK": f"VERSION#{version_number:06d}",
                },
                UpdateExpression="""
                    SET
                        processingStatus = :status,
                        processingError = :error,
                        updatedAt = :updatedAt
                """,
                ExpressionAttributeValues={
                    ":status": "FAILED",
                    ":error": str(error),
                    ":updatedAt": timestamp,
                },
            )

            table.update_item(
                Key={
                    "PK": f"DOC#{document_id}",
                    "SK": "DOCUMENT",
                },
                UpdateExpression="""
                    SET
                        processingStatus = :status,
                        processingError = :error,
                        updatedAt = :updatedAt
                """,
                ExpressionAttributeValues={
                    ":status": "FAILED",
                    ":error": str(error),
                    ":updatedAt": timestamp,
                },
            )

        except Exception:

            logger.exception(
                "Failed updating processing status. documentId=%s version=%s",
                document_id,
                version_number,
            )

        raise
