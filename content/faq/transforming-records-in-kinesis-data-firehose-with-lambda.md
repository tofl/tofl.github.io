---
title: "Transforming Records in Kinesis Data Firehose with Lambda"
---

## Transforming Records in Kinesis Data Firehose with Lambda

Every day, organizations push terabytes of data through streaming pipelines—clickstreams, application logs, IoT sensor readings, transaction records. Raw data, however, rarely arrives in the exact format downstream systems need. It might be CSV when your database expects JSON. It might contain personally identifiable information that should never reach your data lake. It might lack enrichment data that only exists in a reference table. This is where Kinesis Data Firehose's Lambda transformation capability becomes invaluable. By attaching a transformation function to your delivery stream, you can cleanse, enrich, and reshape data in flight—before it lands in S3, Redshift, Splunk, or any other destination. In this article, we'll explore exactly how this works, from understanding Firehose's invocation contract to implementing robust production transformations.

### Understanding the Firehose-Lambda Integration Model

Kinesis Data Firehose is AWS's managed service for delivering streaming data to data lakes and analytics warehouses. It handles buffering, compression, and batching so you don't have to. When you attach a Lambda function to a Firehose delivery stream, Firehose becomes a Lambda invoker—it batches incoming records and periodically sends them to your function for processing.

This isn't a one-to-one invocation pattern. Instead, Firehose groups records together and sends them as a batch. This batching is both a performance feature and something you need to understand deeply. If your Firehose stream receives a thousand records per second, Firehose might collect several hundred records and invoke Lambda once, passing them all in a single request. This efficiency is why Firehose remains cost-effective at scale, but it also means your transformation function must handle batches, not individual records.

The request Firehose sends to your Lambda function has a very specific structure. At the top level, you receive a JSON object with a `records` array. Each element in that array represents one data record that passed through your delivery stream. Here's what a typical invocation looks like:

```json
{
  "records": [
    {
      "recordId": "49590338271490256608559692538361571095921575989136588898",
      "approximateArrivalTimestamp": 1545084650987,
      "data": "SGVsbG8sIHRoaXMgaXMgYSB0ZXN0Lg=="
    },
    {
      "recordId": "49590338271490256608559692540925260715592454289221225090",
      "approximateArrivalTimestamp": 1545084711166,
      "data": "VGhpcyBpcyBhbm90aGVyIHRlc3Q="
    }
  ]
}
```

Notice the `data` field. It's always base64-encoded. This is crucial—you must decode it before processing. The `recordId` is an identifier Firehose uses to track which record produced which output in your response. The `approximateArrivalTimestamp` gives you a Unix timestamp in milliseconds.

Your Lambda function must return a response with an equally specific structure. Firehose expects a JSON object containing a `records` array, where each element corresponds to one input record (in the same order). Each output record must include the original `recordId` and a `result` field that is one of three values: `Ok`, `Dropped`, or `ProcessingFailed`. Finally, you include the transformed `data`—again, base64-encoded.

Here's what a valid response looks like:

```json
{
  "records": [
    {
      "recordId": "49590338271490256608559692538361571095921575989136588898",
      "result": "Ok",
      "data": "SGVsbG8sIHRyYW5zZm9ybWVkIGRhdGEh"
    },
    {
      "recordId": "49590338271490256608559692540925260715592454289221225090",
      "result": "Dropped"
    }
  ]
}
```

Notice that a `Dropped` record has no `data` field—Firehose will simply discard it. This is useful when you want to filter records during transformation.

### The Data Contract: Limits and Constraints

AWS publishes specific constraints around payload sizes, and exceeding them will cause your transformation to fail silently in ways that are initially confusing. Each invocation from Firehose to Lambda can contain up to 1 MB of data by default, though you can request a limit increase. More importantly, the response you return must be no larger than 6 MB total, and the transformed data in each individual record cannot exceed 1 MB. This seems generous until you realize that Firehose typically batches hundreds of records per invocation, and if your transformation significantly enriches the data, you can hit these limits faster than expected.

The base64 encoding adds overhead. When Firehose sends you data, it's base64-encoded. When you return transformed data, it must also be base64-encoded. Base64 expansion increases the size by approximately 33 percent. If you're enriching records with external reference data, every transformation adds to the payload size. A record that's 5 KB of raw JSON might become 7 KB after enrichment and base64 encoding. Multiply that by several hundred records in a batch, and suddenly you're approaching the 6 MB response limit.

The practical takeaway: be mindful of how much you're enriching records. Consider whether enrichment should happen downstream in your ETL pipeline instead. If you must enrich in Firehose, design your transformations to add minimal data, and test your batching behavior with realistic data volumes.

### Common Transformation Patterns

Let's explore the kinds of transformations developers actually implement. These patterns cover the vast majority of real-world use cases.

**CSV to JSON conversion** is perhaps the most common transformation. Many legacy systems emit CSV data, but modern analytics platforms expect JSON. Your Lambda function reads the CSV, parses it using a CSV library, and outputs JSON:

```python
import base64
import csv
import io
import json

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        # Decode the base64 data
        payload = base64.b64decode(record['data']).decode('utf-8')
        
        # Parse CSV
        reader = csv.DictReader(io.StringIO(payload))
        for row in reader:
            # Convert to JSON
            json_data = json.dumps(row)
            encoded = base64.b64encode(json_data.encode('utf-8')).decode('utf-8')
            
            output.append({
                'recordId': record['recordId'],
                'result': 'Ok',
                'data': encoded
            })
    
    return {'records': output}
```

This example shows a subtle point: one input CSV record might contain multiple rows if the CSV is multi-line. The function iterates through all rows and creates a separate output record for each. This is legitimate—your output can have a different number of records than your input.

**Data enrichment** involves combining your streaming data with reference data from another source. Perhaps you're ingesting user activity logs, and you want to attach user attributes from a DynamoDB table:

```python
import base64
import json
import boto3

dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table('UserProfiles')

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        payload = base64.b64decode(record['data']).decode('utf-8')
        event_data = json.loads(payload)
        
        # Enrich with user data from DynamoDB
        try:
            user_id = event_data.get('user_id')
            response = users_table.get_item(Key={'user_id': user_id})
            user_profile = response.get('Item', {})
            
            event_data['user_profile'] = {
                'name': user_profile.get('name'),
                'tier': user_profile.get('tier'),
                'region': user_profile.get('region')
            }
            
            enriched_json = json.dumps(event_data)
            encoded = base64.b64encode(enriched_json.encode('utf-8')).decode('utf-8')
            
            output.append({
                'recordId': record['recordId'],
                'result': 'Ok',
                'data': encoded
            })
        except Exception as e:
            # Log the error and drop the record
            print(f"Error enriching record {record['recordId']}: {str(e)}")
            output.append({
                'recordId': record['recordId'],
                'result': 'ProcessingFailed'
            })
    
    return {'records': output}
```

This pattern introduces error handling. If enrichment fails—perhaps the user doesn't exist in DynamoDB—you mark the record as `ProcessingFailed`. Firehose will retry the entire batch (more on retry behavior shortly).

**Filtering** is the simplest but often most valuable transformation. Perhaps you only care about certain record types, or you want to exclude test data from production:

```python
import base64
import json

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        payload = base64.b64decode(record['data']).decode('utf-8')
        data = json.loads(payload)
        
        # Only pass production events
        if data.get('environment') == 'production':
            output.append({
                'recordId': record['recordId'],
                'result': 'Ok',
                'data': record['data']  # Pass through unchanged
            })
        else:
            # Drop non-production events
            output.append({
                'recordId': record['recordId'],
                'result': 'Dropped'
            })
    
    return {'records': output}
```

Notice that when you're not transforming the data, you can pass the `data` field through as-is without re-encoding.

**PII redaction** protects sensitive information. If your event data contains credit card numbers, email addresses, or phone numbers, you might want to redact them before storing in S3:

```python
import base64
import json
import re

def redact_pii(data):
    """Redact common PII patterns"""
    # Redact email addresses
    data = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', 'REDACTED@REDACTED.COM', data)
    
    # Redact credit card numbers (simple pattern)
    data = re.sub(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', 'REDACTED', data)
    
    # Redact phone numbers
    data = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', 'REDACTED', data)
    
    return data

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        payload = base64.b64decode(record['data']).decode('utf-8')
        
        # Redact sensitive data
        redacted = redact_pii(payload)
        encoded = base64.b64encode(redacted.encode('utf-8')).decode('utf-8')
        
        output.append({
            'recordId': record['recordId'],
            'result': 'Ok',
            'data': encoded
        })
    
    return {'records': output}
```

In production, you'd likely use a more sophisticated PII detection library, but this illustrates the pattern.

### Retry Behavior and Failure Handling

Firehose's retry behavior is important to understand. When your Lambda function returns a record with `result: 'ProcessingFailed'`, Firehose treats it as a transformation error. The entire batch is retried. This is different from the `Dropped` status, which simply discards the record without retry.

Firehose retries the batch up to three times by default. Between retries, it backs off—waiting longer between each attempt. If all retries fail, or if your Lambda function throws an unhandled exception, Firehose needs a fallback. This is where the **data format conversion failure** destination comes in. You can configure an S3 backup bucket to receive records that failed transformation. These records are stored with metadata indicating they failed, so you can investigate and potentially reprocess them later.

This is a critical safety net. Without it, failing records would be silently dropped, and you'd lose data. With the backup bucket enabled, you have a record of what went wrong and can debug issues retrospectively.

Consider a scenario where your Lambda function calls an external API to enrich records, but the API goes down. Your first invocation times out and throws an exception. Firehose retries. It fails again. After three retries, Firehose sends the records to your backup S3 bucket with an error report. Later, when the API recovers, you can reprocess those records.

### Configuring IAM Permissions

Your Lambda function needs specific IAM permissions to operate within a Firehose transformation context. At minimum, it needs permissions for any AWS services it calls. If you're enriching from DynamoDB, you need `dynamodb:GetItem`. If you're calling Secrets Manager for API keys, you need `secretsmanager:GetSecretValue`. If you're writing logs (which you should be), you need `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents`.

But there's a often-overlooked permission: Firehose itself needs permission to invoke your Lambda function. This is configured via a resource-based policy on the Lambda function, which you might set via the AWS Console, AWS CLI, or infrastructure-as-code. Here's an example using the CLI:

```bash
aws lambda add-permission \
  --function-name MyFirehoseTransformer \
  --statement-id AllowFirehoseInvoke \
  --action lambda:InvokeFunction \
  --principal firehose.amazonaws.com
```

This grants the Firehose service permission to invoke your function. Without it, invocations fail silently (the error appears in Firehose's monitoring, but it's easy to miss).

For the function's execution role, attach a policy that grants the necessary permissions. If you're enriching from DynamoDB:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserProfiles"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

Be as specific as possible with resource ARNs. Avoid wildcards in production, even though they're tempting during development.

### End-to-End Example: Building a Production Transformer

Let's build a more realistic example that combines several patterns. Imagine you're ingesting e-commerce events from a mobile app. Events arrive as JSON, but they need to be enriched with customer tier information, and any events from test devices should be filtered out. Here's a production-ready implementation:

```python
import base64
import json
import boto3
import logging
from datetime import datetime

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
customers_table = dynamodb.Table('CustomerProfiles')

# Cache to reduce DynamoDB calls
customer_cache = {}
CACHE_TTL = 3600  # 1 hour

def get_customer_tier(customer_id):
    """Retrieve customer tier with caching"""
    if customer_id in customer_cache:
        cached_data = customer_cache[customer_id]
        if datetime.now().timestamp() - cached_data['timestamp'] < CACHE_TTL:
            return cached_data['tier']
    
    try:
        response = customers_table.get_item(Key={'customer_id': customer_id})
        tier = response.get('Item', {}).get('tier', 'unknown')
        
        # Update cache
        customer_cache[customer_id] = {
            'tier': tier,
            'timestamp': datetime.now().timestamp()
        }
        
        return tier
    except Exception as e:
        logger.error(f"Failed to retrieve customer tier for {customer_id}: {str(e)}")
        raise

def transform_record(record):
    """Transform a single record"""
    try:
        # Decode and parse
        payload = base64.b64decode(record['data']).decode('utf-8')
        event = json.loads(payload)
        
        # Filter: skip test events
        if event.get('is_test', False):
            return {
                'recordId': record['recordId'],
                'result': 'Dropped'
            }
        
        # Validate required fields
        if 'customer_id' not in event or 'event_type' not in event:
            logger.warning(f"Record {record['recordId']} missing required fields")
            return {
                'recordId': record['recordId'],
                'result': 'ProcessingFailed'
            }
        
        # Enrich with customer tier
        customer_id = event['customer_id']
        tier = get_customer_tier(customer_id)
        
        event['customer_tier'] = tier
        event['transformed_at'] = datetime.utcnow().isoformat()
        
        # Encode and return
        transformed_json = json.dumps(event)
        encoded = base64.b64encode(transformed_json.encode('utf-8')).decode('utf-8')
        
        return {
            'recordId': record['recordId'],
            'result': 'Ok',
            'data': encoded
        }
    
    except Exception as e:
        logger.error(f"Error transforming record {record['recordId']}: {str(e)}", exc_info=True)
        return {
            'recordId': record['recordId'],
            'result': 'ProcessingFailed'
        }

def lambda_handler(event, context):
    """Main handler"""
    output = []
    
    for record in event.get('records', []):
        transformed = transform_record(record)
        output.append(transformed)
    
    logger.info(f"Transformed {len(output)} records")
    
    return {'records': output}
```

This example demonstrates several best practices. First, it includes comprehensive error handling and logging. Every exception is caught and logged, and the record is marked as failed so Firehose knows something went wrong. Second, it uses caching to reduce DynamoDB calls—fetching customer tier repeatedly for the same customer is wasteful. Third, it validates input data before processing, rejecting records that lack required fields. Fourth, it uses descriptive variable names and comments that explain the "why" behind each step.

When you deploy this function, set environment variables or use AWS Secrets Manager for any configuration that might change. For instance, the table name could be an environment variable, allowing you to use the same function across development, staging, and production environments with different backing tables.

### Testing Your Transformation Function

Before deploying to production, test your function thoroughly. Create mock Firehose events and invoke your function locally or in a test Lambda environment. Here's a test event you can use:

```python
test_event = {
    "records": [
        {
            "recordId": "test-record-1",
            "approximateArrivalTimestamp": 1545084650987,
            "data": base64.b64encode(json.dumps({
                "customer_id": "cust-123",
                "event_type": "purchase",
                "amount": 99.99,
                "is_test": False
            }).encode('utf-8')).decode('utf-8')
        },
        {
            "recordId": "test-record-2",
            "approximateArrivalTimestamp": 1545084711166,
            "data": base64.b64encode(json.dumps({
                "customer_id": "cust-456",
                "event_type": "view",
                "is_test": True
            }).encode('utf-8')).decode('utf-8')
        }
    ]
}

# Invoke locally
result = lambda_handler(test_event, None)
print(json.dumps(result, indent=2))
```

You should see that the first record is transformed with the customer tier added, and the second record is dropped because it's marked as a test event.

### Monitoring and Troubleshooting

After deployment, monitor your transformation function using CloudWatch. Firehose publishes metrics like `DeliveryToS3.Success`, `DeliveryToS3.DataFreshness`, and `IncomingRecords`. Create custom metrics in your Lambda function to track transformation outcomes—how many records were dropped, how many failed, how many succeeded. This visibility is invaluable when issues arise.

Common issues include Lambda timeout errors (increase timeout if your transformations are slow), Lambda memory limits (increase memory allocation, which also increases CPU), and cold starts (Lambda functions experience latency on first invocation; pre-warm frequently-used functions if latency is critical). If your function calls external APIs, ensure those calls have timeouts and retry logic—don't let a slow API block your entire batch.

### Conclusion

Transforming records in Kinesis Data Firehose with Lambda is a powerful pattern for building data pipelines that are both flexible and efficient. By understanding the invocation contract—records in, results out, all base64-encoded—you can implement transformations that parse, enrich, filter, and redact data in flight. The key is to respect the constraints: watch your payload sizes, handle failures gracefully, and test thoroughly before production. With proper IAM permissions, comprehensive logging, and a backup S3 bucket for failed records, you have a robust foundation for ETL at scale. The patterns covered here—CSV conversion, enrichment, filtering, and PII redaction—represent the vast majority of real-world transformations, so you're well-equipped to tackle most requirements you'll encounter.
