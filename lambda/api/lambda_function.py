import json
import os
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from helpers import (
    success,
    error,
    generate_document_id,
    generate_upload_id,
    generate_restore_id,
    get_user,
    generate_upload_url,
    get_current_timestamp,
    get_expiry_timestamp,
    get_document_permission,
    ensure_admin_subscription,
    validate_file_type,
)

import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


TABLE_NAME = os.environ["TABLE_NAME"]
BUCKET_NAME = os.environ["STORAGE_BUCKET"]
UPLOAD_QUEUE_URL = os.environ["UPLOAD_QUEUE_URL"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
s3 = boto3.client("s3")
sqs = boto3.client("sqs")
sns = boto3.client("sns")
cognito = boto3.client("cognito-idp")


def lambda_handler(event, context):

    method = event["requestContext"]["http"]["method"]
    path = event["requestContext"]["http"]["path"]

    if method == "GET" and path == "/documents":
        return get_documents(event)

    elif method == "GET" and path == "/documents/shared":
        return get_shared_documents(event)

    elif (
        method == "GET"
        and path.startswith("/documents/")
        and path.endswith("/versions")
    ):
        return get_document_versions(event)

    elif method == "GET" and path.startswith("/documents/") and "/versions/" in path:
        return get_document_version(event)

    elif (
        method == "POST"
        and path.startswith("/documents/")
        and path.endswith("/versions/init")
    ):
        return version_init(event)

    elif (
        method == "POST"
        and path.startswith("/documents/")
        and path.endswith("/versions/complete")
    ):
        return version_complete(event)

    elif (
        method == "POST"
        and path.startswith("/documents/")
        and "/versions/" in path
        and path.endswith("/restore")
    ):
        return restore_document_version(event)

    elif (
        method == "POST" and path.startswith("/documents/") and path.endswith("/shares")
    ):
        return share_document(event)

    elif (
        method == "GET" and path.startswith("/documents/") and path.endswith("/shares")
    ):
        return get_document_shares(event)

    elif method == "DELETE" and path.startswith("/documents/") and "/shares/" in path:
        return delete_document_share(event)

    elif method == "POST" and path == "/documents/init":
        return document_init(event)

    elif method == "POST" and path == "/documents/complete":
        return document_complete(event)

    elif method == "GET" and path.startswith("/documents/"):
        return get_document(event)

    elif method == "PATCH" and path.startswith("/documents/"):
        return update_document(event)

    elif method == "DELETE" and path.startswith("/documents/"):
        return delete_document(event)

    elif method == "GET" and path == "/admin/statistics":
        return get_admin_statistics(event)

    elif method == "GET" and path == "/admin/documents":
        return get_admin_documents(event)

    elif method == "GET" and path == "/admin/processing":
        return get_admin_processing(event)

    return error("Route not found", 404)


def document_init(event):

    try:
        user = get_user(event)

        logger.info("Initializing document upload for user %s.", user["userId"])

        body = json.loads(event.get("body") or "{}")

        filename = body.get("filename")
        content_type = body.get("contentType")

        if not filename:
            logger.warning(
                "Upload initialization failed: filename missing. user=%s",
                user["userId"],
            )
            return error("Filename is required.")

        if not content_type:
            logger.warning(
                "Upload initialization failed: content type missing. user=%s",
                user["userId"],
            )
            return error("Content type is required.")

        document_id = generate_document_id()
        upload_id = generate_upload_id()

        upload = generate_upload_url(
            s3_client=s3,
            bucket_name=BUCKET_NAME,
            owner_id=user["userId"],
            document_id=document_id,
            upload_id=upload_id,
            filename=filename,
            content_type=content_type,
        )

        logger.info(
            "Upload session created. documentId=%s uploadId=%s user=%s",
            document_id,
            upload_id,
            user["userId"],
        )

        return success(
            {
                "documentId": document_id,
                "uploadId": upload_id,
                "uploadUrl": upload["uploadUrl"],
                "expiresIn": upload["expiresIn"],
            },
            status_code=201,
        )

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to initialize document upload.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def document_complete(event):

    try:
        user = get_user(event)

        logger.info("Completing document upload for user %s.", user["userId"])

        body = json.loads(event.get("body") or "{}")

        document_id = body.get("documentId")
        upload_id = body.get("uploadId")
        filename = body.get("filename")
        title = body.get("title")
        tags = body.get("tags", [])
        if not isinstance(tags, list):
            return error("Tags must be an array.")
        version_notes = body.get("versionNotes", "")

        required_fields = {
            "documentId": document_id,
            "uploadId": upload_id,
            "filename": filename,
            "title": title,
        }

        missing_fields = [
            field for field, value in required_fields.items() if not value
        ]

        if missing_fields:
            logger.warning(
                "Upload completion failed: missing fields %s. user=%s",
                ", ".join(missing_fields),
                user["userId"],
            )
            return error(f"Missing required fields: {', '.join(missing_fields)}")

        temporary_s3_key = (
            f"uploads/{user['userId']}/{document_id}/{upload_id}/{filename}"
        )

        response = s3.head_object(Bucket=BUCKET_NAME, Key=temporary_s3_key)

        logger.info(
            "Verified uploaded object. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        validate_file_type(
            filename=filename,
            content_type=response["ContentType"],
        )

        logger.info(
            "Validated uploaded file type. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        pending_upload = {
            "PK": f"PENDING#{document_id}",
            "SK": f"UPLOAD#{upload_id}",
            "entityType": "PENDING_DOCUMENT_UPLOAD",
            "ownerId": user["userId"],
            "uploadedBy": user["userId"],
            "documentId": document_id,
            "uploadId": upload_id,
            "title": title,
            "tags": tags,
            "versionNotes": version_notes,
            "filename": filename,
            "contentType": response["ContentType"],
            "fileSize": response["ContentLength"],
            "etag": response["ETag"],
            "temporaryS3Key": temporary_s3_key,
            "createdAt": get_current_timestamp(),
            "expiresAt": get_expiry_timestamp(hours=1),
        }

        table.put_item(
            Item=pending_upload,
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
        )

        logger.info(
            "Pending upload record created. documentId=%s",
            document_id,
        )

        sqs.send_message(
            QueueUrl=UPLOAD_QUEUE_URL,
            MessageBody=json.dumps({"documentId": document_id, "uploadId": upload_id}),
        )

        logger.info(
            "Queued ingestion request. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        return success({"message": "Upload completed successfully."})

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except ValueError as e:

        logger.warning(
            "Invalid uploaded file type. %s",
            str(e),
        )

        return error(
            str(e),
            status_code=400,
        )

    except ClientError as e:

        error_code = e.response["Error"]["Code"]

        if error_code == "404":
            logger.warning(
                "Uploaded object not found. documentId=%s uploadId=%s",
                document_id,
                upload_id,
            )

            return error(
                "Uploaded file not found.",
                status_code=400,
            )

        raise

    except Exception:
        logger.exception("Failed to complete document upload.")
        return error(
            "Internal server error.",
            status_code=500,
        )


def get_documents(event):

    try:
        user = get_user(event)

        logger.info(
            "Retrieving documents for user %s.",
            user["userId"],
        )

        response = table.query(
            IndexName="OwnerIndex",
            KeyConditionExpression=Key("OwnerGSI").eq(f"OWNER#{user['userId']}"),
            ScanIndexForward=False,
        )

        documents = response.get("Items", [])

        logger.info(
            "Retrieved %d documents for user %s.",
            len(documents),
            user["userId"],
        )

        return success(documents)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:
        logger.exception("Failed to retrieve user documents.")
        return error(
            "Internal server error.",
            status_code=500,
        )


def get_document(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Retrieving document %s for user %s.",
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission["authorized"]:
            logger.warning(
                "Unauthorized access to document. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        document = permission["document"]

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"VERSION#{int(document['currentVersion']):06d}",
            }
        )

        latest_version = response.get("Item")

        if not latest_version:

            logger.error(
                "Current version missing. documentId=%s currentVersion=%s",
                document_id,
                document["currentVersion"],
            )

            return error(
                "Current document version not found.",
                status_code=500,
            )

        download_url = s3.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": latest_version["s3Key"],
            },
            ExpiresIn=900,
        )

        document["downloadUrl"] = download_url

        logger.info(
            "Document retrieved successfully. documentId=%s",
            document_id,
        )

        return success(document)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve document.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def update_document(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Updating document %s for user %s.",
            document_id,
            user["userId"],
        )

        body = json.loads(event.get("body") or "{}")

        title = body.get("title")
        tags = body.get("tags")

        if title is None and tags is None:
            logger.warning(
                "No update fields provided. documentId=%s user=%s",
                document_id,
                user["userId"],
            )

            return error(
                "At least one field must be provided.",
                status_code=400,
            )

        if tags is not None and not isinstance(tags, list):
            logger.warning(
                "Invalid tags supplied. documentId=%s user=%s",
                document_id,
                user["userId"],
            )

            return error(
                "Tags must be an array.",
                status_code=400,
            )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission.get("role") == "OWNER":
            logger.warning(
                "Unauthorized document update. documentId=%s user=%s",
                document_id,
                user["userId"],
            )

            return error(
                "Access denied.",
                status_code=403,
            )

        update_expression = []
        expression_values = {}

        if title is not None:
            update_expression.append("title = :title")
            expression_values[":title"] = title

        if tags is not None:
            update_expression.append("tags = :tags")
            expression_values[":tags"] = tags

        update_expression.append("updatedAt = :updatedAt")
        expression_values[":updatedAt"] = get_current_timestamp()

        response = table.update_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": "DOCUMENT",
            },
            UpdateExpression="SET " + ", ".join(update_expression),
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW",
        )

        logger.info(
            "Document updated successfully. documentId=%s",
            document_id,
        )

        return success(response["Attributes"])

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to update document.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def delete_document(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Deleting document %s for user %s.",
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if permission.get("role") not in ["ADMIN", "OWNER"]:
            logger.warning(
                "Unauthorized document deletion. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"DOC#{document_id}")
        )

        items = response.get("Items", [])

        with table.batch_writer() as batch:

            for item in items:

                batch.delete_item(
                    Key={
                        "PK": item["PK"],
                        "SK": item["SK"],
                    }
                )

        logger.info(
            "Document deleted successfully. documentId=%s",
            document_id,
        )

        return success({"message": "Document deleted successfully."})

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to delete document.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def version_init(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Initializing version upload for document %s by user %s.",
            document_id,
            user["userId"],
        )

        body = json.loads(event.get("body") or "{}")

        filename = body.get("filename")
        content_type = body.get("contentType")

        if not filename:
            logger.warning(
                "Version upload initialization failed: filename missing. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error("Filename is required.")

        if not content_type:
            logger.warning(
                "Version upload initialization failed: content type missing. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error("Content type is required.")

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if permission.get("role") not in ["OWNER", "EDITOR"]:
            logger.warning(
                "Unauthorized version upload. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        upload_id = generate_upload_id()

        upload = generate_upload_url(
            s3_client=s3,
            bucket_name=BUCKET_NAME,
            owner_id=user["userId"],
            document_id=document_id,
            upload_id=upload_id,
            filename=filename,
            content_type=content_type,
        )

        logger.info(
            "Version upload session created. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        return success(
            {
                "uploadId": upload_id,
                "uploadUrl": upload["uploadUrl"],
                "expiresIn": upload["expiresIn"],
            },
            status_code=201,
        )

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to initialize version upload.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def version_complete(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Completing version upload for document %s by user %s.",
            document_id,
            user["userId"],
        )

        body = json.loads(event.get("body") or "{}")

        upload_id = body.get("uploadId")
        filename = body.get("filename")
        version_notes = body.get("versionNotes", "")

        required_fields = {
            "uploadId": upload_id,
            "filename": filename,
        }

        missing_fields = [
            field for field, value in required_fields.items() if not value
        ]

        if missing_fields:
            logger.warning(
                "Version upload completion failed: missing fields %s. documentId=%s user=%s",
                ", ".join(missing_fields),
                document_id,
                user["userId"],
            )

            return error(f"Missing required fields: {', '.join(missing_fields)}")

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if permission.get("role") not in ["OWNER", "EDITOR"]:
            logger.warning(
                "Unauthorized version upload. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        temporary_s3_key = (
            f"uploads/{user['userId']}/{document_id}/{upload_id}/{filename}"
        )

        response = s3.head_object(
            Bucket=BUCKET_NAME,
            Key=temporary_s3_key,
        )

        logger.info(
            "Verified uploaded version. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        validate_file_type(
            filename=filename,
            content_type=response["ContentType"],
        )

        logger.info(
            "Validated uploaded version type. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        pending_upload = {
            "PK": f"PENDING#{document_id}",
            "SK": f"UPLOAD#{upload_id}",
            "entityType": "PENDING_VERSION_UPLOAD",
            "ownerId": permission.get("document")["ownerId"],
            "uploadedBy": user["userId"],
            "documentId": document_id,
            "uploadId": upload_id,
            "filename": filename,
            "versionNotes": version_notes,
            "contentType": response["ContentType"],
            "fileSize": response["ContentLength"],
            "etag": response["ETag"],
            "temporaryS3Key": temporary_s3_key,
            "createdAt": get_current_timestamp(),
            "updatedAt": get_current_timestamp(),
            "expiresAt": get_expiry_timestamp(),
        }

        table.put_item(
            Item=pending_upload,
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
        )

        logger.info(
            "Pending version upload created. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        sqs.send_message(
            QueueUrl=UPLOAD_QUEUE_URL,
            MessageBody=json.dumps(
                {
                    "documentId": document_id,
                    "uploadId": upload_id,
                }
            ),
        )

        logger.info(
            "Version upload queued for ingestion. documentId=%s uploadId=%s",
            document_id,
            upload_id,
        )

        return success({"message": "Version upload completed successfully."})

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except ValueError as e:

        logger.warning(
            "Invalid uploaded file type. %s",
            str(e),
        )

        return error(
            str(e),
            status_code=400,
        )

    except ClientError as e:

        error_code = e.response["Error"]["Code"]

        if error_code == "404":

            logger.warning(
                "Uploaded version not found. documentId=%s uploadId=%s",
                document_id,
                upload_id,
            )

            return error(
                "Uploaded file not found.",
                status_code=400,
            )

        raise

    except Exception:

        logger.exception("Failed to complete version upload.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_document_versions(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Retrieving version history for document %s by user %s.",
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission["authorized"]:
            logger.warning(
                "Unauthorized access to version history. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"DOC#{document_id}")
            & Key("SK").begins_with("VERSION#"),
            ScanIndexForward=False,
        )

        versions = response.get("Items", [])

        logger.info(
            "Retrieved %d versions for document %s.",
            len(versions),
            document_id,
        )

        return success(versions)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve version history.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_document_version(event):

    try:
        user = get_user(event)

        path_parameters = event.get("pathParameters", {})

        document_id = path_parameters.get("documentId")
        version_number = path_parameters.get("versionNumber")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        if not version_number:
            logger.warning("Version number missing from request.")
            return error(
                "Version number is required.",
                status_code=400,
            )

        logger.info(
            "Retrieving version %s for document %s by user %s.",
            version_number,
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission["authorized"]:
            logger.warning(
                "Unauthorized access to document version. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"VERSION#{int(version_number):06d}",
            }
        )

        version = response.get("Item")

        if not version:
            logger.warning(
                "Version not found. documentId=%s version=%s",
                document_id,
                version_number,
            )

            return error(
                "Version not found.",
                status_code=404,
            )

        download_url = s3.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": version["s3Key"],
            },
            ExpiresIn=900,
        )

        version["downloadUrl"] = download_url

        logger.info(
            "Retrieved version %s for document %s.",
            version_number,
            document_id,
        )

        return success(version)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except ValueError:

        logger.warning(
            "Invalid version number supplied. documentId=%s version=%s",
            document_id,
            version_number,
        )

        return error(
            "Invalid version number.",
            status_code=400,
        )

    except Exception:

        logger.exception("Failed to retrieve document version.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def restore_document_version(event):

    try:
        user = get_user(event)

        path_parameters = event.get("pathParameters", {})

        document_id = path_parameters.get("documentId")
        version_number = path_parameters.get("versionNumber")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        if not version_number:
            logger.warning("Version number missing from request.")
            return error(
                "Version number is required.",
                status_code=400,
            )

        logger.info(
            "Initiating restore of version %s for document %s by user %s.",
            version_number,
            document_id,
            user["userId"],
        )

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"VERSION#{int(version_number):06d}",
            }
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission.get("role") in ["OWNER", "EDITOR"]:
            logger.warning(
                "Unauthorized version restore. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        version = response.get("Item")

        if not version:
            logger.warning(
                "Version not found. documentId=%s version=%s",
                document_id,
                version_number,
            )

            return error(
                "Version not found.",
                status_code=404,
            )

        restore_id = generate_restore_id()

        pending_restore = {
            "PK": f"PENDING#{document_id}",
            "SK": f"RESTORE#{restore_id}",
            "entityType": "PENDING_VERSION_RESTORE",
            "ownerId": permission.get("document")["ownerId"],
            "restoredBy": user["userId"],
            "documentId": document_id,
            "restoreId": restore_id,
            "sourceVersion": int(version_number),
            "createdAt": get_current_timestamp(),
            "updatedAt": get_current_timestamp(),
            "expiresAt": get_expiry_timestamp(),
        }

        table.put_item(
            Item=pending_restore,
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
        )

        logger.info(
            "Pending version restore created. documentId=%s sourceVersion=%s restoreId=%s",
            document_id,
            version_number,
            restore_id,
        )

        sqs.send_message(
            QueueUrl=UPLOAD_QUEUE_URL,
            MessageBody=json.dumps(
                {
                    "documentId": document_id,
                    "restoreId": restore_id,
                }
            ),
        )

        logger.info(
            "Version restore queued for ingestion. documentId=%s sourceVersion=%s restoreId=%s",
            document_id,
            version_number,
            restore_id,
        )

        return success({"message": "Version restore initiated successfully."})

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except ValueError:

        logger.warning(
            "Invalid version number supplied. documentId=%s version=%s",
            document_id,
            version_number,
        )

        return error(
            "Invalid version number.",
            status_code=400,
        )

    except Exception:

        logger.exception("Failed to initiate version restore.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def share_document(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Sharing document %s by user %s.",
            document_id,
            user["userId"],
        )

        body = json.loads(event.get("body") or "{}")

        email = body.get("email")
        role = body.get("role")

        if not email:
            return error(
                "Email is required.",
                status_code=400,
            )

        if role not in ["VIEWER", "EDITOR"]:
            return error(
                "Role must be VIEWER or EDITOR.",
                status_code=400,
            )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission.get("role") == "OWNER":
            logger.warning(
                "Unauthorized document share. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = cognito.list_users(
            UserPoolId=USER_POOL_ID,
            Filter=f'email = "{email}"',
            Limit=1,
        )

        users = response.get("Users", [])

        if not users:
            return error(
                "User not found.",
                status_code=404,
            )

        attributes = {
            attribute["Name"]: attribute["Value"]
            for attribute in users[0]["Attributes"]
        }

        shared_user_id = attributes["sub"]

        if shared_user_id == user["userId"]:
            return error(
                "You cannot share a document with yourself.",
                status_code=400,
            )

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"SHARE#{shared_user_id}",
            }
        )

        existing_share = response.get("Item")

        current_time = get_current_timestamp()

        created_at = existing_share["createdAt"] if existing_share else current_time

        share = {
            "PK": f"DOC#{document_id}",
            "SK": f"SHARE#{shared_user_id}",
            "entityType": "SHARE",
            "ownerId": user["userId"],
            "documentId": document_id,
            "sharedWithUserId": shared_user_id,
            "sharedWithEmail": email,
            "role": role,
            "SharedWithGSI": f"USER#{shared_user_id}",
            "createdAt": created_at,
            "updatedAt": current_time,
        }

        table.put_item(Item=share)

        logger.info(
            "Document %s shared with %s as %s.",
            document_id,
            email,
            role,
        )

        return success(
            {
                "message": "Document shared successfully.",
            }
        )

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to share document.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_document_shares(event):

    try:
        user = get_user(event)

        document_id = event.get("pathParameters", {}).get("documentId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        logger.info(
            "Retrieving shares for document %s by user %s.",
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission.get("role") == "OWNER":
            logger.warning(
                "Unauthorized access to document shares. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"DOC#{document_id}")
            & Key("SK").begins_with("SHARE#")
        )

        shares = response.get("Items", [])

        logger.info(
            "Retrieved %d shares for document %s.",
            len(shares),
            document_id,
        )

        return success(shares)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve document shares.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def delete_document_share(event):

    try:
        user = get_user(event)

        path_parameters = event.get("pathParameters", {})

        document_id = path_parameters.get("documentId")
        shared_user_id = path_parameters.get("userId")

        if not document_id:
            logger.warning("Document ID missing from request.")
            return error(
                "Document ID is required.",
                status_code=400,
            )

        if not shared_user_id:
            logger.warning("Shared user ID missing from request.")
            return error(
                "Shared user ID is required.",
                status_code=400,
            )

        logger.info(
            "Removing share for document %s by user %s.",
            document_id,
            user["userId"],
        )

        permission = get_document_permission(
            table,
            document_id,
            user,
        )

        if not permission["exists"]:
            logger.warning(
                "Document not found. documentId=%s",
                document_id,
            )
            return error(
                "Document not found.",
                status_code=404,
            )

        if not permission.get("role") == "OWNER":
            logger.warning(
                "Unauthorized document share removal. documentId=%s user=%s",
                document_id,
                user["userId"],
            )
            return error(
                "Access denied.",
                status_code=403,
            )

        response = table.get_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"SHARE#{shared_user_id}",
            }
        )

        share = response.get("Item")

        if not share:
            logger.warning(
                "Share not found. documentId=%s sharedUser=%s",
                document_id,
                shared_user_id,
            )

            return error(
                "Share not found.",
                status_code=404,
            )

        table.delete_item(
            Key={
                "PK": f"DOC#{document_id}",
                "SK": f"SHARE#{shared_user_id}",
            }
        )

        logger.info(
            "Share removed successfully. documentId=%s sharedUser=%s",
            document_id,
            shared_user_id,
        )

        return success({"message": "Share removed successfully."})

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to remove document share.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_shared_documents(event):

    try:
        user = get_user(event)

        logger.info(
            "Retrieving shared documents for user %s.",
            user["userId"],
        )

        response = table.query(
            IndexName="SharedIndex",
            KeyConditionExpression=Key("SharedWithGSI").eq(f"USER#{user['userId']}"),
            ScanIndexForward=False,
        )

        shared_documents = response.get("Items", [])

        logger.info(
            "Retrieved %d shared documents for user %s.",
            len(shared_documents),
            user["userId"],
        )

        return success(shared_documents)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve shared documents.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_admin_statistics(event):

    try:
        user = get_user(event)

        if not user["isAdmin"]:
            logger.warning(
                "Unauthorized admin statistics request. user=%s",
                user["userId"],
            )

            return error(
                "Access denied.",
                status_code=403,
            )

        exists = ensure_admin_subscription(
            user=user,
            cognito=cognito,
            sns=sns,
            user_pool_id=USER_POOL_ID,
            topic_arn=SNS_TOPIC_ARN,
        )

        if not exists:
            logger.warning(
                "SNS Topic Subscription created for Admin User %s.",
                user["userId"],
            )

            return error(
                "Admin user does not have an active subscription to the SNS topic.",
                status_code=403,
            )

        logger.info("Retrieving admin statistics.")

        # ---------- Total Documents ----------

        response = table.query(
            IndexName="AdminIndex",
            KeyConditionExpression=Key("AdminGSI").eq("DOCUMENT"),
            Select="COUNT",
        )

        total_documents = response["Count"]

        # ---------- Processing Documents ----------

        response = table.query(
            IndexName="ProcessingIndex",
            KeyConditionExpression=Key("processingStatus").eq("PROCESSING"),
            Select="COUNT",
        )

        processing_documents = response["Count"]

        # ---------- Failed Documents ----------

        response = table.query(
            IndexName="ProcessingIndex",
            KeyConditionExpression=Key("processingStatus").eq("FAILED"),
            Select="COUNT",
        )

        failed_documents = response["Count"]

        # ---------- Total Users ----------

        paginator = cognito.get_paginator("list_users")

        total_users = 0

        for page in paginator.paginate(
            UserPoolId=USER_POOL_ID,
        ):
            total_users += len(page["Users"])

        logger.info("Admin statistics retrieved successfully.")

        return success(
            {
                "totalUsers": total_users,
                "totalDocuments": total_documents,
                "processingDocuments": processing_documents,
                "failedDocuments": failed_documents,
            }
        )

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve admin statistics.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_admin_documents(event):

    try:
        user = get_user(event)

        if not user["isAdmin"]:
            logger.warning(
                "Unauthorized admin document request. user=%s",
                user["userId"],
            )

            return error(
                "Access denied.",
                status_code=403,
            )

        exists = ensure_admin_subscription(
            user=user,
            cognito=cognito,
            sns=sns,
            user_pool_id=USER_POOL_ID,
            topic_arn=SNS_TOPIC_ARN,
        )

        if not exists:
            logger.warning(
                "SNS Topic Subscription created for Admin User %s.",
                user["userId"],
            )

            return error(
                "Admin user does not have an active subscription to the SNS topic.",
                status_code=403,
            )

        logger.info("Retrieving all documents for admin.")

        response = table.query(
            IndexName="AdminIndex",
            KeyConditionExpression=Key("AdminGSI").eq("DOCUMENT"),
            ScanIndexForward=False,
        )

        documents = response.get("Items", [])

        logger.info(
            "Retrieved %d documents for admin.",
            len(documents),
        )

        return success(documents)

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve admin documents.")

        return error(
            "Internal server error.",
            status_code=500,
        )


def get_admin_processing(event):

    try:
        user = get_user(event)

        if not user["isAdmin"]:
            logger.warning(
                "Unauthorized admin processing request. user=%s",
                user["userId"],
            )

            return error(
                "Access denied.",
                status_code=403,
            )

        exists = ensure_admin_subscription(
            user=user,
            cognito=cognito,
            sns=sns,
            user_pool_id=USER_POOL_ID,
            topic_arn=SNS_TOPIC_ARN,
        )

        if not exists:
            logger.warning(
                "SNS Topic Subscription created for Admin User %s.",
                user["userId"],
            )

            return error(
                "Admin user does not have an active subscription to the SNS topic.",
                status_code=403,
            )

        logger.info("Retrieving processing documents.")

        response = table.query(
            IndexName="ProcessingIndex",
            KeyConditionExpression=Key("processingStatus").eq("PROCESSING"),
            ScanIndexForward=False,
        )

        processing_documents = response.get("Items", [])

        response = table.query(
            IndexName="ProcessingIndex",
            KeyConditionExpression=Key("processingStatus").eq("FAILED"),
            ScanIndexForward=False,
        )

        failed_documents = response.get("Items", [])

        logger.info(
            "Retrieved %d processing documents and %d failed documents.",
            len(processing_documents),
            len(failed_documents),
        )

        return success(
            {
                "processing": processing_documents,
                "failed": failed_documents,
            }
        )

    except PermissionError:

        logger.warning("Unauthenticated request received.")

        return error(
            "Authentication required.",
            status_code=401,
        )

    except Exception:

        logger.exception("Failed to retrieve processing documents.")

        return error(
            "Internal server error.",
            status_code=500,
        )
