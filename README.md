# KnowledgeHub

Enterprise document management and knowledge processing platform on AWS.

## Overview

KnowledgeHub is a serverless document management application for securely uploading, versioning, sharing, searching, and administering organizational documents. It stores document metadata in DynamoDB, stores document binaries in S3, and enriches supported files with extracted text, summaries, and keywords after upload.

The system is designed around asynchronous processing. The browser uploads files directly to S3 using presigned URLs, the API records a pending upload, and SQS-driven Lambdas move the object into its permanent location and perform AI enrichment. This keeps the user-facing API responsive while isolating document ingestion and processing from the request path.

## Features

### Authentication and Access Control

- Amazon Cognito Hosted UI sign-in with OAuth 2.0 authorization code flow and PKCE
- JWT bearer authentication for all API routes
- Cognito `admins` group for administrative access
- Role-based authorization for owner, editor, and viewer permissions

### Document Management

- Create documents through a two-step upload flow
- List owned documents and shared documents separately
- Rename document titles and update tags
- Delete documents and all associated versions
- Download current documents through presigned S3 GET URLs

### Version Management

- Upload new versions without re-entering title or tags
- Restore an older version as a brand-new version
- Keep immutable version history for every document
- Download any stored version through a presigned S3 GET URL

### Processing and Enrichment

- Validate supported uploads before completion
- Move uploaded objects from a temporary key to permanent storage
- Extract text from PDF, DOCX, TXT, and Markdown files
- Generate summaries with Sumy LSA
- Generate keywords with YAKE
- Track processing state across `PROCESSING`, `READY`, and `FAILED`

### Sharing and Search

- Share documents with existing users by email
- Grant `VIEWER` or `EDITOR` access
- Revoke sharing for individual users
- Search loaded owned and shared documents client-side by title, owner, tags, keywords, summary, and status
- Persist recent browser searches locally

### Administration and Monitoring

- View platform statistics
- Browse all documents from the admin console
- Inspect documents currently processing or failed
- Receive CloudWatch alarm notifications through SNS email subscription
- Run daily scheduled maintenance for log export and subscription cleanup

## Architecture

```text
Browser
  |
  +--> CloudFront -> private website S3 bucket
  |
  +--> Cognito Hosted UI -> JWT tokens in the SPA
  |
  +--> HTTP API Gateway + JWT authorizer
            |
            v
         API Lambda
        /    |     \
       /     |      +--> Cognito user pool lookups
      /      |      +--> SNS topic checks for admins
     /       |      +--> DynamoDB single-table reads/writes
    /        |      +--> S3 presigned upload/download URLs
   /         |
  v          v
DynamoDB     Upload SQS queue
  |            |
  |            v
  |         Ingestion Lambda
  |            |
  |            +--> copy temp object to permanent S3 key
  |            +--> write DOCUMENT/VERSION items
  |            +--> enqueue Processing SQS message
  |            v
  |         Processing SQS queue
  |            |
  |            v
  |         Processor Lambda
  |            |
  |            +--> extract text, summarize, generate keywords
  |            +--> update version/document processing state
  |
  +--> Shared/owner/admin queries via GSIs

EventBridge Scheduler -> Maintenance Lambda -> CloudWatch Logs archive S3 bucket
                                         \-> SNS subscription cleanup
```

CloudFront serves the static SPA from a private S3 bucket using Origin Access Control. Cognito provides user authentication and JWTs. API Gateway routes all application requests to the API Lambda through a JWT authorizer. The API Lambda is responsible for authorization checks, presigned URLs, and document lifecycle requests. Ingestion and processing are separated into SQS-backed workers so that uploads are acknowledged quickly and text extraction happens off the request path.

The maintenance Lambda is invoked daily by EventBridge Scheduler. It exports the previous day's CloudWatch Logs for the API Lambda into the log archive bucket and removes SNS email subscriptions that no longer belong to current administrators.

## Technology Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript ES modules

### Backend

- Python 3.12 on AWS Lambda
- boto3 via the Lambda runtime
- Sumy
- NLTK
- YAKE
- python-docx
- pypdf
- jellyfish
- networkx
- tabulate

### Infrastructure

- Terraform 1.12+
- AWS provider `hashicorp/aws` `~> 6.0`
- Amazon CloudFront
- Amazon Cognito
- Amazon API Gateway HTTP API
- AWS Lambda
- Amazon DynamoDB
- Amazon S3
- Amazon SQS
- Amazon SNS
- Amazon CloudWatch
- Amazon EventBridge Scheduler
- AWS IAM

### Database

- Amazon DynamoDB single-table design with GSIs

## Repository Structure

```text
knowledgehub/
  docs/                     Design and specification documents kept in version control
  lambda/                   Python Lambda source code and processor runtime data
    api/                    HTTP API Lambda and shared helpers
    ingestion/              SQS-driven upload and restore ingestion worker
    maintenance/            Scheduled maintenance worker and helpers
    processor/              Text extraction, summarization, and keyword generation worker
      tokenizers/           Vendored NLTK tokenizer data used by the processor
  terraform/                Root Terraform configuration and reusable modules
    modules/                Service-specific Terraform modules
      api_gateway/          HTTP API module
      cloudfront/           Static website delivery module
      cognito/              User pool, client, Hosted UI domain, and admins group
      dynamodb/             Single-table DynamoDB module
      lambda/               Reusable Lambda packaging module
      s3/                   Secure S3 bucket module
      sns/                  SNS topic module
      sqs/                  Queue and dead-letter queue module
  website/                  Static SPA, runtime config template, scripts, and styles
    js/                     Application modules for auth, data access, views, and UI state
    styles/                 CSS split by base, layout, components, pages, themes, and utilities
```

## Prerequisites

- Terraform 1.12 or later
- AWS CLI configured for the target account and region
- Python 3.12 for Lambda packaging and local backend testing
- Git
- An AWS account with permissions to create IAM, Cognito, API Gateway, Lambda, DynamoDB, S3, SQS, SNS, CloudWatch, CloudFront, and EventBridge Scheduler resources
- An email inbox for the `admin_email` Terraform variable so SNS alarms and administrator subscriptions can be confirmed

## Installation

1. Clone the repository.

2. Configure your AWS credentials for the target account and region.

3. Install the Python dependencies used by the processor Lambda if you plan to build or test that function locally.

4. Build the deployment packages required by the four Lambda functions. The Terraform configuration expects the packaged artifacts to exist before apply.

5. Review the Terraform variables in `terraform/variables.tf` and supply a valid administrator email address when deploying.

## Deployment

Terraform is the only deployment mechanism tracked in this repository.

From the `terraform/` directory:

```bash
terraform init
terraform plan -var="admin_email=you@example.com"
terraform apply -var="admin_email=you@example.com"
```

This provisions:

- A private, versioned website bucket served through CloudFront
- A private, versioned storage bucket for documents and a separate log archive bucket
- A DynamoDB single-table schema with four GSIs and TTL support
- A Cognito user pool, Hosted UI domain, app client, and `admins` group
- An SNS topic with an email subscription for the administrator address
- Upload and processing SQS queues with dead-letter queues and Lambda event source mappings
- Four Lambda functions for API, ingestion, processing, and maintenance
- An HTTP API Gateway with a JWT authorizer
- CloudWatch alarms for Lambda errors, queue depth, and dead-letter queues
- An EventBridge Scheduler job for daily maintenance
- The static website assets and runtime `config.js` generated from the tracked template

After `apply`, use the Terraform outputs to retrieve the CloudFront website URL and API endpoint.

## Running the Application

Open the CloudFront URL returned by Terraform. Sign in through Cognito Hosted UI. The SPA stores the session locally and uses the API bearer token automatically for subsequent requests.

To upload a document, open the Upload view, choose a supported file, provide a title and tags for a new document, and submit the form. The browser uploads the file directly to S3 using a presigned URL. After upload completion, the API creates a pending record, queues ingestion, and the document appears in the UI with a processing state.

Version uploads use the same flow, but the title and tags are inherited from the existing document. Restoring a version enqueues a restore job that creates a brand-new version from the selected source version.

Owned documents, shared documents, version history, sharing, downloads, and admin views are all driven from the deployed API and DynamoDB data. Documents move from `PROCESSING` to `READY` when the processor finishes successfully, or to `FAILED` when text extraction or enrichment fails.

## Configuration

| Configuration | Used By | Purpose |
|---|---|---|
| `terraform/main.tf` | Terraform root module | Defines the AWS provider, backend, core resources, Lambda wiring, route mappings, alarms, scheduler, and website deployment. |
| `terraform/variables.tf` | Terraform root module | Declares the deployment region and administrator email inputs. |
| `terraform/outputs.tf` | Terraform root module | Exposes the CloudFront website URL, API endpoint, and Cognito identifiers after deployment. |
| `terraform/modules/s3/variables.tf` | S3 module | Controls bucket name, versioning, lifecycle, and tags. |
| `terraform/modules/s3/main.tf` | S3 module | Applies private access, encryption, versioning, and lifecycle configuration. |
| `terraform/modules/dynamodb/variables.tf` | DynamoDB module | Controls table name and tags. |
| `terraform/modules/dynamodb/main.tf` | DynamoDB module | Defines the single-table schema, GSIs, TTL, encryption, and point-in-time recovery. |
| `terraform/modules/cognito/variables.tf` | Cognito module | Controls user pool name, Hosted UI domain prefix, callback URLs, logout URLs, and tags. |
| `terraform/modules/cognito/main.tf` | Cognito module | Configures the user pool, app client, Hosted UI domain, and `admins` group. |
| `terraform/modules/sqs/variables.tf` | SQS module | Controls queue name, visibility timeout, retention, receive count, and tags. |
| `terraform/modules/sqs/main.tf` | SQS module | Creates the primary queue, dead-letter queue, encryption, and redrive policy. |
| `terraform/modules/lambda/variables.tf` | Lambda module | Controls function name, package path, IAM role, runtime sizing, and environment variables. |
| `terraform/modules/lambda/main.tf` | Lambda module | Creates the Lambda function and log group with retention. |
| `terraform/modules/api_gateway/variables.tf` | API Gateway module | Controls the HTTP API name and tags. |
| `terraform/modules/api_gateway/main.tf` | API Gateway module | Configures the HTTP API and default stage with CORS. |
| `terraform/modules/cloudfront/variables.tf` | CloudFront module | Controls origin domain, origin ID, and tags. |
| `terraform/modules/cloudfront/main.tf` | CloudFront module | Configures CloudFront with OAC, HTTPS redirect, and the default certificate. |
| `terraform/modules/sns/variables.tf` | SNS module | Controls topic name and tags. |
| `terraform/modules/sns/main.tf` | SNS module | Creates the notifications topic. |
| `website/config.js.tpl` | Website deployment template | Renders the browser runtime config from Terraform outputs. |
| `website/js/config.js` | Frontend runtime config loader | Normalizes the deployed browser config and validates required values. |
| `lambda/api/requirements.txt` | API Lambda packaging | No extra Python dependencies are declared. |
| `lambda/ingestion/requirements.txt` | Ingestion Lambda packaging | No extra Python dependencies are declared. |
| `lambda/maintenance/requirements.txt` | Maintenance Lambda packaging | No extra Python dependencies are declared. |
| `lambda/processor/requirements.txt` | Processor Lambda packaging | Declares the document-processing dependencies used for extraction, summarization, and keyword generation. |

## API Reference

All routes are protected by the Cognito JWT authorizer. Admin routes additionally require membership in the `admins` group and an active SNS email subscription.

| Method | Endpoint | Authentication | Description |
|---|---|---|---|
| POST | `/documents/init` | JWT required | Create a new document upload session and return a presigned S3 PUT URL. |
| POST | `/documents/complete` | JWT required | Verify the uploaded object, create a pending document record, and queue ingestion. |
| GET | `/documents` | JWT required | List documents owned by the authenticated user. |
| GET | `/documents/shared` | JWT required | List documents shared with the authenticated user. |
| GET | `/documents/{documentId}` | JWT required | Return document metadata plus a presigned download URL for the current version. |
| PATCH | `/documents/{documentId}` | JWT required | Update the document title or tags. Owner only. |
| DELETE | `/documents/{documentId}` | JWT required | Delete the document and all of its versions and share records. Owner or admin only. |
| POST | `/documents/{documentId}/versions/init` | JWT required | Create a version upload session and return a presigned S3 PUT URL. |
| POST | `/documents/{documentId}/versions/complete` | JWT required | Verify the uploaded version object, create a pending version record, and queue ingestion. |
| GET | `/documents/{documentId}/versions` | JWT required | Return version history for the document. |
| GET | `/documents/{documentId}/versions/{versionNumber}` | JWT required | Return a single version record plus a presigned download URL. |
| POST | `/documents/{documentId}/versions/{versionNumber}/restore` | JWT required | Queue a restore operation that creates a new version from the selected source version. |
| POST | `/documents/{documentId}/shares` | JWT required | Share the document with an existing user by email. Owner only. |
| GET | `/documents/{documentId}/shares` | JWT required | List the current sharing assignments for the document. Owner only. |
| DELETE | `/documents/{documentId}/shares/{userId}` | JWT required | Remove a sharing assignment. Owner only. |
| GET | `/admin/statistics` | JWT required, `admins` group, active SNS subscription | Return platform statistics. |
| GET | `/admin/documents` | JWT required, `admins` group, active SNS subscription | Return the admin document browser view. |
| GET | `/admin/processing` | JWT required, `admins` group, active SNS subscription | Return currently processing and failed documents. |

## Core Components

### API Lambda

The API Lambda is the HTTP entry point for the platform. It is triggered by API Gateway proxy integration and dispatches all routes in a single handler. It generates presigned upload and download URLs, validates file type and ownership, manages document and version metadata, handles sharing, and serves admin endpoints.

It interacts with DynamoDB for metadata reads and writes, S3 for presigned access and object validation, SQS for upload and restore queueing, Cognito for user and group lookups, and SNS to verify administrator subscription state before serving admin routes. The single-dispatch design keeps all request-time authorization in one place and makes the route set explicit in code.

### Ingestion Lambda

The ingestion Lambda is triggered by the upload SQS queue. It reads pending upload or restore records, copies temporary S3 objects into permanent document version keys, and writes document metadata transactionally into DynamoDB.

It creates the initial `DOCUMENT` record for new uploads, increments the current version for subsequent uploads, and creates a new version for restores without overwriting existing history. After persistence succeeds, it queues the document version for processor work and deletes the temporary object and pending row. This isolates object movement and transactional metadata updates from the user request path.

### Processor Lambda

The processor Lambda is triggered by the processing SQS queue. It loads the permanent object from S3, extracts text according to file type, normalizes the text, generates a summary and keywords, and updates both the version record and the parent document with the final processing state.

Supported extraction formats are PDF, DOCX, TXT, and Markdown. Successful processing sets the version and document to `READY`; failures set them to `FAILED` and store the error message. This worker keeps CPU-heavy document enrichment outside the API path.

### Maintenance Lambda

The maintenance Lambda is triggered daily by EventBridge Scheduler. It exports the previous day's CloudWatch Logs for the API Lambda into the log archive bucket and removes SNS email subscriptions that no longer correspond to current administrators.

This keeps operational logs in S3 while preventing stale email subscriptions from accumulating on the notifications topic.

## Data Model

KnowledgeHub uses a single DynamoDB table with `PK` and `SK` as the primary key pair. Every document owns a partition, and all document-related records live under that partition.

| Entity | Partition Key | Sort Key | Notes |
|---|---|---|---|
| DOCUMENT | `DOC#<documentId>` | `DOCUMENT` | Root record for the document. Stores title, tags, owner, current version, and processing state. |
| VERSION | `DOC#<documentId>` | `VERSION#000001` and upward | Immutable version history. Stores file metadata, S3 key, notes, summary, keywords, and processing state. |
| SHARE | `DOC#<documentId>` | `SHARE#<userId>` | Document sharing assignment with role and shared user metadata. |
| PENDING_DOCUMENT_UPLOAD | `PENDING#<documentId>` | `UPLOAD#<uploadId>` | TTL-backed pending upload record used before ingestion runs. |
| PENDING_VERSION_UPLOAD | `PENDING#<documentId>` | `UPLOAD#<uploadId>` | TTL-backed pending version upload record. |
| PENDING_VERSION_RESTORE | `PENDING#<documentId>` | `RESTORE#<restoreId>` | TTL-backed pending restore record. |

Indexes:

- `OwnerIndex` uses `OwnerGSI` and `updatedAt` to list a user's owned documents.
- `SharedIndex` uses `SharedWithGSI` and `updatedAt` to list documents shared with a user.
- `AdminIndex` uses `AdminGSI` and `updatedAt` to list all document records for the admin console.
- `ProcessingIndex` uses `processingStatus` and `updatedAt` to list processing and failed documents.

Access patterns implemented in code include owned-document lists, shared-document lists, document retrieval, version history, version lookup, document updates, sharing management, document deletion, admin browsing, and processing-state inspection.

## Processing Workflow

1. The browser requests a document or version upload session from the API.
2. The API validates the filename and content type, then returns a 15-minute presigned S3 PUT URL.
3. The browser uploads the file directly to the temporary `uploads/<userId>/<documentId>/<uploadId>/...` key in the storage bucket.
4. The browser submits the completion request with the document or version metadata.
5. The API verifies the uploaded object with `head_object`, validates the file type, writes a TTL-backed pending row, and queues the upload on the upload SQS queue.
6. The ingestion Lambda consumes the queue message, loads the pending row, and moves the object to its permanent `documents/<documentId>/v000001/...` key.
7. The ingestion Lambda writes the `DOCUMENT` and `VERSION` items transactionally, or increments the version and updates the parent document for later uploads.
8. The ingestion Lambda queues the version on the processing SQS queue and removes the temporary object and pending row.
9. The processor Lambda reads the permanent object, extracts text, normalizes it, generates a summary and keywords, and updates the version and document to `READY`.
10. If processing fails, the processor Lambda marks the version and document as `FAILED` and stores the processing error message.
11. The SPA polls document state after uploads and restores so the UI can surface completion or failure without a page refresh.
12. Administrative alarms and daily maintenance continue in parallel without blocking document operations.

## Security

- Cognito Hosted UI provides the interactive sign-in flow.
- The SPA uses OAuth 2.0 authorization code flow with PKCE.
- API Gateway uses a JWT authorizer against the Cognito user pool.
- The API Lambda validates the JWT claims again before applying document or admin authorization.
- Ownership checks are enforced server-side for rename, share, and delete operations.
- Editor access is limited to upload, restore, and read operations.
- Admin routes require the `admins` group and an active SNS email subscription.
- Uploads and downloads use short-lived presigned S3 URLs instead of public bucket access.
- The website bucket is private and readable only through CloudFront Origin Access Control.
- S3 buckets are private, encrypted, and public access is blocked.
- IAM policies are scoped per function and only grant the actions each Lambda needs.
- The SPA stores the session in `localStorage` and keeps PKCE state in `sessionStorage`, matching the current implementation.

## Infrastructure

The Terraform configuration is split into a root module and reusable service modules.

- `terraform/main.tf` wires the application together, defines the backend, configures the provider, instantiates each module, sets up Lambda roles and policies, registers API routes, creates alarms, and publishes the website assets.
- `terraform/modules/s3` provides a secure, private S3 bucket abstraction with versioning, encryption, public access blocking, and optional lifecycle cleanup.
- `terraform/modules/dynamodb` provisions the single-table schema and its GSIs.
- `terraform/modules/cognito` provisions the user pool, app client, Hosted UI domain, and `admins` group.
- `terraform/modules/sqs` provisions a queue and dead-letter queue pair.
- `terraform/modules/lambda` packages a Lambda function with its log group and environment variables.
- `terraform/modules/api_gateway` provisions the HTTP API and default stage.
- `terraform/modules/cloudfront` provisions the CloudFront distribution and OAC for the static website.
- `terraform/modules/sns` provisions the notifications topic.

State is configured in the root `terraform` block to use an S3 backend with lockfile support. The website deployment block uploads all tracked static assets under `website/` and renders the runtime configuration from `website/config.js.tpl`.

## Local Development

The frontend is a static application. You can serve the `website/` directory with any static file server that supports ES modules, but the app still requires a valid runtime configuration and deployed AWS services for authentication and data access.

The following services must exist in AWS for the application to work end to end:

- Cognito user pool and app client for sign-in
- API Gateway and the API Lambda for all document and admin operations
- S3 storage bucket for uploads and document binaries
- DynamoDB table for metadata
- SQS queues for ingestion and processing
- SNS topic for administrator notifications

Without those deployed resources, the SPA can render but cannot authenticate, upload, search, or load document data.

## Cleanup

From the `terraform/` directory, run:

```bash
terraform destroy -var="admin_email=you@example.com"
```

This removes the Terraform-managed AWS resources created by the stack. The remote Terraform backend used for state is external to the application stack and is not destroyed by this command.

## License

This project is licensed under the MIT License.