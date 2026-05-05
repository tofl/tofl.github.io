---
title: "Designing Idempotent REST APIs on API Gateway with Idempotency Keys"
---

## Designing Idempotent REST APIs on API Gateway with Idempotency Keys

Building distributed systems means accepting that things will sometimes go wrong. Network timeouts, transient errors, and service disruptions are not hypothetical concerns—they're inevitable. When they occur, clients often retry their requests. The question your API must answer is simple yet profound: what happens when a client sends the same request twice?

Idempotency is the answer. An idempotent operation produces the same result regardless of how many times it's executed. For financial transactions, order creation, or any state-changing operation, idempotency isn't a nice-to-have feature—it's a cornerstone of building reliable systems. In this guide, we'll explore how to design idempotent REST APIs fronted by AWS API Gateway, using idempotency keys as our mechanism for preventing duplicate processing.

### Understanding Idempotency in HTTP

Before diving into implementation, let's ground ourselves in HTTP semantics. The HTTP specification actually gives us some guarantees about certain methods, though many developers overlook them.

HTTP defines methods like GET, HEAD, and OPTIONS as inherently idempotent. Execute them ten times, and you'll get the same result each time. PUT and DELETE are also idempotent by design—updating a resource to a specific state or deleting it ten times should have the same net effect as doing it once. The problem child is POST, which the HTTP spec explicitly does not guarantee as idempotent. POST is the method we use to create resources, and therein lies the danger: if a client's request to create an order times out and they retry, you could end up creating the order twice.

This distinction matters because it shapes how you architect your solution. GET requests don't need idempotency mechanisms. But POST requests—especially those that modify state—absolutely do.

### The Idempotency Key Pattern

The idempotency key pattern emerged from real-world payment processing systems where duplicate charges were catastrophic. The core idea is elegantly simple: the client generates a unique identifier (typically a UUID) and includes it in the request headers. The server stores this key along with the response, and when the same key arrives again, it returns the cached response instead of reprocessing the request.

This pattern has found its way into RFC standards and is widely adopted by companies building payment systems, financial platforms, and any system handling critical transactions. The standard header name is `Idempotency-Key`, though some systems use variations like `X-Idempotency-Key` for legacy reasons.

The workflow looks like this: a client generates a UUID and includes it with their POST request. Your API Gateway receives the request and validates the header's presence. The backend Lambda function checks if this key has been processed before by looking it up in a cache layer (typically DynamoDB). If the key exists and processing is complete, return the stored response immediately. If the key doesn't exist, process the request normally, store the key with the response, and return it to the client. If the key exists but processing is still in-flight, return a status indicating that processing hasn't completed—this prevents the client from assuming the request failed when it's actually still being processed.

### HTTP Methods and Idempotency Considerations

Your API design must be intentional about which methods truly need idempotency protection. Let's clarify the landscape.

GET requests retrieve data without modification. They're naturally idempotent and should never change server state. API Gateway can cache GET responses at its edge, and clients can safely retry them without risk. No special idempotency logic is needed.

DELETE requests remove a resource. They're idempotent because deleting a non-existent resource has the same net effect as deleting an existing one—the resource is gone. However, if you want to distinguish between "resource was already deleted" and "resource was just deleted," you might want to track idempotency keys anyway. A DELETE returning 204 No Content on the second attempt is different from returning 404 Not Found, and your API contract matters.

PUT requests replace a resource entirely. They're idempotent because setting a resource to a specific state multiple times yields the same result. Like DELETE, you may want to track idempotency keys if your API semantics require distinguishing between "we just updated it" and "it was already in that state."

POST requests create new resources or trigger actions. They're the critical case. A POST to create an order should create exactly one order, not two, even if the client retries due to timeout.

PATCH requests partially update a resource. They're notoriously non-idempotent because a partial update applied twice is generally not the same as applying it once. Idempotency keys are essential for PATCH operations.

### Storing Idempotency Keys in DynamoDB

Now that we understand the pattern, let's talk implementation. DynamoDB is an excellent choice for storing idempotency key metadata because it's fast, serverless, and integrates seamlessly with Lambda.

Your DynamoDB table should have a simple structure: the idempotency key itself is the partition key. You'll also want to store the response body, HTTP status code, headers if necessary, and a timestamp indicating when the request was processed. Additionally, you should store a `status` field tracking whether processing is in-flight, completed, or failed.

Here's a reasonable schema:

```
TableName: IdempotencyStore
Partition Key: idempotencyKey (String)
Attributes:
  - idempotencyKey: The client-provided UUID (Partition Key)
  - status: "PENDING", "COMPLETED", or "FAILED"
  - responseBody: The response to return (String/JSON)
  - statusCode: HTTP status (Number)
  - createdAt: Timestamp of initial request (Number)
  - TTL: Expiration timestamp in seconds since epoch (Number)
```

The TTL attribute is particularly important. Idempotency keys should eventually expire so you're not storing them forever. For most use cases, 24 hours is a reasonable TTL. Payment systems might keep them longer, while real-time systems might use shorter windows. DynamoDB's built-in TTL feature automatically deletes items when they expire.

### Implementing Idempotency in Lambda

Let's walk through a practical implementation. Assume we're building an order creation API. Here's how your Lambda function might handle idempotency:

```python
import json
import uuid
import boto3
from datetime import datetime, timedelta
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
idempotency_table = dynamodb.Table('IdempotencyStore')

def lambda_handler(event, context):
    # Extract the idempotency key from headers
    idempotency_key = event.get('headers', {}).get('Idempotency-Key')
    
    # For non-idempotent methods, skip this logic
    if event['httpMethod'] != 'POST':
        return process_request(event)
    
    # If no idempotency key provided, generate a warning
    if not idempotency_key:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Idempotency-Key header required for POST requests'})
        }
    
    # Check if we've already processed this key
    existing = check_idempotency_key(idempotency_key)
    
    if existing:
        if existing['status'] == 'COMPLETED':
            # Return the cached response
            return {
                'statusCode': int(existing['statusCode']),
                'body': existing['responseBody'],
                'headers': {'X-Idempotency-Status': 'cached'}
            }
        elif existing['status'] == 'PENDING':
            # Request is still being processed
            return {
                'statusCode': 409,
                'body': json.dumps({'error': 'Request is still being processed'}),
                'headers': {'Retry-After': '5'}
            }
        elif existing['status'] == 'FAILED':
            # Replay the failure
            return {
                'statusCode': int(existing['statusCode']),
                'body': existing['responseBody'],
                'headers': {'X-Idempotency-Status': 'cached-failure'}
            }
    
    # Mark this key as pending
    store_idempotency_key(idempotency_key, 'PENDING')
    
    try:
        # Process the request
        response_data = process_request(event)
        status_code = response_data.get('statusCode', 200)
        
        # Store the successful response
        store_idempotency_key(
            idempotency_key,
            'COMPLETED',
            response_data.get('body'),
            status_code
        )
        
        return response_data
        
    except Exception as e:
        # Store the failure
        error_response = json.dumps({'error': str(e)})
        store_idempotency_key(
            idempotency_key,
            'FAILED',
            error_response,
            500
        )
        
        return {
            'statusCode': 500,
            'body': error_response
        }

def check_idempotency_key(key):
    """Retrieve existing idempotency key record if it exists"""
    try:
        response = idempotency_table.get_item(Key={'idempotencyKey': key})
        return response.get('Item')
    except Exception as e:
        print(f"Error checking idempotency key: {e}")
        return None

def store_idempotency_key(key, status, response_body=None, status_code=200):
    """Store or update an idempotency key record"""
    expiration = int((datetime.now() + timedelta(hours=24)).timestamp())
    
    try:
        item = {
            'idempotencyKey': key,
            'status': status,
            'createdAt': int(datetime.now().timestamp()),
            'TTL': expiration
        }
        
        if response_body is not None:
            item['responseBody'] = response_body
            item['statusCode'] = status_code
        
        idempotency_table.put_item(Item=item)
    except Exception as e:
        print(f"Error storing idempotency key: {e}")

def process_request(event):
    """Your actual business logic goes here"""
    body = json.loads(event.get('body', '{}'))
    
    # Example: Create an order
    order_id = str(uuid.uuid4())
    
    # Your database writes, external API calls, etc. would go here
    
    return {
        'statusCode': 201,
        'body': json.dumps({
            'orderId': order_id,
            'status': 'created',
            'amount': body.get('amount')
        })
    }
```

This implementation handles the core scenarios: checking for existing keys, managing the PENDING/COMPLETED/FAILED lifecycle, and returning cached responses when appropriate.

### Using Lambda Powertools for Idempotency

Writing idempotency logic from scratch works, but Lambda Powertools—AWS's open-source utility library—provides a battle-tested implementation that eliminates boilerplate and adds sophisticated features. If you're already using Lambda Powertools for logging or tracing, integrating its Idempotency utility is straightforward.

Here's how to use it:

```python
from aws_lambda_powertools.utilities.idempotency import idempotent
from aws_lambda_powertools.utilities.idempotency.dynamodb import DynamoDBPersistence
from aws_lambda_powertools.utilities.idempotency.exceptions import IdempotencyKeyError
import json

# Configure persistence layer
persistence_layer = DynamoDBPersistence(table_name='IdempotencyStore')

@idempotent(persistence_store=persistence_layer)
def create_order(order_data):
    """This function will only execute once per unique idempotency key"""
    # Your business logic
    order_id = generate_order_id()
    
    # Database writes, API calls, etc.
    save_order_to_database(order_id, order_data)
    
    return {
        'orderId': order_id,
        'status': 'created'
    }

def lambda_handler(event, context):
    # Extract the idempotency key from the request
    idempotency_key = event.get('headers', {}).get('Idempotency-Key')
    
    if not idempotency_key and event['httpMethod'] == 'POST':
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Idempotency-Key header required'})
        }
    
    # Set the idempotency key for the decorator
    from aws_lambda_powertools.utilities.idempotency import IdempotencyConfig
    
    try:
        body = json.loads(event.get('body', '{}'))
        result = create_order(body)
        
        return {
            'statusCode': 201,
            'body': json.dumps(result)
        }
    except IdempotencyKeyError as e:
        # This indicates a problem with idempotency key handling
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid or duplicate request'})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
```

Lambda Powertools handles many concerns automatically: it tracks in-flight requests, manages the TTL, handles race conditions, and even provides options for hashing large payloads. It also integrates seamlessly with its tracing and logging utilities, giving you visibility into idempotency behavior.

### Configuring API Gateway for Idempotency

API Gateway itself doesn't enforce idempotency—that responsibility falls to your backend. However, you should configure API Gateway to be transparent about idempotency operations and avoid adding its own retry logic on top.

API Gateway has request/response models and validation features you can use to enforce the presence of the Idempotency-Key header on POST requests. Define a request model that requires the header, and attach it to your POST method.

Additionally, be mindful of API Gateway's timeout behavior. By default, API Gateway times out after 30 seconds. If your idempotent operation takes longer, the client might retry, hitting your PENDING state logic. Consider increasing the timeout for operations you know are slower, or implementing long-polling/webhook patterns for very long-running operations.

For error handling, ensure that transient errors (5xx responses) are indeed transient. If your Lambda throws an unhandled exception, API Gateway returns a 502 Bad Gateway. The client should retry this. But if the request actually succeeded and you're returning a 500 due to a response serialization error, the retry will re-execute the operation—idempotency keys save you here.

### Handling the In-Flight Scenario

One nuance many developers miss is the in-flight request scenario. Imagine a client sends a request with an idempotency key. Your Lambda starts processing it. Midway through, the client times out and retries with the same key. What should happen?

Returning the completed response immediately isn't safe if processing hasn't finished—the client might interpret the incomplete response as an error and retry again. Returning a 409 Conflict with a Retry-After header is the standard approach. It tells the client: "Your request is being processed; wait and try again later."

This is where storing the `status` field in DynamoDB becomes critical. When you receive a request with an existing key in PENDING status, you have a few options:

You can wait for the original request to complete and return its result. This works but adds latency and complexity to lock management.

You can return a 409 Conflict and advise the client to retry. This is simpler and standard, though it shifts responsibility to the client to implement backoff.

You can return a 409 with a `Retry-After` header suggesting when to retry. This gives the client guidance without forcing it to wait.

Most production systems use the third approach. If your operations are generally fast (sub-second), the overhead is minimal. If operations routinely take longer, implementing a wait-and-return pattern might be worth the complexity.

### Monitoring Idempotency with CloudWatch Metrics

You've built idempotency into your API, but how do you know if it's actually preventing duplicates? CloudWatch metrics provide visibility into your idempotency patterns.

Within your Lambda function, emit custom metrics to track idempotency behavior:

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def record_idempotency_metric(status, operation_name):
    """Record an idempotency metric to CloudWatch"""
    cloudwatch.put_metric_data(
        Namespace='CustomAPI/Idempotency',
        MetricData=[
            {
                'MetricName': 'IdempotencyStatus',
                'Value': 1,
                'Unit': 'Count',
                'Dimensions': [
                    {
                        'Name': 'Operation',
                        'Value': operation_name
                    },
                    {
                        'Name': 'Status',
                        'Value': status  # 'cache_hit', 'cache_miss', 'pending'
                    }
                ]
            }
        ]
    )
```

Call this function whenever you hit different idempotency paths:

```python
if existing and existing['status'] == 'COMPLETED':
    record_idempotency_metric('cache_hit', 'CreateOrder')
    # Return cached response
else:
    record_idempotency_metric('cache_miss', 'CreateOrder')
    # Process request
```

These metrics let you create dashboards showing:

The rate of duplicate requests hitting your API. High rates might indicate client-side retry logic issues or network problems affecting your customer base.

The distribution of cache hits versus misses. Consistently high cache hit rates might mean customers are retrying frequently, which could indicate latency or reliability issues.

The rate of requests still in-flight. Spikes in PENDING status might indicate a bottleneck in your processing pipeline.

### Best Practices and Considerations

Building robust idempotent APIs requires thinking beyond just the mechanics. Here are practices that separate robust implementations from fragile ones.

Always validate that the idempotency key is present for state-changing operations. Make this a hard requirement, not a courtesy. If a client doesn't provide a key, reject the request. This forces clients to be responsible.

Be consistent about what constitutes a unique operation. Some APIs include the request body in the idempotency check, meaning the same key with different body payloads is treated as a new request. Others treat the key alone as sufficient. Document your choice clearly.

Set reasonable TTLs. Too short, and retries after the TTL expires will be reprocessed. Too long, and you accumulate storage costs. 24 hours is sensible for most operations; payment systems often use 30 days or longer.

Handle the failure case thoughtfully. If processing fails, should you replay the failure or reprocess the request on retry? For transient errors, replaying the failure can be problematic. Consider storing the error details and making a judgment call during replay, or allowing clients to explicitly request reprocessing.

Don't assume idempotency keys are UUIDs. They might be—that's common—but allow clients to use any opaque string. Your code shouldn't care.

Test failure modes. Test what happens when DynamoDB is unavailable. Does your API fail-open (process anyway) or fail-closed (reject the request)? Each has tradeoffs. Test race conditions where two requests with the same key arrive simultaneously.

Combine idempotency with proper transaction handling in your data layer. Idempotency at the API level doesn't prevent issues if your database operations aren't atomic. If creating an order requires writing to multiple tables, ensure those writes are transactional or idempotency keys alone won't save you.

### Real-World Example: Payment Processing

Let's tie this together with a realistic scenario. You're building a payment API. A customer initiates a $100 charge. The payment processing takes 3 seconds, but the client's connection is flaky. They time out after 2 seconds and retry.

Without idempotency, you'd charge them twice. With it:

Request 1 arrives with `Idempotency-Key: abc123`. You create a PENDING record in DynamoDB and start processing the payment through your processor. The actual charge takes 2 seconds.

Request 2 arrives with the same key. You check DynamoDB, find the PENDING record, and return a 409 Conflict with `Retry-After: 3`.

The client waits 3 seconds and retries as Request 3 with the same key. Now you find a COMPLETED record with the original response (charge ID, timestamp, amount). You return it immediately.

The customer is charged exactly once, and everything is transparent and auditable.

### Conclusion

Idempotent APIs are not a luxury—they're essential infrastructure for any system handling critical operations. The idempotency key pattern, combined with a persistent store like DynamoDB and thoughtful API Gateway configuration, gives you the tools to build APIs that are resilient to network failures and client retries without sacrificing correctness.

Whether you implement idempotency manually or lean on Lambda Powertools, the principles remain the same: generate unique identifiers for each request intent, track their processing state, and return cached responses when the same intent arrives again. Add CloudWatch monitoring to understand your idempotency patterns, and you've built a system your customers can rely on.

As you design your APIs, think about which operations truly need idempotency protection, implement it consistently, and test the failure modes. Your future self—debugging a duplicate charge complaint at 2 AM—will thank you for the foresight.
