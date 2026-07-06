resource "aws_dynamodb_table" "this" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "OwnerGSI"
    type = "S"
  }

  attribute {
    name = "SharedWithGSI"
    type = "S"
  }

  attribute {
    name = "AdminGSI"
    type = "S"
  }

  attribute {
    name = "processingStatus"
    type = "S"
  }

  attribute {
    name = "updatedAt"
    type = "S"
  }

  global_secondary_index {
    name = "OwnerIndex"

    key_schema {
      attribute_name = "OwnerGSI"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "updatedAt"
      key_type       = "RANGE"
    }

    projection_type = "ALL"
  }

  global_secondary_index {
    name = "SharedIndex"

    key_schema {
      attribute_name = "SharedWithGSI"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "updatedAt"
      key_type       = "RANGE"
    }

    projection_type = "ALL"
  }

  global_secondary_index {
    name = "AdminIndex"

    key_schema {
      attribute_name = "AdminGSI"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "updatedAt"
      key_type       = "RANGE"
    }

    projection_type = "ALL"
  }

  global_secondary_index {
    name = "ProcessingIndex"

    key_schema {
      attribute_name = "processingStatus"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "updatedAt"
      key_type       = "RANGE"
    }

    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = var.tags
}