---
title: "Lambda Polling from SQS FIFO Queues: Group-Based Processing and Concurrency"
---

## Lambda Polling from SQS FIFO Queues: Group-Based Processing and Concurrency

When you need guaranteed message ordering and exactly-once processing in your AWS applications, SQS FIFO (First-In-First-Out) queues become indispensable. But the moment you attach a Lambda function to a FIFO queue via an event source mapping, you enter a different operational paradigm than Standard queues. The ordering guarantees that make FIFO so valuable come with a fundamental constraint: Lambda processes messages from a single message group sequentially, which dramatically affects your throughput expectations and deployment strategy.

This constraint isn't a bug—it's by design. Understanding how and why it works this way, and knowing how to plan around it, is essential for building reliable event-driven architectures on AWS.

### Understanding FIFO Message Groups and Sequential Processing

Before diving into Lambda's behavior, let's clarify what message groups actually are. In SQS FIFO queues, every message must include a message group ID. All messages with the same group ID are guaranteed to be processed in the exact order they were sent, and they will never be processed in parallel. This is the core contract that FIFO offers.

When Lambda polls a FIFO queue, it respects this contract religiously. The event source mapping will pull a batch of messages from the queue, but here's the crucial detail: it only pulls messages from a single message group at a time. If your batch contains ten messages and they all belong to group "order-123", Lambda receives all ten. But if those ten messages are split across five different groups, Lambda will only retrieve messages from one group in that particular poll cycle.

This means that even if you configure a large batch size, the practical concurrency of your Lambda execution is constrained by the number of distinct message groups you're using. If you have only three message groups in your entire queue, you can have at most three concurrent Lambda executions processing those groups—no matter how many messages are waiting.

Think of it like a restaurant kitchen where each customer's order (a message group) must be prepared sequentially by one chef, but you can have multiple chefs working on different customers' orders simultaneously. If you only have three customers, you only need three chefs active at any moment, even if each customer has ten dishes to prepare.

### Why Lambda Restricts Itself to One Group Per Poll

The reason for this design is straightforward: parallelism within a single message group would violate FIFO ordering guarantees. If Lambda attempted to process two messages from the same group in parallel, there's no way to ensure that the earlier message completes before the later one. Network latency, function execution speed variance, and retry logic could all conspire to process them out of order.

By limiting each Lambda invocation to messages from a single group, AWS ensures that your function processes group messages sequentially, maintaining order. Once that invocation completes (or fails), the next invocation can pick up the next batch of messages from that group or move to another group entirely.

This architectural choice also simplifies your function code. You don't need to implement complex locking mechanisms or worry about concurrent modifications to shared state within a message group. The runtime guarantees that only one Lambda instance is processing messages from a given group at any moment.

### Batch Configuration for FIFO Queues

When you create an event source mapping between Lambda and a FIFO queue, you'll configure two key parameters: batch size and batching window.

The **batch size** parameter specifies the maximum number of messages Lambda will retrieve in a single poll. For FIFO queues, this can range from 1 to 10. If you set it to 10, Lambda will attempt to retrieve up to ten messages—but remember, they must all be from the same message group. If the queue has messages from multiple groups, Lambda will only grab from one group up to the batch size limit.

The **batching window** (also called maximum batching window duration) allows Lambda to wait up to a specified number of seconds before invoking your function, even if the batch hasn't filled up. This is useful when message volume is low. For example, if you set a batch size of 10 and a batching window of 5 seconds, Lambda will wait up to 5 seconds for more messages to arrive, hoping to hit the batch size. But if a message arrives and there's already been a 5-second wait since the last invocation, it will invoke immediately regardless of batch size.

For FIFO queues, the practical recommendation is to keep batch sizes modest—somewhere between 5 and 10—and enable a batching window of 5 to 10 seconds. This balances latency with efficiency. A batch size of 1 defeats the purpose of batching and increases your Lambda invocation count (and costs), while a batching window that's too long can introduce unnecessary latency into message processing.

Here's what the event source mapping configuration might look like in practice:

```json
{
  "EventSourceMappings": [
    {
      "EventSourceArn": "arn:aws:sqs:us-east-1:123456789012:my-queue.fifo",
      "FunctionName": "my-processor",
      "Enabled": true,
      "BatchSize": 10,
      "MaximumBatchingWindowInSeconds": 5,
      "FunctionResponseTypes": ["ReportBatchItemFailure"]
    }
  ]
}
```

The `FunctionResponseTypes` parameter set to `ReportBatchItemFailure` is particularly important for FIFO. This tells Lambda that your function will return information about which specific messages failed processing, rather than treating the entire batch as a success-or-failure unit. This becomes critical when you need fine-grained control over retries and visibility into which messages caused issues.

### Handling Messages in Your Lambda Function

Your Lambda function will receive a SQS event containing the batch of messages. Each message in the batch includes the message group ID, which you can access if needed. Here's a typical handler structure in Python:

```python
import json
import boto3

sqs = boto3.client('sqs')

def lambda_handler(event, context):
    failed_message_ids = []
    
    for record in event['Records']:
        try:
            message_group_id = record['attributes']['MessageGroupId']
            message_body = json.loads(record['body'])
            
            # Process your message here
            print(f"Processing message from group {message_group_id}: {message_body}")
            process_order(message_body)
            
        except Exception as e:
            print(f"Error processing message: {str(e)}")
            failed_message_ids.append(record['messageId'])
    
    # Return information about failed messages
    return {
        'batchItemFailures': [
            {'itemId': message_id} for message_id in failed_message_ids
        ]
    }
```

The key insight here is that even though you're processing multiple messages in a single invocation, they're all from the same group. You can maintain local state across the batch knowing that ordering is preserved within that group. If you were processing messages from different groups in parallel (which you're not), maintaining such state would be dangerous.

When a message fails processing, you should add it to the `batchItemFailures` list. Lambda will return the message to the queue for retry. Messages you don't include in the failure list are considered successfully processed and deleted from the queue.

### The Throughput Ceiling and Concurrency Implications

This is where many developers encounter surprises. If you're processing high volumes of messages and relying on FIFO ordering, you need to understand your throughput ceiling.

Your maximum throughput is determined by: (number of message groups) × (messages processed per second per group). If you have ten message groups and each Lambda invocation processes ten messages in two seconds, you're looking at approximately fifty messages per second total. Adding more Lambda concurrency won't help—you're already saturated.

By contrast, a Standard queue has no such constraint. Multiple Lambda instances can work in parallel on completely independent messages. Standard queues can easily scale to thousands of messages per second with appropriate concurrency settings.

This is why choosing between FIFO and Standard is one of the most impactful architectural decisions you'll make. FIFO ordering comes at the cost of sequential processing. If you truly need that ordering, the throughput ceiling is acceptable. If you don't, Standard queues offer dramatically better scalability.

Consider a real-world example: you're processing e-commerce orders. If you use one message group per customer, and each customer places orders slowly, you might have thousands of message groups. In this case, you'll have high concurrency and good throughput because Lambda can process many groups in parallel. But if you use one message group for all orders (to process them in strict chronological order), you've created a bottleneck.

### Reserved Concurrency and Lambda Scaling

Lambda's reserved concurrency setting works with FIFO queues, but not quite the way many developers expect. Reserved concurrency doesn't guarantee that your function will always be available—it guarantees that your function won't consume more than the reserved amount of your account's concurrent executions.

For FIFO event source mappings, you should think about reserved concurrency in terms of your expected message group count. If you have five message groups and each processes at roughly the same rate, reserving 5 or 10 concurrent Lambda executions is reasonable. Setting a reserved concurrency of 100 won't help if you only have five message groups.

AWS also provides a **ScalingConcurrency** parameter for event source mappings that allows Lambda to automatically scale the number of concurrent function instances based on queue depth. This is useful for FIFO queues because it lets you handle traffic spikes without manual intervention. The scaling is based on the event source's metrics and the Lambda service's capacity constraints.

### Monitoring Group-Level Lag with CloudWatch

Understanding how your FIFO queue is performing requires watching the right metrics. The standard SQS metrics—queue depth, message age, and processing rate—give you a high-level view. But for FIFO with Lambda, you should also monitor **group-level lag**.

Group-level lag isn't a built-in CloudWatch metric, but you can construct it by tracking the age of the oldest message in each group. You can do this in a few ways:

The most practical approach is to emit custom CloudWatch metrics from your Lambda function. When you process a message batch, calculate how long those messages have been sitting in the queue and publish that as a metric. You can include the message group ID as a dimension:

```python
import json
from datetime import datetime
from time import time
import boto3

cloudwatch = boto3.client('cloudwatch')

def lambda_handler(event, context):
    for record in event['Records']:
        message_group_id = record['attributes']['MessageGroupId']
        
        # Calculate how long the message has been in the queue
        sent_timestamp = int(record['attributes']['SentTimestamp']) / 1000
        current_time = time()
        message_age_seconds = current_time - sent_timestamp
        
        # Publish a custom metric
        cloudwatch.put_metric_data(
            Namespace='MyApplication',
            MetricData=[
                {
                    'MetricName': 'GroupMessageAge',
                    'Value': message_age_seconds,
                    'Unit': 'Seconds',
                    'Dimensions': [
                        {
                            'Name': 'MessageGroupId',
                            'Value': message_group_id
                        }
                    ]
                }
            ]
        )
```

By tracking this metric over time, you'll see if certain message groups are falling behind. A group that consistently has very old messages might indicate that your function is processing messages from that group slowly, or that messages aren't arriving frequently enough to form efficient batches.

You should also watch the Lambda duration metric filtered by the FIFO queue event source. Unusually long invocation times might suggest that messages are getting stuck or that your processing logic has regressed.

### When FIFO Is Worth the Cost

The ordering guarantee and throughput limitations of FIFO make it suitable for specific use cases. You should choose FIFO when the ordering of message processing is genuinely critical to your business logic.

Financial transactions are the classic example. If you're processing account debits and credits, order matters. You want to ensure that a debit request is processed before a credit request for the same account to maintain correct balances. This is why many fintech companies use FIFO for transaction processing.

E-commerce order fulfillment is another strong case. If a customer places an order and then immediately cancels it, you want the cancellation processed after the order, not before. Using the customer ID as the message group ID ensures sequential processing of that customer's events.

Workflow orchestration is another valid use case. If you have a multi-step process where each step must complete before the next begins, FIFO ensures that each step's messages are processed in order.

However, you should be honest about whether ordering is truly required or just seems convenient. Many use cases can tolerate some level of out-of-order processing if you handle idempotency correctly. A user's API requests to read data don't need ordering. Status update notifications don't need ordering. Log aggregation doesn't need ordering.

If you're using FIFO primarily for deduplication (ensuring the same message isn't processed twice), Standard queues combined with idempotent processing logic might serve you better and offer superior scalability.

### Standard Queues as the Default

Unless you have a specific requirement for ordered processing, Standard queues should be your default choice. They offer significantly better scalability, higher throughput, and simpler concurrency management. Multiple Lambda functions can process Standard queue messages in parallel with no artificial constraints.

Standard queues are also more cost-effective in most scenarios because you can achieve high throughput without worrying about message group bottlenecks. Your Lambda functions can scale horizontally, and you don't need to engineer around ordering constraints.

The trade-off is that Standard queues offer at-least-once delivery semantics, meaning a message might be delivered and processed more than once under certain failure conditions. Your function must be idempotent—processing the same message twice should produce the same result as processing it once. This is actually a best practice anyway, even with FIFO, because network failures and Lambda retries can still cause duplicate processing.

### Dead-Letter Queues and FIFO

When using FIFO queues with Lambda event source mappings, dead-letter queue (DLQ) handling deserves special attention. If a message fails processing and reaches its maximum retry count, it moves to the DLQ. While in the source queue, messages from that group are blocked until the problematic message is resolved.

This is actually a safety feature. If message-5 in group-A fails repeatedly, messages 6, 7, and 8 won't be processed until message-5 is resolved. This maintains ordering integrity. In a Standard queue, your other messages would continue processing, but in FIFO, the entire group is halted.

You should monitor your FIFO DLQ closely and implement alarming for messages that land there. A single toxic message in a FIFO queue can stall an entire message group. Implement a dead-letter queue handler that investigates why messages are failing, fixes the underlying issue, and redeploys if necessary.

### Practical Configuration Recommendations

Based on the patterns we've discussed, here are some practical recommendations for configuring Lambda event source mappings with FIFO queues:

Set your batch size to 10 unless you have specific latency requirements that demand smaller batches. Processing more messages per invocation is generally more efficient and reduces invocation costs. If you need lower latency, use a smaller batch size combined with a short batching window.

Enable the `ReportBatchItemFailure` response type. This gives you granular control over which messages failed and should be retried, rather than failing the entire batch. It's more resilient and provides better visibility into problems.

Configure a batching window of 5 to 10 seconds. This balances latency with throughput efficiency. In low-traffic scenarios, waiting a few seconds for more messages to arrive is usually acceptable and reduces invocation count.

Use distinct message groups strategically. If you're partitioning by customer ID, ensure the distribution is relatively even. If 90% of messages belong to a single customer, you've effectively created a Standard queue with one concurrent processor.

Implement custom CloudWatch metrics to track group-level lag, as we discussed earlier. This gives you visibility into whether certain groups are falling behind and helps you identify bottlenecks early.

Set up alarms on DLQ depth and message age. Any message reaching your DLQ is a red flag that requires investigation.

### Conclusion

Lambda's integration with SQS FIFO queues enforces sequential processing of messages within each group—a constraint that's fundamental to maintaining FIFO ordering guarantees. This means your throughput ceiling is determined by message group count and processing speed per group, not by Lambda concurrency limits or queue size.

Understanding this constraint is critical for making architectural decisions. FIFO queues are valuable when ordering is genuinely required, but they come with a throughput cost. For most use cases, Standard queues with idempotent processing offer superior scalability and simplicity.

When you do choose FIFO, configure your event source mapping thoughtfully, monitor group-level lag, implement robust DLQ handling, and design your message groups to avoid bottlenecks. With these practices in place, you'll build reliable event-driven systems that maintain both correctness and reasonable throughput.
