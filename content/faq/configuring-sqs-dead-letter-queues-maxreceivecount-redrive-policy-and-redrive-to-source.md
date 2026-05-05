---
title: "Configuring SQS Dead-Letter Queues: maxReceiveCount, Redrive Policy, and Redrive to Source"
---

## Configuring SQS Dead-Letter Queues: maxReceiveCount, Redrive Policy, and Redrive to Source

When you build applications that consume messages from Amazon SQS, you're relying on a critical assumption: every message will eventually be processed successfully. But reality is messier. Network timeouts happen. Bugs slip through code review. External services fail. Messages get stuck in loops, repeatedly failing to process. Without a safety net, these problematic messages can clog your main queue, starve legitimate traffic, and make debugging nearly impossible.

This is where dead-letter queues—or DLQs—save the day. A dead-letter queue is a specialized SQS queue that automatically receives messages that have failed processing too many times. It's not just a dumping ground; it's a holding area where you can inspect what went wrong, investigate the root cause, and decide whether to replay the message or investigate a deeper issue in your application.

In this guide, we'll explore the complete picture of SQS dead-letter queues: how to set them up, how to choose the right failure threshold, how to monitor them effectively, and how to use the redrive-to-source feature to replay messages when you've fixed the underlying problem. By the end, you'll understand not just the mechanics, but the reasoning behind each configuration choice.

### Understanding the Problem Dead-Letter Queues Solve

Before we dive into configuration, let's clarify what happens without a DLQ. Imagine you have an SQS queue processing customer orders. A message arrives, your Lambda function picks it up, but an external payment API is temporarily unavailable. The function doesn't explicitly delete the message, so SQS returns it to the queue after the visibility timeout expires. Your function tries again, fails again, and the cycle repeats.

Without intervention, this message could bounce around indefinitely. If your code has a bug that consistently crashes on a particular message format, that message becomes like a rock in the stream, diverting all the flow around it. You might implement a manual workaround—checking logs, finding the bad message, manually deleting it from the console. This doesn't scale when you're processing thousands of messages per day.

A dead-letter queue automates this failure detection. After a message has been received and failed a configurable number of times, SQS automatically moves it to a separate queue where it sits, waiting for your investigation and remediation. Your main queue stays clear. Your processing pipeline stays healthy. And you have a clear audit trail of what failed and why.

### Creating the Dead-Letter Queue: Type Matters

The first decision is the easiest to overlook but potentially the most critical: your dead-letter queue must be the same type as your source queue.

If your source queue is a **Standard queue**, create a Standard dead-letter queue. If your source queue is **FIFO**, create a FIFO dead-letter queue. This isn't just a best practice—it's essential for message ordering and deduplication guarantees. FIFO queues enforce strict ordering using message group IDs. If you were to route failed FIFO messages to a Standard DLQ, you'd lose that ordering guarantee and potentially violate the contract your application depends on.

Creating a FIFO DLQ is identical to creating a FIFO source queue: when you create the queue via the AWS Console or CLI, you simply check the "FIFO Queue" option. If you're using CloudFormation or Terraform, you'd specify `FifoQueue: true` in the queue configuration.

Here's an example using the AWS CLI:

```bash
aws sqs create-queue \
  --queue-name my-app-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true
```

Notice the `.fifo` suffix in the queue name—this is required for FIFO queues in AWS. The `ContentBasedDeduplication` attribute isn't strictly required for a DLQ, but it's a good practice to match the deduplication behavior of your source queue.

For a Standard DLQ:

```bash
aws sqs create-queue \
  --queue-name my-app-dlq
```

Much simpler, since Standard queues have no ordering or deduplication requirements.

### The Redrive Policy: Connecting Source to DLQ

Once you have both queues, you connect them using a **redrive policy**. The redrive policy is a JSON document attached to the source queue that tells SQS: "When a message in this queue fails more than *X* times, send it to that DLQ."

The redrive policy is remarkably simple in structure. It contains just two fields:

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:region:account-id:queue-name",
  "maxReceiveCount": 3
}
```

The `deadLetterTargetArn` is the Amazon Resource Name (ARN) of your DLQ—think of it as the full address that tells SQS exactly where failed messages should go. The `maxReceiveCount` is the threshold: how many times a message must be received and not explicitly deleted before it's considered failed enough to move to the DLQ.

You attach this policy to the source queue, not the DLQ. The DLQ itself requires no special configuration—it's just a regular queue that happens to receive messages from the redrive policy.

Via the AWS CLI, setting a redrive policy looks like this:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/my-source-queue \
  --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\": \"arn:aws:sqs:region:account-id:my-app-dlq\", \"maxReceiveCount\": \"3\"}"}'
```

If you're using CloudFormation, you'd define the source queue with the `RedrivePolicy` property:

```yaml
SourceQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: my-source-queue
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt DeadLetterQueue.Arn
      maxReceiveCount: 3

DeadLetterQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: my-app-dlq
```

CloudFormation handles the ARN construction for you, which is cleaner than hand-crafting strings in the CLI.

### Choosing the Right maxReceiveCount

The `maxReceiveCount` parameter is where strategy meets implementation. It's the number of times a message can be received by a consumer without being deleted before it's sent to the DLQ. This is *not* the number of times your Lambda function is invoked—it's the number of times SQS has delivered the message to a consumer.

Choosing the right value requires understanding the failure patterns in your application.

**For transient failures**, you want a higher threshold. Transient failures are temporary—a network blip, a momentary spike in load on a downstream service, or a brief outage that resolves itself. If your experience tells you that 95% of failed messages eventually succeed within 5 retry attempts, then `maxReceiveCount: 5` or even `maxReceiveCount: 8` makes sense. Each time the message is received, the visibility timeout resets, giving your consumer another window to process it.

**For permanent failures**, a lower threshold is better. If your code has a bug that causes it to fail on a particular message format, retrying that message dozens of times won't help—it'll just waste compute and log storage. You'd rather identify it early and investigate. In these cases, `maxReceiveCount: 1` or `maxReceiveCount: 2` is appropriate.

The challenge is that most real applications have a mix of both. A reasonable middle ground for many use cases is `maxReceiveCount: 3`. This gives transient failures a few chances to recover without holding permanent failures hostage indefinitely.

One important detail: the visibility timeout interacts with `maxReceiveCount` in ways that might surprise you. Let's say your visibility timeout is 30 seconds and your `maxReceiveCount` is 3. If your consumer picks up a message and crashes without deleting it, SQS will re-deliver it after 30 seconds. Three receive-attempts translates to up to 90 seconds of potential retry time before the message goes to the DLQ. If your source is high-volume, you might want to increase visibility timeout if you're seeing messages hit the DLQ due to legitimate slow processing rather than actual failures.

### The Relationship Between Visibility Timeout and Retry Behavior

This is a subtle but important detail. The visibility timeout is how long a message stays invisible after being received. During this window, only the consumer that received the message can delete it. If it doesn't delete the message before the timeout expires, SQS returns the message to the queue as if it was never received.

Here's a concrete scenario: your visibility timeout is 60 seconds, and your `maxReceiveCount` is 3. A message is picked up by your Lambda function. The function starts executing. After 50 seconds, it's still processing a complex operation, but the visibility timeout hasn't expired yet. The function completes successfully and sends a delete request to SQS. Perfect—no retry needed.

But now imagine your Lambda function times out at 15 seconds (perhaps your Lambda timeout is set lower than your SQS visibility timeout). The message becomes visible again after the 60-second visibility timeout expires. Your function retries the same message. If this happens two more times without successful deletion, the message moves to the DLQ.

The lesson here is that visibility timeout and function timeout must be coordinated. Your Lambda timeout should be shorter than your SQS visibility timeout to ensure that a crashed or timed-out invocation doesn't accidentally retry immediately. A common pattern is to set visibility timeout to 6 times your Lambda timeout, leaving a safety margin for infrastructure delays.

### Monitoring Dead-Letter Queue Depth with CloudWatch Alarms

A dead-letter queue sitting quietly in the background is actually a warning sign that something is silently broken. If messages are arriving in your DLQ, you should know about it—ideally before your business stakeholders do.

CloudWatch provides a metric called `ApproximateNumberOfMessagesVisible` that tells you how many messages are currently in a queue. By creating an alarm on your DLQ's depth, you can be notified the moment messages start piling up.

Here's a CloudWatch alarm that triggers if your DLQ ever contains more than 5 messages for 1 minute:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name my-app-dlq-depth-alarm \
  --alarm-description "Alert when DLQ has more than 5 messages" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 60 \
  --threshold 5 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=QueueName,Value=my-app-dlq \
  --alarm-actions arn:aws:sns:region:account-id:my-sns-topic
```

This alarm sends a notification to an SNS topic, which you can configure to email you, page your on-call engineer, or trigger an automated remediation workflow.

The threshold you choose depends on your risk tolerance. For a critical service, even a single message in the DLQ might warrant investigation. For a less critical process, you might tolerate 10 or 20 before raising an alarm. The key is to tune it to your operational baseline and then adjust based on what you learn.

Beyond immediate alerting, you should collect historical metrics on DLQ depth. Over time, this data tells you whether your `maxReceiveCount` is well-calibrated. If messages regularly hit the DLQ, you might have a configuration issue, a code defect, or an external dependency that's frequently unavailable. Dashboard visualizations help teams spot these patterns and drive improvements.

### Understanding the Redrive-to-Source Feature

Once you've identified and fixed the root cause of failed messages, you don't want to discard all the messages that accumulated in your DLQ. The **redrive-to-source** feature lets you replay those messages back to the source queue for reprocessing.

This is different from the redrive policy. The redrive policy is automatic—it defines the failure threshold that moves messages to the DLQ. Redrive-to-source is something you initiate explicitly when you're ready to retry the messages.

When you enable redrive-to-source, you're configuring the DLQ to have its own redrive policy that points back to the source queue. If enabled, messages in the DLQ that are received and not deleted will eventually move back to the source queue after failing again too many times. However, in most cases, you'll use redrive-to-source more explicitly: you'll send specific messages from the DLQ back to the source.

Here's an example of setting redrive-to-source via the CLI:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/my-app-dlq \
  --attributes '{"RedriveAllowPolicy": "{\"sourceQueueArns\": [\"arn:aws:sqs:region:account-id:my-source-queue\"]}"}'
```

The `RedriveAllowPolicy` specifies which source queues are permitted to redrive messages back to the DLQ. This is a security control—it prevents accidentally replaying a DLQ from one queue to a completely different, unrelated queue.

You can also enable redrive-to-source through the AWS Console by editing the DLQ's settings and adding the source queue ARN under the "Redrive allow policy" section.

Once this is configured, you have two ways to replay messages:

**Automatic replay**: If you set a redrive policy on the DLQ itself pointing back to the source queue, messages that fail again in the DLQ will bounce back to the source queue. This creates a retry loop, which is useful for transient failures but risky if the underlying problem persists—you could end up with messages ping-ponging between queues indefinitely.

**Selective replay via API**: More commonly, you'll use the `ChangeMessageVisibility` or batch message operations to move specific messages from the DLQ back to the source. This gives you control and visibility into which messages you're retrying.

The safer, more intentional approach is to manually review DLQ messages, understand why they failed, apply your fix, and then selectively replay the ones that should be retried. For messages that represent bad data or truly unrecoverable errors, you'd log them for audit purposes and delete them.

### Troubleshooting: Messages Disappearing or Looping

Even with a well-configured DLQ setup, problems can emerge. Let's walk through the most common scenarios and how to debug them.

**Messages disappear from the DLQ without being deleted**: If messages are vanishing from your DLQ and you didn't intentionally redrive them, there are several possible causes. First, check whether you accidentally set a redrive policy on the DLQ itself pointing back to the source. This would cause messages to automatically move back after failing again—not ideal for messages that are in the DLQ for a reason. Second, verify that long-polling isn't consuming messages silently. If a consumer is polling the DLQ, receiving messages, and then not deleting them or acknowledging them, the messages will become visible again after the visibility timeout.

**Messages loop between source and DLQ**: This happens when a message causes a consistent failure in your consumer, it gets sent to the DLQ, gets redirected back to the source by redrive-to-source, fails again, and returns to the DLQ. To investigate, examine the actual message content in the DLQ. Check your application logs during the time the message was being processed. Look for exceptions, null pointer errors, or unexpected data formats. Often, a message is malformed in a way that trips up JSON parsing or type coercion. Once you understand the root cause, you either fix the consumer code to handle that message format gracefully, or you delete the message if it truly represents bad data.

**Messages never reach the DLQ even though they're failing**: Double-check that the redrive policy is actually set on the source queue. Verify the ARN in the policy is correct—typos in the account ID or region are common. Make sure the source and DLQ have matching types (both Standard or both FIFO). If they don't match, the redrive policy is silently ignored. Test with the CLI:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/my-source-queue \
  --attribute-names RedrivePolicy
```

If you don't see the `RedrivePolicy` in the response, it's not set. If you do see it, verify the `maxReceiveCount` and `deadLetterTargetArn` are what you expect.

**You're unsure whether visibility timeout is configured correctly**: Recall that the visibility timeout is per-queue and independent of the redrive policy. Check it with:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/my-source-queue \
  --attribute-names VisibilityTimeout
```

The value is in seconds. If your Lambda function runs for 30 seconds, your visibility timeout should be higher—a common starting point is 5 minutes (300 seconds) for queue-driven Lambda workflows.

### Real-World Example: End-to-End Setup

Let's tie everything together with a practical example. Imagine you're building an order processing system that reads from SQS and calls a payment gateway. You want orders that fail payment processing to go to a DLQ for manual review, but you want to give transient failures a chance to succeed.

First, create the queues:

```bash
# Source queue for orders
aws sqs create-queue \
  --queue-name order-processing-queue \
  --attributes VisibilityTimeout=300

# DLQ for failed orders
aws sqs create-queue \
  --queue-name order-processing-dlq
```

Next, attach the redrive policy to the source queue. You'll need the DLQ's ARN first:

```bash
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/order-processing-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

aws sqs set-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account-id/order-processing-queue \
  --attributes "{\"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\": \\\"$DLQ_ARN\\\", \\\"maxReceiveCount\\\": \\\"3\\\"}\"}"
```

Now, set up monitoring:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name order-dlq-depth-alarm \
  --alarm-description "Alert when order DLQ has messages" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=QueueName,Value=order-processing-dlq \
  --alarm-actions arn:aws:sns:region:account-id:payment-alerts
```

Your Lambda consumer logic would look something like this (pseudocode):

```python
import boto3
import json

sqs = boto3.client('sqs')
payment_gateway = PaymentGateway()

def process_order(event, context):
    for record in event['Records']:
        message_id = record['messageId']
        body = json.loads(record['body'])
        
        try:
            payment_gateway.charge(body['customer_id'], body['amount'])
            # Success—delete the message so it doesn't retry
            sqs.delete_message(
                QueueUrl=record['eventSourceMappings'],
                ReceiptHandle=record['receiptHandle']
            )
        except TemporaryPaymentError as e:
            # Transient failure—don't delete, let it retry
            print(f"Transient error processing order {message_id}: {e}")
        except PermanentPaymentError as e:
            # Permanent failure—log for investigation
            print(f"Permanent error processing order {message_id}: {e}")
            # Could also delete here if you want to skip it
```

With this setup, transient errors allow the message to remain undeleted, causing it to be redelivered up to 3 times. Permanent errors can be logged and then deleted (or allowed to fail into the DLQ if you prefer to investigate first). Messages that fail 3 times automatically move to the DLQ, where you can investigate, determine the root cause, and redrive them once fixed.

### Best Practices for Production

As you implement DLQs in production, keep these guidelines in mind:

Start conservative with `maxReceiveCount`. It's easier to increase it later if you find you're too aggressive about moving messages to the DLQ. Begin with 2 or 3 and adjust based on observed failure patterns.

Always monitor DLQ depth. An empty DLQ is a good DLQ—it means your system is handling failures well. If your DLQ starts growing, treat it as a signal to investigate immediately.

Log context when moving messages to the DLQ. Include the receive count, the original error message, and any relevant application state. This makes post-mortem investigation much easier.

Establish a clear process for reviewing and handling DLQ messages. Assign ownership, set a time window for review (e.g., "DLQ messages are reviewed within 24 hours"), and document the remediation path.

For FIFO queues, be especially careful about redrive-to-source. If messages are looping, they'll eventually be out of order relative to the original group, which can violate ordering guarantees downstream.

### Conclusion

Dead-letter queues are a foundational pattern for building resilient, observable systems on SQS. By understanding the redrive policy, choosing an appropriate `maxReceiveCount`, and monitoring DLQ depth, you create a safety mechanism that keeps your main processing pipeline clean while giving you a clear audit trail of failures.

The redrive-to-source feature completes the picture, allowing you to replay messages once you've fixed the underlying issue. Combined with proper alerting and a well-defined remediation process, DLQs transform failure handling from a frustrating firefighting exercise into a systematic, debuggable part of your architecture.

The time you invest in configuring DLQs correctly is time you'll save later when something breaks in production and you need to understand what went wrong and why.
