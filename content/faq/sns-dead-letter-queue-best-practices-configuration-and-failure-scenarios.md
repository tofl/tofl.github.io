---
title: "SNS Dead-Letter Queue Best Practices: Configuration and Failure Scenarios"
---

## SNS Dead-Letter Queue Best Practices: Configuration and Failure Scenarios

When you send a message through Amazon SNS to multiple subscribers, you might assume that either all subscribers receive it or none do. In reality, SNS operates on a per-subscription basis. One subscriber might successfully process a message while another fails silently—and without proper dead-letter queue configuration, that failure disappears into the void. Understanding SNS dead-letter queues at the subscription level is essential for building reliable, debuggable messaging systems on AWS.

This guide walks you through the critical aspects of SNS DLQ configuration, explores real-world failure scenarios, and equips you with practical strategies for investigating and recovering from message delivery failures.

### Why Dead-Letter Queues Matter in SNS

SNS delivers messages to subscribers asynchronously, which creates an inherent challenge: how do you know when something goes wrong? By default, if a delivery attempt fails, SNS retries according to a retry policy, but if all retries are exhausted, the message is discarded. You never see it again.

Consider a real scenario: your e-commerce platform publishes order events to SNS. One subscriber is a Lambda function that updates your inventory system. Another is an HTTP endpoint that triggers an external fulfillment service. If the fulfillment endpoint is temporarily unreachable, SNS will retry, eventually give up, and silently drop the message. Meanwhile, your inventory got updated, but the fulfillment never started. Without visibility into that failure, you'd never know orders were being skipped.

This is where dead-letter queues come in. A DLQ captures messages that failed to deliver after all retry attempts, giving you a second chance to investigate and handle them gracefully.

### Understanding the Per-Subscription Architecture

A critical misconception about SNS DLQs is that they operate at the topic level. They don't. Each SNS subscription can have its own dedicated dead-letter queue. This per-subscription model is actually a feature, not a limitation, because it allows different subscribers to have different reliability requirements and failure handling strategies.

Think of it this way: imagine you have an SNS topic with three subscriptions—one to SQS, one to Lambda, and one to an HTTP endpoint. If the SQS subscriber is experiencing permission issues while the Lambda subscriber is humming along fine, you want to capture only the SQS failures, not affect the working Lambda subscriber. The per-subscription DLQ design makes this possible.

When you configure a DLQ for a subscription, you're essentially telling SNS: "If this specific subscriber can't process this message after exhausting all retries, send it to this SQS queue." Different subscriptions to the same topic can route their failures to different DLQs, or even the same DLQ if you prefer centralized failure handling.

### Common Failure Scenarios and How They Trigger DLQs

Understanding what causes messages to land in a DLQ helps you design better recovery mechanisms. Let's explore the most common failure modes.

**Endpoint Unreachable** is perhaps the most familiar scenario. Your subscription points to an HTTP endpoint that's temporarily offline, behind a misconfigured network ACL, or blocked by a security group. SNS attempts delivery, receives connection timeouts or HTTP 5xx errors, retries according to your policy, and eventually sends the message to the DLQ. This is often temporary—your service comes back online, but the message is already gone unless you've captured it.

**Lambda Throttling** occurs when your Lambda subscriber hits the concurrent execution limit. SNS receives a throttling response from the Lambda service, treats it as a retriable error, backs off and retries, but if Lambda remains throttled throughout the retry window, the message fails. The DLQ captures it, and you can reprocess it once you've increased your Lambda concurrency limits.

**Invalid JSON Sent to HTTP Endpoint** is a more subtle failure. SNS formats the message as JSON and sends it to HTTP subscribers. If your HTTP endpoint expects a specific schema and the message doesn't conform, your application might reject it with an error response. If that response indicates failure (typically a non-2xx status code), SNS retries. After exhaustion, the message lands in the DLQ. Unlike transient failures, this one often signals a contract mismatch between your publisher and subscriber.

**SQS Permission Denied** happens when the subscription's SQS queue lacks the necessary IAM permissions to receive messages from the SNS topic. Every delivery attempt fails because the `SendMessage` action is denied. This one's particularly insidious because it fails consistently—there's no transient recovery, just repeated permission errors until the message reaches the DLQ.

**Lambda Function Errors** manifest when your Lambda subscriber throws an unhandled exception or times out. SNS interprets these as failures and retries. If the function continues to fail on every retry attempt, the message eventually reaches the DLQ.

In each case, the message doesn't disappear; it accumulates in your DLQ, waiting for you to investigate and take corrective action.

### Configuring Dead-Letter Queues: Console and CLI Approaches

Setting up a DLQ for an SNS subscription involves two main steps: creating the SQS queue and then linking it to the subscription with appropriate permissions and retry configuration.

**Via the AWS Console**, the process is straightforward. First, create an SQS queue that will serve as your DLQ. Give it a descriptive name like `order-events-dlq` so its purpose is immediately clear. Then, navigate to your SNS topic, select the subscription you want to protect, and click Edit. Scroll to the "Dead-letter queue" section and specify the SQS queue ARN. You'll also want to review the "Redrive policy" settings—this is where you define how many times SNS should retry before giving up.

The console's retry policy is typically configured as "Maximum receives" on the DLQ side (when you're looking at SQS configuration). However, SNS subscriptions are configured with "Max receive count" equivalents in the redrive policy.

**Via the AWS CLI**, you create the queue first:

```bash
aws sqs create-queue --queue-name order-events-dlq --region us-east-1
```

Capture the queue ARN from the response. Then, update your SNS subscription with the redrive policy:

```bash
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:orders:abc123def456 \
  --attribute-name RedrivePolicy \
  --attribute-value '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:123456789012:order-events-dlq"}' \
  --region us-east-1
```

The RedrivePolicy is a JSON object specifying the DLQ's ARN. SNS will automatically manage the retry logic based on this configuration.

However, there's a crucial permission piece: SNS needs IAM permissions to send messages to the SQS queue. Create or update the SQS queue's access policy to allow SNS to publish:

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
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:orders"
        }
      }
    }
  ]
}
```

This policy restricts SNS to only your specific topic, which is a security best practice.

### Setting Up CloudWatch Alarms for DLQ Monitoring

A DLQ is only useful if you know messages are arriving in it. CloudWatch alarms provide that visibility. An alarm triggered when messages appear in your DLQ alerts you immediately, rather than discovering the problem days later during a manual review.

Create an alarm on the `ApproximateNumberOfMessagesVisible` metric of your DLQ:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name order-events-dlq-alarm \
  --alarm-description "Alert when messages appear in order events DLQ" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=QueueName,Value=order-events-dlq \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:alerts
```

This alarm triggers whenever your DLQ contains one or more visible messages for a 5-minute period. Route the alarm to an SNS topic that sends you email, SMS, or integrates with your incident management system.

Beyond simple presence alarms, consider alarms on the `NumberOfMessagesSent` metric, which tracks the total count of messages sent to the queue. A sudden spike might indicate a broader failure pattern worth investigating immediately rather than waiting for manual discovery.

### A Real-World Failure Scenario: The Poisoned Message

Let's walk through a concrete example. Imagine an order event SNS topic with a Lambda subscriber that processes orders and updates a database. One publisher accidentally sends a malformed message with missing required fields. The message arrives at SNS, which formats it and invokes your Lambda function.

Your Lambda function's code expects certain fields:

```python
def handler(event, context):
    message = json.loads(event['Records'][0]['Sns']['Message'])
    order_id = message['order_id']  # This key doesn't exist
    # ... process order ...
```

The function crashes with a KeyError. SNS sees the invocation failed, waits according to backoff strategy, and retries. Each retry fails identically because the message content never changes. After exhausting the retry policy (say, 3 attempts), SNS moves the message to your DLQ.

Now, this message sits in the DLQ. Your CloudWatch alarm fires. You're alerted that something went wrong. Without a DLQ, you'd have no evidence that orders were being dropped.

When you investigate, you pull the message from the DLQ:

```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/order-events-dlq \
  --attribute-names All \
  --message-attribute-names All
```

The message body reveals the missing field. Now you have choices: fix the publisher to include the field, fix the subscriber to handle missing fields gracefully, or manually replay a corrected version of the message once the underlying issue is resolved.

Without the DLQ, you'd only know something was wrong if you happened to monitor order counts and noticed a sudden dip.

### Investigating and Replaying Messages from a DLQ

Once you've identified why messages landed in the DLQ, you need a systematic approach to recover them. This involves investigation, remediation, and replay.

**Investigation** starts with understanding the message content. Pull a message from the DLQ and examine its attributes and body. SNS includes metadata about the original failure attempt, which helps pinpoint the issue. Look for patterns: are all messages in the DLQ from a specific publisher, or do they span multiple sources? Are they all old (pre-dating your infrastructure change), or are new failures arriving?

**Remediation** depends on the root cause. If it's a transient infrastructure issue (an endpoint that was down but is now back online), you might simply replay messages immediately. If it's a code bug, deploy the fix first and then replay. If it's a permission issue, update IAM policies before retrying. The key is addressing the root cause, not just moving messages around.

**Replay** can be done several ways. For small numbers of messages, the AWS Console's "Send and receive messages" feature lets you manually extract a message and republish it to your SNS topic. For larger batches, write a small script:

```python
import boto3
import json

sqs = boto3.client('sqs')
sns = boto3.client('sns')

dlq_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/order-events-dlq'
topic_arn = 'arn:aws:sns:us-east-1:123456789012:orders'

response = sqs.receive_message(QueueUrl=dlq_url, MaxNumberOfMessages=10)

for message in response.get('Messages', []):
    # Extract the original SNS message
    body = json.loads(message['Body'])
    original_message = body['Message']
    
    # Republish to the topic
    sns.publish(
        TopicArn=topic_arn,
        Message=original_message
    )
    
    # Delete from DLQ once successfully republished
    sqs.delete_message(
        QueueUrl=dlq_url,
        ReceiptHandle=message['ReceiptHandle']
    )
    
    print(f"Replayed message: {original_message[:100]}...")
```

This approach extracts messages from the DLQ, republishes them to SNS (which will route them to all active subscribers), and deletes them from the DLQ once successful. You gain visibility into which messages were problematic and can validate that they're processed correctly after your remediation.

### Retry Policies and Configuration Best Practices

The retry behavior before a message reaches the DLQ is governed by SNS's retry policy. By default, SNS uses an exponential backoff strategy with jitter, meaning it waits longer between each retry attempt, reducing thundering-herd scenarios when a service recovers.

The default maximum retry count is typically 100 attempts over approximately 1 hour, but these defaults vary by subscription type. HTTP subscriptions have different retry behavior than Lambda or SQS subscriptions. For HTTP endpoints, SNS expects a 2xx status code to consider delivery successful. For Lambda, it relies on the function completing without errors. For SQS, it's a successful `SendMessage` API call.

Configure your redrive policy (the one that sends messages to the DLQ) thoughtfully. A count that's too low might prematurely give up on transient failures, while one that's too high could let messages pile up in the DLQ long after the underlying issue is resolved.

For HTTP subscriptions, consider setting a maxReceiveCount of 3 to 5. HTTP endpoints often have temporary network glitches, and a few retries usually suffice. For Lambda, you might go slightly higher (5-10) because transient throttling is more common. For SQS subscriptions, permission issues or unavailability are rarer, so you can afford a higher count.

Remember that every retry attempt by SNS represents an invocation cost for Lambda, an API call for SQS, or a request to your HTTP endpoint. There's a balance between resilience and cost.

### Monitoring and Alerting Strategy

Beyond the basic DLQ presence alarm, implement a more sophisticated monitoring strategy. Track DLQ message arrival rate over time to spot trends. A single message in the DLQ might be a transient hiccup; 50 messages arriving within an hour signals a systemic problem.

Set up a dashboard that visualizes:

The count of messages currently in the DLQ, the rate at which messages are being added to the DLQ, the age of messages in the DLQ (to identify old messages that haven't been manually deleted), and the frequency of DLQ processing events (if you've automated replay).

Create separate alarms for different severity levels. A minor threshold (messages > 0) might send a notification to a team Slack channel. A critical threshold (messages > 100 in 5 minutes) might page an on-call engineer. This tiered alerting helps you respond proportionally to the problem's severity.

### Handling Multiple Subscriptions and Partial Failures

A single SNS topic often has multiple subscriptions, and it's entirely possible for some to succeed while others fail. Suppose your order topic has three subscriptions: one to an SQS queue, one to a Lambda function, and one to an HTTP endpoint.

When you publish a message:
- The SQS subscription succeeds, and the message is available in that queue.
- The Lambda subscription fails due to throttling, and the message lands in the Lambda subscriber's DLQ.
- The HTTP subscription succeeds after a single retry.

Your ordering system is partially functional. Orders are queued for processing, but your analytics Lambda isn't capturing them. You won't know until you check the Lambda subscriber's DLQ.

This scenario underscores why per-subscription DLQs are essential. A centralized, topic-level DLQ would make it unclear which subscriber failed. With per-subscription DLQs, you immediately know the Lambda subscriber is struggling.

### Security Considerations for DLQs

DLQs are SQS queues and can contain sensitive data—order details, customer information, payment data. Treat them with the same security rigor as your production queues.

Encrypt the DLQ at rest using AWS KMS. Configure the queue's access policy to restrict who can read messages from it. Sensitive data in DLQs shouldn't be accessible to every developer in your organization.

Implement retention policies to ensure messages don't persist indefinitely. The default SQS message retention is 4 days, which is often appropriate for DLQs. If you need longer retention for compliance, configure it explicitly, but recognize the storage costs.

Monitor access to DLQs. Log all API calls to the DLQ via CloudTrail. If an unauthorized user attempts to read messages from your DLQ, you'll have an audit trail.

### Troubleshooting Common DLQ Issues

Sometimes messages don't appear in your DLQ even though you're certain they should be failing. The most common cause is missing IAM permissions. SNS can't send messages to the SQS queue because its service role lacks the `sqs:SendMessage` permission. Check the queue's access policy and the SNS service's assumed role.

Another issue is misconfigured redrive policies. If you've specified the wrong queue ARN or if the redrive policy JSON is malformed, SNS will silently fail to route messages to the DLQ. Verify the redrive policy via the CLI:

```bash
aws sns get-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:orders:abc123def456 \
  --attribute-name RedrivePolicy \
  --region us-east-1
```

If the returned policy is empty, the DLQ isn't configured. If it contains an invalid ARN, messages won't reach it.

Messages might also be succeeding when you expect them to fail. Review the actual error responses from your subscriber. A Lambda function that raises an exception within a certain time window might still return a successful invocation response to SNS, which considers it a success. Ensure your subscriber explicitly signals failure to SNS.

### Conclusion

Dead-letter queues in SNS provide critical visibility into subscription-level failures, enabling you to build resilient, debuggable messaging systems. The per-subscription architecture ensures that failures in one subscriber don't obscure the health of others, and combined with thoughtful alarm configuration and replay strategies, DLQs transform what might otherwise be silent message loss into a manageable, recoverable event.

The key takeaways are to configure DLQs for every subscription that matters, set up CloudWatch alarms to detect failures immediately, understand the specific failure modes relevant to your subscriber type, and establish a clear runbook for investigating and replaying failed messages. Treat your DLQs as first-class infrastructure components, monitor them regularly, and use the insights they provide to improve both your application code and your messaging architecture over time.
