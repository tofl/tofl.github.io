---
title: "Handling Race Conditions in SQS Processing: Idempotency and Duplicate Detection"
---

## Handling Race Conditions in SQS Processing: Idempotency and Duplicate Detection

If you've spent any time building distributed systems on AWS, you've probably encountered a scenario that feels deceptively simple: a message arrives in an SQS queue, gets processed, and everything should be fine. But what happens when your consumer crashes mid-processing? What if the network hiccup causes the visibility timeout to expire before your DeleteMessage call succeeds? Suddenly, that message is back in the queue, ready to be processed again—and if your application isn't prepared, you'll process it twice.

This is where understanding SQS delivery guarantees and implementing proper idempotency becomes critical. In this article, we'll explore why duplicates happen, how to detect and handle them safely, and when you truly need exactly-once semantics versus when at-least-once is perfectly acceptable.

### Understanding SQS Delivery Guarantees

Amazon SQS offers two queue types, each with different delivery semantics: Standard queues and FIFO queues. The distinction between them is fundamental to understanding how to architect resilient message-processing systems.

SQS Standard queues provide an **at-least-once delivery guarantee**. This means your message will definitely reach a consumer at least once, but it might arrive multiple times. The queue doesn't guarantee uniqueness or order. This design choice enables the high throughput and scalability that makes SQS so useful for many applications—the trade-off is that consumers must be prepared to handle duplicates gracefully.

SQS FIFO queues, by contrast, provide exactly-once processing with guaranteed ordering. Messages are delivered once and in the order they were sent (within a message group). While FIFO queues eliminate the duplicate problem at the infrastructure level, they come with lower throughput limits and slightly higher latency, making them suitable for scenarios where order and exactness genuinely matter.

For most applications, Standard queues are the right choice, which means you need to build idempotency into your application layer. This is the realistic scenario you'll encounter in production, and it's where the real engineering challenges lie.

### Why Duplicates Occur: Common Race Conditions

Understanding the mechanics of how duplicates arise helps you appreciate why idempotency is necessary rather than just a nice-to-have.

When a consumer receives a message from an SQS Standard queue, the message becomes invisible to other consumers for a period called the **visibility timeout** (default 30 seconds, configurable from 0 to 12 hours). The message remains in the queue until the consumer explicitly deletes it. If the consumer crashes or fails to delete the message before the visibility timeout expires, the message becomes visible again and another consumer can process it.

Consider this sequence: a consumer retrieves a message and begins processing it. The processing involves updating a database, calling an external API, and performing some business logic. Midway through, the consumer's instance crashes. The visibility timeout elapses, and the message reappears in the queue. A second consumer (or the same one after restart) picks up the same message and processes it again. If the consumer had already updated the database before crashing, you now have duplicate data.

Another scenario: the consumer successfully processes the message and calls `DeleteMessage`, but the network connection drops before the response is acknowledged. The consumer thinks the message is deleted, but from SQS's perspective, the deletion never registered. When the visibility timeout expires, the message reprocesses.

A third scenario involves asynchronous consumers behind an auto-scaling group. During a deployment or scale-down event, consumers are terminated. Messages they had received but not yet processed get recycled back into the queue when their visibility timeout expires.

These aren't edge cases—they're normal operational realities of distributed systems. The question isn't whether duplicates will occur, but how you'll handle them when they do.

### Implementing Idempotency with a Deduplication Store

The most reliable approach to handling duplicates is to make your message processing **idempotent**. An idempotent operation produces the same result whether it's called once or a hundred times. If you process the same message twice, the final state should be identical to processing it once.

The classic pattern for this is to maintain a deduplication store—a record of messages you've already processed. Before processing a message, you check if you've seen it before. If you have, you skip processing and delete the message. If you haven't, you process it and record that you've processed it.

Let's implement this pattern using DynamoDB as the deduplication store. DynamoDB is ideal here because it offers strong consistency, atomic operations, and is highly available.

```python
import json
import boto3
import uuid
from datetime import datetime, timedelta

sqs = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')
dedup_table = dynamodb.Table('message_deduplication')

QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'

def process_message(message_body):
    """
    Business logic for processing the message.
    Should be idempotent—calling it multiple times with the same input
    should produce the same result.
    """
    parsed = json.loads(message_body)
    user_id = parsed['user_id']
    action = parsed['action']
    
    # Example: record user action in DynamoDB
    users_table = dynamodb.Table('users')
    users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET last_action = :action, updated_at = :now',
        ExpressionAttributeValues={
            ':action': action,
            ':now': datetime.utcnow().isoformat()
        }
    )
    
    return True

def has_been_processed(message_id):
    """
    Check if we've already processed a message with this ID.
    """
    try:
        response = dedup_table.get_item(Key={'message_id': message_id})
        return 'Item' in response
    except Exception as e:
        print(f"Error checking deduplication store: {e}")
        # In case of error, assume we haven't processed it and try again
        # This is safer than assuming we have
        return False

def record_processed_message(message_id, ttl_seconds=86400):
    """
    Record that we've processed a message. Include a TTL so old entries
    are cleaned up automatically.
    """
    ttl = int((datetime.utcnow() + timedelta(seconds=ttl_seconds)).timestamp())
    dedup_table.put_item(
        Item={
            'message_id': message_id,
            'processed_at': datetime.utcnow().isoformat(),
            'ttl': ttl
        }
    )

def process_queue_message(message):
    """
    Safely process a single message from the queue with deduplication.
    """
    message_id = message['MessageId']
    receipt_handle = message['ReceiptHandle']
    body = message['Body']
    
    # Check if already processed
    if has_been_processed(message_id):
        print(f"Message {message_id} already processed, skipping")
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        return
    
    try:
        # Process the message
        process_message(body)
        
        # Record that we've processed it
        record_processed_message(message_id)
        
        # Delete from queue
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        print(f"Message {message_id} processed successfully")
        
    except Exception as e:
        print(f"Error processing message {message_id}: {e}")
        # Don't delete the message; let it go back into the queue on timeout
        # The next attempt might succeed
        raise

def poll_queue():
    """
    Continuously poll the queue and process messages.
    """
    while True:
        messages = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=20  # Long polling
        )
        
        if 'Messages' not in messages:
            print("No messages, waiting...")
            continue
        
        for message in messages['Messages']:
            try:
                process_queue_message(message)
            except Exception as e:
                print(f"Unhandled error processing message: {e}")

if __name__ == '__main__':
    poll_queue()
```

This implementation has several important characteristics. First, the deduplication check and message processing are separated. We check the dedup store before doing any work. Second, we use a TTL attribute on the DynamoDB items so the table doesn't grow indefinitely—after 24 hours, old entries are automatically deleted. Third, if an exception occurs during processing, we don't record the message as processed and don't delete it from the queue, allowing it to be retried.

One subtle but critical detail: we check for duplication *before* processing, not after. This protects against the scenario where processing is expensive or has side effects. We avoid wasting resources or creating unwanted side effects from duplicate processing.

### The Idempotency Tradeoff: Consistency vs. Simplicity

However, there's a subtle race condition lurking in the above implementation. Between checking the dedup store and recording that we've processed the message, another consumer might check the same dedup store, see that the message hasn't been processed, and start processing it concurrently. This race window is typically small, but in high-throughput scenarios, it can happen.

To truly prevent this, you'd use atomic operations. With DynamoDB, you can leverage conditional writes:

```python
def process_queue_message_atomic(message):
    """
    Atomically check if processed and mark as processed in one operation.
    """
    message_id = message['MessageId']
    receipt_handle = message['ReceiptHandle']
    body = message['Body']
    
    try:
        # Attempt to record the message as processed atomically
        # If the message_id already exists, this will fail
        dedup_table.put_item(
            Item={
                'message_id': message_id,
                'processed_at': datetime.utcnow().isoformat(),
                'ttl': int((datetime.utcnow() + timedelta(seconds=86400)).timestamp())
            },
            ConditionExpression='attribute_not_exists(message_id)'
        )
        
        # If we reach here, we successfully claimed this message for processing
        print(f"Claimed message {message_id} for processing")
        
        # Process it
        process_message(body)
        
        # Delete from queue
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        print(f"Message {message_id} processed successfully")
        
    except dedup_table.meta.client.exceptions.ConditionalCheckFailedException:
        # Another consumer is processing (or has processed) this message
        print(f"Message {message_id} is being processed by another consumer")
        # Don't delete; let the other consumer handle it
        
    except Exception as e:
        print(f"Error processing message {message_id}: {e}")
        raise
```

This approach uses DynamoDB's `ConditionExpression` to ensure that we only proceed if the message hasn't been recorded before. This is atomic at the DynamoDB level—either the write succeeds, or it fails, but not both. This eliminates the race condition between the check and the record.

### Comparing Standard Queues to FIFO Queues

If idempotency feels like extra work, you're right—it is. This is why SQS FIFO queues exist. FIFO queues handle deduplication for you automatically using a 5-minute deduplication window.

When you send a message to a FIFO queue, you provide a `MessageDeduplicationId`. SQS remembers this ID for 5 minutes. If an identical message (same content and deduplication ID) arrives within that window, SQS detects it as a duplicate and discards it, returning it as if it were processed without redelivering it to consumers.

```python
# Sending to a FIFO queue with deduplication
sqs = boto3.client('sqs')
FIFO_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue.fifo'

response = sqs.send_message(
    QueueUrl=FIFO_QUEUE_URL,
    MessageBody=json.dumps({'user_id': '12345', 'action': 'login'}),
    MessageGroupId='user-12345',  # FIFO requires a group ID for ordering
    MessageDeduplicationId='user-login-attempt-20240115-143022'  # Dedup ID
)
```

FIFO queues also provide exactly-once processing semantics and message ordering. Messages are processed in the order they were sent within a message group. This is invaluable for scenarios like financial transactions, inventory updates, or any workflow where order and uniqueness matter.

However, FIFO queues have throughput limits: up to 300 transactions per second (or 3,000 with high-throughput FIFO queues, at additional cost). Standard queues scale to tens of thousands of messages per second. For high-volume applications, this difference is significant.

The decision between Standard and FIFO queues should reflect your actual requirements. If you're processing user events, clickstreams, or other high-volume, order-independent operations, Standard queues with application-level idempotency are usually the right choice. If you're processing financial transactions, order-dependent workflows, or other scenarios where duplicates are genuinely unacceptable, FIFO queues are worth the throughput trade-off.

### Testing Idempotency

Building idempotency is one thing; verifying it works is another. Here's a testing pattern that helps validate your idempotency implementation:

```python
import pytest
from unittest.mock import patch, MagicMock
import json

def test_duplicate_message_not_processed_twice(mocker):
    """
    Verify that processing the same message ID twice
    doesn't result in duplicate work.
    """
    # Mock the business logic to track calls
    mock_process = mocker.patch('__main__.process_message')
    
    # Mock SQS and DynamoDB
    mock_sqs = mocker.patch('boto3.client')
    mock_dynamodb = mocker.patch('boto3.resource')
    
    # Create two messages with the same ID
    message_id = 'test-message-123'
    receipt_handle_1 = 'handle-1'
    receipt_handle_2 = 'handle-2'
    
    message_body = json.dumps({'user_id': '12345', 'action': 'login'})
    
    message_1 = {
        'MessageId': message_id,
        'ReceiptHandle': receipt_handle_1,
        'Body': message_body
    }
    
    message_2 = {
        'MessageId': message_id,
        'ReceiptHandle': receipt_handle_2,
        'Body': message_body
    }
    
    # Process both messages
    process_queue_message(message_1)
    process_queue_message(message_2)
    
    # The business logic should only be called once
    mock_process.assert_called_once()
    
    # Both messages should be deleted from the queue
    # (The second one without processing)
    assert mock_sqs.return_value.delete_message.call_count == 2

def test_failed_processing_leaves_message_in_queue(mocker):
    """
    Verify that if processing fails, the message is not deleted
    and will be retried.
    """
    # Mock process_message to raise an exception
    mocker.patch('__main__.process_message', side_effect=Exception('Processing failed'))
    mocker.patch('__main__.record_processed_message')
    
    mock_sqs = mocker.patch('boto3.client')
    
    message = {
        'MessageId': 'test-123',
        'ReceiptHandle': 'handle-123',
        'Body': json.dumps({'user_id': '12345', 'action': 'login'})
    }
    
    with pytest.raises(Exception):
        process_queue_message(message)
    
    # delete_message should not have been called
    mock_sqs.return_value.delete_message.assert_not_called()

def test_deduplication_with_atomic_write(mocker):
    """
    Verify that concurrent duplicate processing is prevented
    by atomic DynamoDB writes.
    """
    # Mock DynamoDB to simulate a ConditionalCheckFailedException
    # on the second write attempt
    mock_table = mocker.MagicMock()
    
    # First call succeeds, second call raises exception
    mock_table.put_item.side_effect = [
        None,  # First write succeeds
        Exception('ConditionalCheckFailedException')  # Second write fails
    ]
    
    mocker.patch('boto3.resource').return_value.Table.return_value = mock_table
    
    message_id = 'test-123'
    
    # Simulate two concurrent attempts to process the same message
    # The second should detect it's already claimed
    try:
        record_processed_message(message_id)  # Should succeed
        record_processed_message(message_id)  # Should fail
    except Exception as e:
        assert 'ConditionalCheckFailedException' in str(e)
```

These tests verify several critical behaviors: that duplicate messages aren't processed twice, that failed processing leaves messages in the queue for retry, and that atomic writes prevent concurrent processing. When you run these tests, you gain confidence that your idempotency logic actually works.

### Monitoring and Observability

Implementing idempotency is only half the battle; you also need visibility into whether it's working correctly. Monitor these key metrics:

Track the number of duplicate messages detected and skipped. If this number is high relative to your overall message volume, it indicates either frequent consumer crashes or a misconfigured visibility timeout. A small number of duplicates is normal; a large number signals a problem.

Monitor the time between a message being sent and being successfully deleted from the queue. This includes processing time plus SQS latency. If this latency is growing, it might indicate that your deduplication store is becoming a bottleneck, or that your consumers are overloaded.

Track failures in the deduplication store itself. If DynamoDB is throttled or unavailable, your idempotency logic fails. You need to know about this immediately.

Use structured logging to record when you detect a duplicate and when you process a new message. This helps you reconstruct what happened if something goes wrong.

```python
import logging
import json
from pythonjsonlogger import jsonlogger

logger = logging.getLogger()
handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.setLevel(logging.INFO)

def process_queue_message_with_logging(message):
    """
    Process with comprehensive logging for observability.
    """
    message_id = message['MessageId']
    receipt_handle = message['ReceiptHandle']
    body = message['Body']
    
    log_context = {
        'message_id': message_id,
        'timestamp': datetime.utcnow().isoformat()
    }
    
    if has_been_processed(message_id):
        logger.info('Duplicate message detected', extra={
            **log_context,
            'action': 'skip',
            'reason': 'already_processed'
        })
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        return
    
    try:
        start_time = datetime.utcnow()
        process_message(body)
        duration = (datetime.utcnow() - start_time).total_seconds()
        
        record_processed_message(message_id)
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        
        logger.info('Message processed successfully', extra={
            **log_context,
            'action': 'process',
            'duration_seconds': duration
        })
        
    except Exception as e:
        logger.error('Error processing message', extra={
            **log_context,
            'action': 'process',
            'error': str(e),
            'error_type': type(e).__name__
        })
        raise
```

Structured logging makes it easy to query and analyze patterns in your logs using CloudWatch Insights or similar tools.

### Choosing Your Deduplication Strategy

We've covered DynamoDB as a deduplication store, but it's not the only option. For lower-volume scenarios, you might use ElastiCache (Redis) for faster in-memory lookups, trading durability for speed. For applications where a false positive (thinking you've processed a message when you haven't) is acceptable, you could use a Bloom filter, trading accuracy for minimal storage. For very high-throughput scenarios, you might use local memory caches with eventual consistency to DynamoDB.

The right choice depends on your throughput requirements, cost constraints, consistency guarantees, and the consequences of getting deduplication wrong. A financial system needs strong consistency; a clickstream processor can tolerate rare duplicates. Make this decision explicitly, not by accident.

### When Exactly-Once Really Matters

It's tempting to say "I need exactly-once semantics" for everything. In practice, exactly-once is expensive in distributed systems. It requires coordination, consistency checks, and careful error handling. It's slower and less scalable than at-least-once with idempotency.

Exactly-once truly matters when the cost of a duplicate is high: financial transactions, inventory decrements, billing events. For these scenarios, FIFO queues are worth the throughput trade-off. For everything else—logging events, updating user preferences, sending notifications—at-least-once with idempotent processing is the pragmatic choice.

Be honest about which category your use case falls into. If you're processing user analytics, you don't need the guarantees (or the cost) of exactly-once. If you're processing payments, you do.

### Conclusion

Handling duplicates in SQS is fundamental to building reliable distributed systems. Understanding why duplicates occur—visibility timeouts expiring, consumer crashes, network failures—is the foundation. Building idempotency into your message processing, whether through a deduplication store like DynamoDB or by designing truly idempotent operations, ensures your system handles duplicates gracefully.

You have options: implement application-level deduplication with Standard queues for high throughput, or use FIFO queues for built-in exactly-once semantics when order and uniqueness are non-negotiable. Neither is universally better—the right choice depends on your requirements and constraints.

As you design message-driven architectures, make idempotency a first-class concern, not an afterthought. Test it rigorously. Monitor it carefully. The resilience of your system depends on getting this right.
