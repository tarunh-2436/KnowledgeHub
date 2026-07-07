import json
import uuid
from time import datetime, time, timezone


def success(data=None, status_code=200):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"success": True, "data": data or {}}),
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
        groups = [group.strip() for group in groups.split(",")]

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
        "role": share["permission"],
        "document": document,
        "share": share,
    }
