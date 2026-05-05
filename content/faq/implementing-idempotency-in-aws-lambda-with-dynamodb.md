---
title: "Implementing Idempotency in AWS Lambda with DynamoDB"
---

## Implementing Idempotency in AWS Lambda with DynamoDB

The phrase "exactly once" in distributed systems is a siren song—beautiful in theory, nearly impossible in practice. In the real world, your Lambda functions will be invoked multiple times for the same logical request. Network timeouts, retries from upstream services, and even accidental duplicate messages in SQS all conspire to create scenarios where the same operation gets attempted again and again. Without proper idempotency handling, you risk charging customers twice, creating duplicate orders, or corrupting critical data.

Idempotency is the property that an operation produces the same result no matter how many times it's performed. Building idempotent Lambda functions isn't optional—it's fundamental to writing reliable serverless applications. In this article, we'll explore how to implement idempotency in AWS Lambda using DynamoDB, covering everything from idempotency keys to conditional writes to practical patterns for real-world scenarios.

### Understanding Idempotency in Serverless Architectures

Before we dive into implementation, let's establish what we're actually solving. Consider a typical Lambda function triggered by an API Gateway request that processes a payment. The function executes successfully, charges the customer's account, and begins returning the success response—but the network connection drops before the client receives the response. The client retries the request. Without idempotency safeguards, you've just charged the customer twice for a single purchase.

Idempotency works by ensuring that if we've already processed a particular request, we return the cached result instead of executing the operation again. The key insight is that we need three things: a way to uniquely identify the request (the idempotency key), a place to store the result, and logic to detect whether we've seen this key before.

This is where DynamoDB enters the picture. It's purpose-built for this pattern—it offers fast, consistent reads and writes, and crucially, it supports conditional writes that let us detect duplicates atomically. Combined with Time-To-Live (TTL), it becomes a cost-effective idempotency store that doesn't require you to manage infrastructure or worry about cleanup.

### Generating and Managing Idempotency Keys

The idempotency key is your entry point. It must be globally unique within a reasonable time window and deterministic for the same logical request. Different trigger sources generate keys differently.

For API Gateway-triggered functions, you'll want to encourage clients to generate a UUID and pass it via a custom header. A common convention is `Idempotency-Key` or `X-Idempotent-ID`. Here's how you might extract and validate it:

```python
import uuid
import json

def lambda_handler(event, context):
    # Extract idempotency key from headers
    idempotency_key = event['headers'].get('Idempotency-Key')
    
    if not idempotency_key:
        # Generate one if client didn't provide it
        idempotency_key = str(uuid.uuid4())
    
    # Validate format (basic check)
    if not is_valid_uuid(idempotency_key):
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid Idempotency-Key format'})
        }
    
    # Continue with processing
    return process_payment(idempotency_key, event)
```

For asynchronous sources like SQS or EventBridge, the situation differs slightly. SQS messages already have a unique `messageId`, but it's only unique within the queue and doesn't survive redrives to dead-letter queues. You might use the combination of `messageId` and a message attribute, or generate a key from the business data itself (for example, the combination of customer ID and order ID).

EventBridge events include a `detail-id` field that can serve as an idempotency key, though you often want to combine it with other context for true uniqueness.

```python
def extract_idempotency_key_from_sqs(event):
    # Use messageId as the primary source
    message_id = event['Records'][0]['messageId']
    receipt_handle = event['Records'][0]['receiptHandle']
    
    # Create a composite key that survives retries
    idempotency_key = f"{message_id}#{receipt_handle}"
    return idempotency_key

def extract_idempotency_key_from_eventbridge(event):
    # EventBridge provides detail-id for deduplication
    return event['detail-id']
```

The key principle here is consistency: the same logical request must always generate the same idempotency key. If you're charging a customer for an order, the key should remain identical whether the function runs on the first attempt or the fifth retry.

### DynamoDB as an Idempotency Store

DynamoDB is ideally suited for storing idempotency records because of its ability to handle high throughput, its support for conditional writes, and its native TTL capabilities. Your idempotency table might look like this:

```
Table Name: idempotency-store
Primary Key: idempotencyKey (String)
Attributes:
  - idempotencyKey (PK)
  - status (String): IN_PROGRESS | COMPLETED | FAILED
  - result (String): JSON-encoded result
  - createdAt (Number): Timestamp
  - ttl (Number): Unix timestamp for auto-deletion
```

The magic of using DynamoDB for idempotency lies in conditional writes. When your function first encounters an idempotency key, you write a record with status `IN_PROGRESS`. If a duplicate request arrives, the conditional write fails because the item already exists—and you then check the status to determine whether to return the cached result or wait for the original request to complete.

Here's a concrete example:

```python
import boto3
import json
import time
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('idempotency-store')

def store_idempotency_record(idempotency_key, status, result=None, ttl_seconds=3600):
    """
    Store or update an idempotency record in DynamoDB.
    """
    ttl = int(time.time()) + ttl_seconds
    
    try:
        table.put_item(
            Item={
                'idempotencyKey': idempotency_key,
                'status': status,
                'result': json.dumps(result) if result else None,
                'createdAt': Decimal(str(time.time())),
                'ttl': ttl
            },
            ConditionExpression='attribute_not_exists(idempotencyKey)'
        )
        return True
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        # This key has been seen before
        return False

def get_idempotency_record(idempotency_key):
    """
    Retrieve an existing idempotency record.
    """
    response = table.get_item(Key={'idempotencyKey': idempotency_key})
    return response.get('Item')
```

The `attribute_not_exists(idempotencyKey)` condition is critical. It ensures that only the first request with a given key can write the initial record. Subsequent requests will fail this condition and know they're seeing a duplicate.

### Handling Request States: In-Progress, Completed, and Failed

Your idempotency implementation must gracefully handle three states for a request: in-progress, completed, and failed. Each requires different logic.

When a request first arrives, you attempt to write an `IN_PROGRESS` record. If this succeeds, you proceed with the actual business logic. If it fails due to the conditional check, you retrieve the existing record and check its status. If it's `COMPLETED`, you return the cached result immediately. If it's `IN_PROGRESS`, you're in a delicate situation—the original request may still be executing, or it may have crashed before updating the status. You might choose to wait briefly and retry, or you might return a 409 Conflict response to the client.

When the business logic completes successfully, you update the record from `IN_PROGRESS` to `COMPLETED` and store the result. If the business logic fails, you can either delete the record (allowing retries) or mark it as `FAILED` depending on whether the error is retryable.

```python
def process_payment_idempotently(idempotency_key, payment_data):
    """
    Process a payment with idempotency safeguards.
    """
    # Step 1: Attempt to claim this idempotency key
    is_first_request = store_idempotency_record(idempotency_key, 'IN_PROGRESS')
    
    if not is_first_request:
        # We've seen this key before
        record = get_idempotency_record(idempotency_key)
        
        if record['status'] == 'COMPLETED':
            # Return cached result
            return json.loads(record['result'])
        elif record['status'] == 'IN_PROGRESS':
            # Original request still executing or crashed
            # Wait briefly, then check again
            time.sleep(1)
            record = get_idempotency_record(idempotency_key)
            if record['status'] == 'COMPLETED':
                return json.loads(record['result'])
            else:
                # Still in progress; return conflict
                raise Exception('Request still being processed')
        elif record['status'] == 'FAILED':
            # Previous attempt failed; allow retry
            # Delete the record or update to IN_PROGRESS
            table.delete_item(Key={'idempotencyKey': idempotency_key})
            return process_payment_idempotently(idempotency_key, payment_data)
    
    # Step 2: This is the first request; execute business logic
    try:
        result = charge_payment(payment_data)
        
        # Step 3: Mark as completed with result
        table.update_item(
            Key={'idempotencyKey': idempotency_key},
            UpdateExpression='SET #status = :status, #result = :result',
            ExpressionAttributeNames={'#status': 'status', '#result': 'result'},
            ExpressionAttributeValues={
                ':status': 'COMPLETED',
                ':result': json.dumps(result)
            }
        )
        
        return result
    except Exception as e:
        # Mark as failed (or delete to allow retries)
        table.update_item(
            Key={'idempotencyKey': idempotency_key},
            UpdateExpression='SET #status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'FAILED'}
        )
        raise
```

Notice how we're using conditional writes to prevent race conditions. The initial `attribute_not_exists()` check ensures only one request can claim the key. Subsequent updates are unconditional because we're already certain we own the record.

### AWS Lambda Powertools Idempotency Utility

Writing idempotency logic from scratch is error-prone and repetitive. AWS provides Lambda Powertools, an open-source library that abstracts idempotency handling for Python, TypeScript, and Java. Using it simplifies your code significantly.

In Python, the Idempotency utility handles the key management, DynamoDB interactions, and state transitions for you:

```python
from aws_lambda_powertools.utilities.idempotency import idempotent
from aws_lambda_powertools.utilities.idempotency.dynamodb import DynamoDBPersistence

persistence_layer = DynamoDBPersistence(table_name='idempotency-store')

@idempotent(persistence_store=persistence_layer)
def process_payment(payment_data):
    """
    This function is now idempotent.
    The decorator handles duplicate detection and result caching.
    """
    return charge_customer(payment_data)

def lambda_handler(event, context):
    # Extract the idempotency key from headers or event
    idempotency_key = event['headers'].get('Idempotency-Key')
    
    # Process with idempotency
    # The decorator will use a default key if not provided,
    # but passing explicit keys is more reliable
    result = process_payment(payment_data=event['body'])
    
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

For TypeScript, the pattern is similar:

```typescript
import { IdempotencyConfig, idempotentHandler } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistence } from '@aws-lambda-powertools/idempotency/dynamodb';

const dynamoDBPersistence = new DynamoDBPersistence({
  tableName: 'idempotency-store'
});

const config = new IdempotencyConfig({
  eventKeyJmespath: 'headers.Idempotency-Key'  // Extract key from headers
});

export const processPayment = idempotentHandler(
  async (event) => {
    return await chargeCustomer(event);
  },
  {
    persistence: dynamoDBPersistence,
    config
  }
);
```

Lambda Powertools handles the entire lifecycle: extracting or generating the idempotency key, managing the DynamoDB records, catching duplicate requests, and caching results. It also supports configuration options like maximum age for cached results, whether to idempotently process exceptions, and custom key generation logic.

The library is particularly valuable because it bakes in best practices. It automatically handles TTL configuration, manages the state transitions correctly, and provides sensible defaults for timeouts and retries.

### Cost Optimization with TTL

Idempotency records can accumulate quickly, especially in high-throughput systems. A Lambda function processing thousands of requests per day will generate thousands of idempotency records daily. Without cleanup, your DynamoDB table grows indefinitely and your storage costs spiral.

DynamoDB's Time-To-Live (TTL) feature automatically deletes items after a specified timestamp. For idempotency records, this is perfect—you choose a TTL that matches your idempotency window (typically 24 hours, though shorter or longer depending on your use case).

When you write an idempotency record, you calculate the TTL as the current Unix timestamp plus your desired retention window:

```python
import time

ttl_seconds = 86400  # 24 hours

def store_idempotency_record(idempotency_key, status, result=None):
    ttl = int(time.time()) + ttl_seconds
    
    table.put_item(
        Item={
            'idempotencyKey': idempotency_key,
            'status': status,
            'result': json.dumps(result) if result else None,
            'ttl': ttl  # DynamoDB will delete this after the TTL timestamp
        },
        ConditionExpression='attribute_not_exists(idempotencyKey)'
    )
```

Then, in the DynamoDB console, enable TTL on the table by setting the TTL attribute name to `ttl`. DynamoDB handles the rest—items automatically expire and are removed, and you're not charged for the deletion.

The tradeoff is obvious: shorter TTLs reduce storage costs but increase the window where duplicate requests might be processed if they arrive after the record expires. Longer TTLs provide more protection but cost more. A 24-hour window is common because it aligns with typical retry logic and accommodates most legitimate retry scenarios.

### Real-World Patterns: SQS, EventBridge, and API Gateway

The idempotency pattern adapts to different trigger sources. Let's walk through concrete examples for three common scenarios.

**API Gateway Pattern**

For synchronous API requests, you typically want the client to provide the idempotency key:

```python
import json
import uuid

def lambda_handler(event, context):
    # Extract or generate key
    idempotency_key = event['headers'].get('Idempotency-Key', str(uuid.uuid4()))
    
    try:
        # Process with idempotency safeguards
        result = process_payment_idempotently(idempotency_key, json.loads(event['body']))
        
        return {
            'statusCode': 200,
            'body': json.dumps(result),
            'headers': {'Idempotency-Key': idempotency_key}  # Echo back the key
        }
    except DuplicateInProgressException:
        # Request is still being processed
        return {
            'statusCode': 409,
            'body': json.dumps({'error': 'Request already in progress'})
        }
```

**SQS Pattern**

For SQS-triggered functions, leverage the message ID combined with visibility timeout logic:

```python
def lambda_handler(event, context):
    for record in event['Records']:
        # Use messageId as the idempotency key
        message_id = record['messageId']
        receipt_handle = record['receiptHandle']
        
        try:
            result = process_order_idempotently(
                idempotency_key=message_id,
                order_data=json.loads(record['body'])
            )
            
            # Delete message after successful processing
            sqs = boto3.client('sqs')
            sqs.delete_message(
                QueueUrl='https://sqs.region.amazonaws.com/account/queue',
                ReceiptHandle=receipt_handle
            )
        except AlreadyProcessedException:
            # This message has been processed; delete it
            sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        except Exception as e:
            # Processing failed; let message visibility timeout expire
            # and let SQS retry
            print(f"Failed to process {message_id}: {e}")
            # Don't delete; message will be retried
```

**EventBridge Pattern**

For EventBridge-driven workflows, use the `detail-id` field if available, or create a composite key from the event source and business entity:

```python
def lambda_handler(event, context):
    # EventBridge provides detail-id for deduplication
    idempotency_key = event.get('detail-id', str(uuid.uuid4()))
    
    # Or create a composite key from business data
    # idempotency_key = f"{event['source']}#{event['detail']['customerId']}"
    
    try:
        result = process_event_idempotently(
            idempotency_key=idempotency_key,
            event_detail=event['detail']
        )
        
        # Send success event
        eventbridge = boto3.client('events')
        eventbridge.put_events(
            Entries=[{
                'Source': 'custom.application',
                'DetailType': 'OrderProcessed',
                'Detail': json.dumps(result)
            }]
        )
    except Exception as e:
        # Send failure event; EventBridge can retry
        eventbridge.put_events(
            Entries=[{
                'Source': 'custom.application',
                'DetailType': 'ProcessingFailed',
                'Detail': json.dumps({'error': str(e)})
            }]
        )
```

Each pattern respects the characteristics of its trigger source. API Gateway functions use client-provided keys. SQS messages leverage the built-in message ID. EventBridge events use the detail-ID. The idempotency logic itself remains consistent—it's the key extraction that differs.

### Handling Edge Cases and Race Conditions

Even with careful implementation, edge cases lurk. Consider this scenario: your function retrieves an `IN_PROGRESS` record, waits a moment, and rechecks. The original request completed and updated the record to `COMPLETED`, but the network is slow, and the second request's update query lags. You might read an old version of the record and incorrectly conclude the original is still processing.

This is where DynamoDB's strong consistency comes in handy. By default, `get_item()` operations use eventual consistency, which can return stale data. For idempotency checks where you need certainty, use strongly consistent reads:

```python
def get_idempotency_record(idempotency_key):
    """
    Retrieve an idempotency record with strong consistency.
    """
    response = table.get_item(
        Key={'idempotencyKey': idempotency_key},
        ConsistentRead=True  # Strongly consistent
    )
    return response.get('Item')
```

The tradeoff is slightly higher latency and consumed capacity, but for idempotency checks, this cost is worth the accuracy.

Another edge case: what if the function crashes after writing the `COMPLETED` record but before returning to the caller? The next invocation with the same key will correctly find the cached result and return it. The caller will receive the correct response, even though they've technically retried. This is exactly the behavior we want.

However, watch out for side effects outside of DynamoDB. If your function sends an email, charges a credit card, or calls an external API before updating the idempotency record, and the function crashes, a retry will execute that side effect again. Always update the idempotency record to `COMPLETED` as the last step, or ensure your external interactions are themselves idempotent.

### Monitoring and Observability

Idempotency handling adds complexity, and you need visibility into how it's functioning. Instrument your code with CloudWatch Logs to track idempotency events:

```python
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def process_payment_idempotently(idempotency_key, payment_data):
    is_first_request = store_idempotency_record(idempotency_key, 'IN_PROGRESS')
    
    if is_first_request:
        logger.info(f"Processing new request with key {idempotency_key}")
    else:
        record = get_idempotency_record(idempotency_key)
        if record['status'] == 'COMPLETED':
            logger.info(f"Returning cached result for key {idempotency_key}")
            return json.loads(record['result'])
        else:
            logger.warning(f"Duplicate request in-flight for key {idempotency_key}")
    
    # ... proceed with business logic ...
```

Create CloudWatch metrics or dashboards tracking the ratio of new requests to duplicate requests. A high duplicate rate might indicate retry storms or misconfigured clients. Monitor DynamoDB consumed capacity to ensure your idempotency table isn't throttling.

Lambda Powertools includes built-in metrics support; it can emit custom metrics about idempotency hits and misses to CloudWatch automatically, providing visibility without manual instrumentation.

### Conclusion

Idempotency is not an optional feature in distributed systems—it's a foundational requirement. By combining DynamoDB's conditional writes, TTL for automatic cleanup, and AWS Lambda Powertools for simplified implementation, you can build robust idempotent Lambda functions that handle retries gracefully without corrupting state or charging customers twice.

The pattern is straightforward: generate or extract an idempotency key from the request, attempt to claim it in DynamoDB with a conditional write, and either proceed with business logic or return the cached result. DynamoDB's strong consistency guarantees and TTL capabilities make it ideal for this workload, and Lambda Powertools eliminates boilerplate.

As you design serverless applications, treat idempotency not as an afterthought but as a core architectural concern from the start. Determine how each Lambda function will generate its idempotency key, establish the appropriate TTL window for your use case, and choose whether to implement idempotency manually or via Lambda Powertools. Your systems will be more resilient, your data more consistent, and your customers more confident in the reliability of your service.
