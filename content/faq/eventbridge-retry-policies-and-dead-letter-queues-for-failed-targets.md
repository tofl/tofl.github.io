---
title: "EventBridge Retry Policies and Dead-Letter Queues for Failed Targets"
---

## EventBridge Retry Policies and Dead-Letter Queues for Failed Targets

Event-driven architectures promise decoupling and scalability, but they also introduce new challenges around failure handling. What happens when your Lambda function crashes? What if your target service is temporarily unavailable? In a synchronous system, you'd get an immediate error and could handle it on the spot. In an asynchronous event-driven system, failures can be silent and devastating if you don't plan for them.

Amazon EventBridge is remarkably good at making event routing feel effortless, but that simplicity can mask critical decisions you need to make about resilience. By default, EventBridge will retry failed invocations automatically, and it will eventually give up and discard the event—unless you've configured somewhere for those dead events to go. This article walks you through the mechanisms EventBridge provides for handling failures: retry policies that let you control how long and how hard EventBridge fights to deliver your events, and dead-letter queues that catch what falls through the cracks.

### Understanding EventBridge's Default Retry Behavior

When you create an EventBridge rule and point it at a target, you're establishing a promise: "deliver this event to that target." But promises get broken. Network timeouts happen. Services go down. Lambda functions hit concurrency limits. When a target fails to acknowledge successful delivery, EventBridge doesn't just give up immediately. Instead, it follows a retry policy.

By default, EventBridge retries failed events for up to 24 hours, attempting delivery up to 185 times. Think of this as EventBridge saying: "I believe in getting this done. I'll keep trying for a full day." This default is actually quite generous and works well for many use cases, especially when you're dealing with temporary service disruptions. The retry mechanism uses exponential backoff with jitter, meaning the time between attempts increases over time and includes some randomness to prevent the thundering herd problem where many EventBridge instances retry simultaneously.

However, 24 hours and 185 attempts might not align with your specific business requirements. Some applications need events delivered within seconds or minutes. Others can tolerate much longer delays if it means eventual consistency. EventBridge gives you the tools to adjust these parameters to match your actual needs.

### Configuring Maximum Event Age and Maximum Retry Attempts

The retry policy for any EventBridge target is configured through two key parameters: maximum event age and maximum retry attempts. These work together to establish a window during which EventBridge will attempt delivery.

**Maximum event age** specifies how long an event remains eligible for retry, measured in seconds from when the event was generated. If an event reaches this age without successful delivery, EventBridge stops retrying it, regardless of how many attempts remain. The default is 3600 seconds (one hour), but you can set it anywhere from 60 seconds to 86400 seconds (24 hours). This is useful when you have events that become stale or irrelevant after a certain period.

**Maximum retry attempts** specifies the maximum number of times EventBridge will try to deliver the event to a particular target. The default is 185 attempts, but you can reduce this to anywhere between 0 and 185. Setting this to 0 means EventBridge won't retry at all—it's a single shot. Setting it to 2 means EventBridge will try three times total (the initial attempt plus two retries).

Consider a practical scenario: you're processing user signup events and sending a welcome email via a Lambda function that calls an email service. If that email service is down, you might want EventBridge to retry aggressively for 30 minutes (1800 seconds) with up to 20 attempts, then move on. After 30 minutes, if the email service still isn't responding, holding onto that event is just wasting resources. You'd configure maximum event age to 1800 and maximum retry attempts to 20.

To configure these parameters when creating or updating an EventBridge rule target, you specify them in the target's retry policy. If you're using the AWS Management Console, you'll find these options in the "Retry policy" section when creating a target. Programmatically, via the AWS CLI or SDKs, they're properties of the `RetryPolicy` object.

Here's an example using the AWS CLI to update a rule target with a custom retry policy:

```bash
aws events put-targets \
  --rule my-signup-rule \
  --targets \
  "Id"="1",\
  "Arn"="arn:aws:lambda:us-east-1:123456789012:function:send-welcome-email",\
  "RetryPolicy"="{MaximumEventAge=1800,MaximumRetryAttempts=20}"
```

This command configures the Lambda target to have a 30-minute maximum event age and up to 20 retry attempts. EventBridge will respect whichever limit is reached first.

### Attaching Dead-Letter Queues to EventBridge Targets

Here's where the real safety net comes in: a dead-letter queue (DLQ). When an event exhausts its retry attempts or reaches its maximum age without successful delivery, it doesn't simply vanish. If you've configured a DLQ, EventBridge sends that failed event there instead, preserving the original event payload for analysis, debugging, or manual intervention.

A DLQ is typically an Amazon SQS queue, though EventBridge also supports SNS topics as dead-letter destinations. SQS is the more common choice because it's designed for reliable message queuing and gives you tools to examine what went wrong and potentially replay events.

Attaching a DLQ to a target is straightforward. When you create or update a target, you specify a `DeadLetterConfig` with the ARN of the SQS queue where failed events should be sent:

```bash
aws events put-targets \
  --rule my-signup-rule \
  --targets \
  "Id"="1",\
  "Arn"="arn:aws:lambda:us-east-1:123456789012:function:send-welcome-email",\
  "RetryPolicy"="{MaximumEventAge=1800,MaximumRetryAttempts=20}",\
  "DeadLetterConfig"="{Arn=arn:aws:sqs:us-east-1:123456789012:my-dlq}"
```

When EventBridge sends an event to the DLQ, it includes the original event payload, giving you complete context for debugging. The event in the DLQ is a standard SQS message, so you can consume it using SQS polling, Lambda event source mappings, or any other SQS integration.

### IAM Permissions for EventBridge to Write to the DLQ

Here's a detail that trips up many developers: EventBridge needs explicit IAM permission to send messages to your SQS DLQ. Without the right permissions, EventBridge will silently fail to write to the queue, leaving you wondering where your failed events went.

The IAM role that EventBridge assumes (which is typically the execution role associated with your event bus, or a specific role you attach to the target) must have permission to call `sqs:SendMessage` on the DLQ queue. Here's a minimal policy document that grants this permission:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:my-dlq"
    }
  ]
}
```

If you're using resource-based policies (which is common with SQS queues), you might instead attach a policy to the queue itself that allows the EventBridge service principal to send messages. The exact approach depends on your infrastructure setup, but the principle is the same: EventBridge needs permission.

### Real-World Example: Lambda Target with Transient Errors

Let's walk through a concrete scenario to bring all these pieces together. Imagine you have an EventBridge rule that triggers whenever an order is placed. The rule targets a Lambda function that processes the order and sends it to an external fulfillment service.

Here's a Lambda function that simulates this scenario, including deliberate transient failures:

```python
import json
import boto3
import random
from datetime import datetime

def lambda_handler(event, context):
    """
    Process an order event and send it to fulfillment service.
    Simulates transient failures to demonstrate retry behavior.
    """
    
    order_id = event.get('detail', {}).get('order_id')
    
    # Simulate a transient failure (e.g., service unavailable)
    # In production, this would be real network errors or service timeouts
    if random.random() < 0.6:  # 60% chance of failure
        print(f"Transient error processing order {order_id}")
        raise Exception("Fulfillment service temporarily unavailable")
    
    # Simulate successful processing
    print(f"Successfully processed order {order_id}")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Order processed',
            'order_id': order_id,
            'timestamp': datetime.utcnow().isoformat()
        })
    }
```

You'd create an EventBridge rule to trigger this function and configure a DLQ for orders that fail to process:

```bash
# First, create the SQS DLQ
aws sqs create-queue --queue-name order-processing-dlq

# Create the EventBridge rule
aws events put-rule \
  --name process-order-rule \
  --event-pattern '{"source":["custom.orders"],"detail-type":["Order Placed"]}'

# Add the Lambda target with retry policy and DLQ
aws events put-targets \
  --rule process-order-rule \
  --targets \
  "Id"="1",\
  "Arn"="arn:aws:lambda:us-east-1:123456789012:function:process-order",\
  "RetryPolicy"="{MaximumEventAge=900,MaximumRetryAttempts=3}",\
  "DeadLetterConfig"="{Arn=arn:aws:sqs:us-east-1:123456789012:order-processing-dlq}",\
  "RoleArn"="arn:aws:iam::123456789012:role/EventBridgeRole"
```

In this configuration, EventBridge will retry order events for up to 15 minutes with a maximum of 3 retry attempts. If the Lambda function continues to fail, the event lands in the order-processing-dlq queue.

When you examine messages in the DLQ, you'll see something like this:

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "detail-type": "Order Placed",
  "source": "custom.orders",
  "account": "123456789012",
  "time": "2024-01-15T14:22:33Z",
  "region": "us-east-1",
  "detail": {
    "order_id": "ORD-12345",
    "customer_id": "CUST-67890",
    "total_amount": 199.99,
    "items": [
      {
        "product_id": "PROD-001",
        "quantity": 2,
        "price": 99.99
      }
    ]
  }
}
```

The DLQ preserves the complete original event, so you have everything you need to understand what failed and why.

### Monitoring and Redriving Events from the DLQ

Once events land in your DLQ, you need visibility into them and a strategy for recovery. AWS CloudWatch metrics can help with the first part. EventBridge emits metrics for successful invocations, failed invocations, and events sent to the DLQ. You can set up CloudWatch alarms to notify you when events start failing, giving you a chance to investigate before problems cascade.

For recovery, the approach depends on the nature of the failure. If the underlying service issue has been resolved, you can redrive events from the DLQ back into processing. One common pattern is to use a Lambda function that consumes messages from the DLQ and republishes them to EventBridge as new events:

```python
import json
import boto3

events_client = boto3.client('events')
sqs_client = boto3.client('sqs')

def lambda_handler(event, context):
    """
    Consume failed events from DLQ and redrive them to EventBridge.
    This function would typically be triggered by an SQS event source mapping.
    """
    
    for record in event['Records']:
        try:
            # Parse the message body (it's the original EventBridge event)
            event_payload = json.loads(record['body'])
            
            # Send it back to EventBridge
            response = events_client.put_events(
                Entries=[
                    {
                        'Source': event_payload.get('source'),
                        'DetailType': event_payload.get('detail-type'),
                        'Detail': json.dumps(event_payload.get('detail', {}))
                    }
                ]
            )
            
            # Delete from SQS only if successfully redriven
            sqs_client.delete_message(
                QueueUrl=record['eventSourceAttributes']['approximateFirstReceiveTimestamp'],
                ReceiptHandle=record['receiptHandle']
            )
            
            print(f"Redrove event {event_payload.get('id')}")
            
        except Exception as e:
            print(f"Failed to redrive event: {str(e)}")
            # Leave the message in the queue for retry
            raise
    
    return {'statusCode': 200}
```

This pattern works well when your DLQ is essentially a "retry queue" for events that experienced temporary failures. After you've resolved the underlying issue, running this redrive function pushes those events back through your normal event processing pipeline.

### EventBridge Pipes and DLQ Configuration

It's worth noting that similar retry and DLQ capabilities exist in EventBridge Pipes, which is a more direct routing mechanism for moving events from a source (like SQS, DynamoDB Streams, or Kinesis) to a target. Pipes also support both retry policies and dead-letter queue configurations, using the same retry policy parameters and DLQ attachment patterns as regular EventBridge rules. If you're building a data integration pipeline, understanding DLQs in the context of Pipes is just as important as understanding them in rules.

### Best Practices for Resilient Event Processing

As you design event-driven systems with EventBridge, keep a few principles in mind. First, always attach a DLQ to targets that process business-critical events. The cost of the SQS queue is negligible compared to the cost of losing data or spending hours debugging where events disappeared. Second, don't rely solely on the default retry policy. Think through your application's tolerance for latency and set appropriate maximum event age and retry attempt limits. A 24-hour retry window might be perfect for batch processing but terrible for real-time transactions.

Third, actively monitor your DLQs. A queue that's growing events is a symptom that something in your system is broken. Set up CloudWatch alarms to alert you when events accumulate there, and establish a process for investigating and recovering from DLQ events. Finally, design your target handlers to be idempotent when possible. EventBridge's retry behavior means an event might be delivered multiple times, so your Lambda functions and target services should be able to handle duplicate invocations gracefully.

### Conclusion

EventBridge makes event routing feel simple, but building truly reliable event-driven systems requires thoughtful configuration of retry policies and dead-letter queues. By understanding the default 24-hour, 185-attempt retry window and knowing how to customize it for your specific needs, you give your events the best chance of successful delivery. Dead-letter queues transform failures from silent tragedies into visible, manageable problems. They preserve the original event payload, giving you the information you need to investigate issues and recover from failures. Pair these mechanisms with proper IAM permissions, CloudWatch monitoring, and a redrive strategy, and you'll build event-driven systems that are both responsive and resilient.
