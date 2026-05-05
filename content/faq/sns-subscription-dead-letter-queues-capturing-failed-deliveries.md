---
title: "SNS Subscription Dead-Letter Queues: Capturing Failed Deliveries"
---

## SNS Subscription Dead-Letter Queues: Capturing Failed Deliveries

Imagine you've built a sophisticated event-driven architecture where your e-commerce platform publishes order events to an SNS topic. Multiple services subscribe to these events — your fulfillment system via HTTP endpoints, your analytics pipeline via Lambda functions, and your data warehouse via SQS queues. Everything hums along beautifully until a downstream service temporarily becomes unavailable, or a Lambda function starts throwing unexpected errors. Where do those messages go? Without proper dead-letter queue configuration, they simply vanish into the void, and you're left debugging mysterious gaps in your data.

This scenario is where SNS subscription Dead-Letter Queues (DLQs) become invaluable. Unlike some AWS services where DLQs are configured globally, SNS takes a per-subscription approach, giving you granular control over how different subscribers handle failures. This article walks you through the complete picture: how to set up DLQs for SNS subscriptions, the retry mechanics that precede them, the nuances across different subscription types, and practical patterns for managing failed deliveries.

### Understanding the Per-Subscription DLQ Model

The first thing to understand about SNS DLQs is their architecture. When you configure a DLQ for an SNS subscription, you're attaching a dead-letter destination specifically to that subscription, not to the topic itself. This is fundamentally different from other AWS services and it's actually powerful because it allows different subscribers to handle failures in different ways.

Consider a scenario where your SNS topic has three subscriptions: one to an internal SQS queue that your order processing service reads from, one to an HTTP endpoint belonging to a partner integration, and one to a Lambda function that enriches data. Each of these subscriptions can have its own DLQ, or some might not have one at all. The HTTP endpoint subscription might route failures to one SQS queue for manual investigation, while the Lambda subscription routes to a different queue for automated replay logic.

Currently, SNS only supports SQS queues as DLQ destinations for subscriptions. This is a notable constraint — you can't route subscription failures to other services like Kinesis or a different SNS topic. The SQS queue becomes your landing zone for messages that have exhausted SNS's retry attempts.

### Setting Up an SQS Queue as a Subscription DLQ

Before you configure SNS to use an SQS queue as a DLQ, the queue needs to exist. Let's walk through the setup process. First, you'll create a standard SQS queue. In most cases, you'll want this to be a standard queue rather than a FIFO queue, though FIFO is technically supported if your topic is also FIFO.

```bash
aws sqs create-queue --queue-name order-events-dlq
```

Now comes the critical part: SNS needs permission to send messages to this queue. This is where many developers stumble. You must attach a queue policy that explicitly grants SNS the `SendMessage` action. Here's what a minimal policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:order-events-dlq",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:OrderEventsTopic"
        }
      }
    }
  ]
}
```

Notice the `Condition` block — it restricts the permission so that only your specific SNS topic can send messages to this queue. This is a security best practice. If you have multiple topics that need to write to the same DLQ, you can adjust the condition to use an `ArnLike` pattern or list multiple ARNs.

You'd attach this policy to the queue using:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/order-events-dlq \
  --attributes '{"Policy": "<policy-json>"}'
```

Once the queue and permissions are in place, you can attach it to a subscription. If you're doing this via the AWS CLI:

```bash
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:OrderEventsTopic:a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6 \
  --attribute-name DeadLetterPolicy \
  --attribute-value '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:123456789012:order-events-dlq"}'
```

The `DeadLetterPolicy` attribute is what ties everything together. If you're using CloudFormation or Infrastructure as Code, this becomes even simpler — the `DeadLetterPolicy` property is available on the `AWS::SNS::Subscription` resource.

### The Retry Dance: When and How Messages Land in DLQs

Before a message ever reaches your DLQ, SNS performs retries. The specific retry behavior depends on the subscription type and the retry policy you've configured, but understanding this sequence is essential for designing robust systems.

SNS applies retry policies before routing messages to DLQs. There are three retry policy options: linear backoff, exponential backoff, and custom. The default is linear backoff with four retries total.

With **linear backoff**, SNS retries at fixed intervals. If you specify a `minDelayTarget` of 1 second and a `maxDelayTarget` of 20 seconds, SNS will retry at 1 second, 1 second, 1 second, and 1 second (and then give up). The linear model increments by 1 second each time, but with the constraint that it never goes below the minimum or above the maximum. This creates a predictable, gradual escalation.

With **exponential backoff**, the wait time doubles between each retry attempt. This is often more sensible for scenarios where the downstream service might be recovering from an issue — you give it progressively more time to come back online. An exponential policy with a minimum of 1 second and a maximum of 60 seconds might retry at 1 second, 2 seconds, 4 seconds, and 8 seconds.

A **custom retry policy** gives you the most control. You specify the exact delay in seconds between each retry attempt, which is useful when you have specific knowledge about how long a service typically takes to recover from failures.

Here's how you'd set an exponential retry policy when creating a subscription:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:OrderEventsTopic \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:us-east-1:123456789012:order-processing-queue \
  --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\": \"arn:aws:sqs:us-east-1:123456789012:order-events-dlq\", \"maxReceiveCount\": 3}"}'
```

Wait — that's actually the SQS DLQ syntax. Let me correct that. For SNS, you're setting the retry policy at the subscription level:

```bash
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:OrderEventsTopic:abc123 \
  --attribute-name RetryPolicy \
  --attribute-value '{"maxReceiveCount": 3, "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123456789012:order-events-dlq"}'
```

The key parameter here is `maxReceiveCount`, which determines how many times SNS will attempt delivery (including the initial send) before routing to the DLQ. Setting this to 3 means SNS tries once initially and retries twice more before giving up.

### Retry Behavior Across Different Subscription Types

Here's where the architecture gets interesting: the retry mechanics vary significantly depending on the subscription type. Understanding these differences is crucial when designing your DLQ strategy.

**SQS subscriptions** are the most straightforward. When an SNS message is delivered to an SQS queue subscription, SNS considers the delivery successful as soon as the message is placed in the queue. If the queue is temporarily unavailable or if SNS encounters errors communicating with the SQS service, the retries kick in. Once the message lands in the queue, however, SNS's responsibility ends. Any subsequent failures with the message — such as processing failures within your consumer application — are handled by SQS's own DLQ mechanism, not SNS's DLQ.

**HTTP/HTTPS subscriptions** trigger retries based on the HTTP response code. SNS retries on 5xx errors and specific 4xx errors like 408 (timeout) and 429 (too many requests). If your HTTP endpoint returns a 200 OK response, SNS considers the delivery successful and moves on, regardless of what your application actually did with the message. This is a critical distinction — SNS is protocol-level retry, not application-level. If your webhook handler catches an exception internally but still returns 200, SNS won't retry. If you want application-level resilience, you need to handle retries within your own code or leverage an SQS queue as an intermediate buffer.

When using HTTP subscriptions, the retry policy is applied based on exponential backoff by default, with a starting delay of 1 second and maximum delay of 20 seconds. You can adjust this behavior when creating the subscription, but the core principle remains: SNS retries based on HTTP status codes, not application semantics.

**Lambda subscriptions** are particularly nuanced. When SNS invokes a Lambda function synchronously, Lambda's own retry behavior comes into play. If the Lambda function throws an error, SNS doesn't immediately retry at the subscription level in the same way it does for HTTP endpoints. Instead, Lambda handles the invocation and returns a failure response to SNS. SNS then applies its retry policy based on that response. However, if you've configured your Lambda function to be invoked asynchronously, the retry behavior is different — Lambda itself retries, and those retries are independent of SNS's subscription-level retry policy. This layering of retry logic can become complex, so it's important to be explicit about whether your Lambda is being invoked synchronously or asynchronously.

For Lambda subscriptions, a common pattern is to set `maxReceiveCount` to 2 (meaning one retry), since Lambda already has its own retry capabilities. Pairing this with a DLQ allows you to capture messages that Lambda couldn't process even after its internal retries.

**SNS-to-SNS subscriptions** work similarly to SQS — SNS considers the message delivered once it successfully publishes to the downstream topic. The downstream topic's subscribers handle their own delivery logic.

### Inspecting and Replaying Failed Messages

Once messages land in your DLQ, you need visibility into what went wrong and a way to replay them. SNS doesn't provide built-in tooling for this, but since your DLQ is an SQS queue, you have several options.

The first step is visibility. You can poll the DLQ queue and inspect the messages:

```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/order-events-dlq \
  --max-number-of-messages 10 \
  --attribute-names All \
  --message-attribute-names All
```

When you receive messages from the DLQ, pay attention to the message attributes. SNS attaches valuable metadata, including the original topic that published the message, the timestamp, and information about why the delivery failed. You can use this metadata to determine root cause.

For replaying messages, you have a few approaches. The simplest is to build a replay mechanism that reads from the DLQ, validates the message, and republishes it to the original SNS topic. This is elegant because it routes the message through the normal flow again, applying all your retry policies:

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:OrderEventsTopic \
  --message '{"orderId": "12345", "status": "processing"}' \
  --message-attributes '{"EventType": {"DataType": "String", "StringValue": "OrderStatusChanged"}}'
```

A more sophisticated approach is to build a Lambda function that reads from the DLQ periodically (using EventBridge to trigger it on a schedule), analyzes failed messages, and intelligently routes them. For example, you might replay some messages immediately, quarantine others for manual investigation, and create alerts for critical failures.

Another consideration: when you replay a message, it goes through the subscription's retry policy again from the beginning. If the subscription's DLQ is still configured and the message fails again, it could end up back in the same DLQ. To prevent this, some teams use a separate queue for replayed messages or temporarily disable the DLQ during replay operations.

### Designing DLQ Strategies for Different Scenarios

The effectiveness of your DLQ setup depends on how well it aligns with your actual business requirements. Let's consider a few patterns.

**The observability-first pattern** works well for non-critical subscriptions where you want to know about failures but don't necessarily need to recover immediately. You configure a DLQ, monitor its depth using CloudWatch metrics, and set up alarms. Messages accumulate in the DLQ, and a human-driven or low-frequency automated process periodically reviews and replays them. This is sensible for analytics pipelines or non-urgent notifications.

**The active remediation pattern** suits critical paths where failures need immediate attention. You configure multiple subscriptions to the same topic — perhaps one with a DLQ and another without. The subscription with the DLQ is your safety net, while the direct subscription tries to deliver normally. You also set up a Lambda function that polls the DLQ and attempts to replay or route failures to appropriate teams. This pattern ensures messages never get lost while maintaining normal-path efficiency.

**The cascade pattern** involves chaining multiple subscriptions and DLQs. Your primary subscription might be an SQS queue, and that queue's consumer application might have its own DLQ. Failed messages from the SQS consumer DLQ then feed into a secondary SNS topic for additional processing or alerting. This creates a multi-tier fallback system.

In all cases, remember that your DLQ strategy should reflect your SLA requirements. If you publish millions of messages daily, even a small percentage failure rate could mean thousands of messages in your DLQ. Ensure your monitoring, alerting, and replay infrastructure can handle the expected volume.

### Common Pitfalls and Best Practices

One frequent mistake is configuring a DLQ but never checking it. A DLQ that no one monitors is worse than useless — it gives false confidence while real failures stack up unseen. Set up CloudWatch alarms on your DLQ's `ApproximateNumberOfMessagesVisible` metric and ensure your team responds to them.

Another pitfall is using overly aggressive retry policies. If you set `maxReceiveCount` to 10, you might retry for an extended period while your service is down, only to have messages time out or accumulate when they could have failed fast and landed in the DLQ for investigation. Consider your recovery time objectives and set retry counts appropriately.

A less obvious issue involves message size and format. SNS wraps messages in JSON when delivering to subscriptions, adding metadata. If you're republishing from a DLQ, ensure you extract the original message content correctly. The SNS wrapper includes fields like `Message`, `MessageAttributes`, `TopicArn`, and `Timestamp`.

When configuring IAM permissions, be specific about which SNS topic can write to your DLQ. A policy that allows all SNS topics to write to your DLQ queue is a security risk and defeats the purpose of resource-level access control.

Finally, test your DLQ configuration during normal operations, not during a crisis. Publish a test message and intentionally fail the subscription to verify the message lands in your DLQ. Verify that your replay mechanism works. This smoke testing prevents surprises when you actually need your DLQ.

### Conclusion

SNS subscription Dead-Letter Queues are a essential component of reliable event-driven architectures. By understanding the per-subscription model, configuring the right SQS destination, setting appropriate retry policies, and recognizing how different subscription types behave differently, you can build systems that gracefully handle failures without losing data.

The key insight is that a DLQ is only as valuable as your ability to monitor it, understand why messages land there, and replay them when appropriate. Treat DLQ configuration as part of your observability strategy, not just a failsafe. With proper setup and ongoing attention, DLQs transform failed message delivery from a mysterious data loss scenario into a manageable, debuggable process — one that gives you confidence in your system's resilience.
