---
title: "13. SNS"
type: docs
weight: 3
---

## SNS (Simple Notification Service)

Amazon Simple Notification Service (SNS) [🔗](https://docs.aws.amazon.com/sns/latest/dg/welcome.html) is a fully managed pub/sub messaging service. Where SQS decouples a single producer from a single consumer, SNS solves a different problem: **broadcasting one message to many recipients simultaneously**. A single `Publish` call to an SNS topic can trigger an email notification, invoke a Lambda function, and drop a copy of the message into an SQS queue — all at once. This makes SNS the natural choice for fan-out architectures and alert pipelines.

## Topics: Standard vs FIFO

Like SQS, SNS comes in two flavors [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-fifo-topics.html):

- **Standard topics** offer maximum throughput with best-effort ordering and at-least-once delivery. Use these when delivery speed matters more than strict sequencing.
- **FIFO topics** guarantee strict message ordering and exactly-once delivery, but only support SQS FIFO queues as subscribers. Throughput is capped (300 published messages/second without batching, 3,000 with). Use these when downstream consumers must process events in the exact order they were published — for example, a sequence of inventory updates.

## Publishers and Subscribers

Any application, AWS service, or AWS account that calls `sns:Publish` on a topic is a **publisher**. An SNS topic can fan out to a wide range of **subscriber types** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html):

- **SQS** — the most common pattern; durable, decoupled processing
- **Lambda** — invoke a function directly on each message
- **HTTP/HTTPS** — push to any public webhook endpoint
- **Email / Email-JSON** — useful for ops alerts and notifications
- **SMS** — send text messages to phone numbers
- **Mobile push** — deliver to APNs (Apple) or FCM (Google) via platform applications

Each topic can have up to 12,500,000 subscriptions [🔗](https://docs.aws.amazon.com/general/latest/gr/sns.html).

## Message Filtering with Subscription Filter Policies

By default, every subscriber receives every message published to a topic. **Subscription filter policies** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html) let each subscriber declare which messages it actually wants, based on message attributes. SNS evaluates the policy before delivering, so irrelevant messages are dropped before they ever reach the subscriber.

For example, imagine an e-commerce order topic. A `payments-service` SQS queue can filter for `{"event_type": ["payment_processed"]}` while a `shipping-service` queue filters for `{"event_type": ["order_placed"]}` — both subscribed to the same topic, each seeing only what it needs.

Filter policies can match on **attribute values** (exact match, prefix, numeric range) or, with the newer **payload-based filtering** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html#sns-message-filtering-payload), on the message body itself.

## SNS + SQS Fan-Out Pattern

The canonical pattern for reliable fan-out is: **one SNS topic → multiple SQS queues** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html). Each downstream service subscribes with its own SQS queue. This gives you:

- **Durability** — SQS persists the message if a consumer is temporarily unavailable.
- **Independent scaling** — each consumer processes at its own pace.
- **Isolation** — a failure in one consumer doesn't affect others.

A common real-world example: an S3 event notification is sent to an SNS topic, which fans out to a thumbnail-generation queue, an audit-log queue, and a search-index queue simultaneously. Without SNS in the middle, S3 can only notify one destination directly.

## Message Attributes

Message attributes [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html) are structured metadata attached to a message alongside its body. Each attribute has a name, a data type (`String`, `Number`, `Binary`), and a value. They serve two purposes: driving subscription filter policies (as described above) and passing context to subscribers without embedding it in the message payload. Up to 10 attributes are allowed per message.

## SNS FIFO: Ordering and Deduplication

On FIFO topics, **message group ID** controls ordering — messages with the same group ID are delivered in strict sequence to subscribers. **Deduplication** works the same way as SQS FIFO: either via a deduplication ID you supply, or via SHA-256 content-based hashing enabled on the topic. Duplicate messages published within the 5-minute deduplication window are silently discarded [🔗](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-dedup.html).

## Dead-Letter Queues for SNS Subscriptions

When SNS fails to deliver a message to a subscriber (after exhausting retries), it can route the failed message to a **Dead-Letter Queue** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html) attached to that specific subscription — not to the topic itself. This is an important distinction: the DLQ is per subscription, so a delivery failure to one subscriber doesn't affect others. The DLQ must be an SQS queue in the same AWS account and region. Inspect messages in the DLQ to diagnose why delivery failed (endpoint unreachable, Lambda throttled, malformed message, etc.).

## Server-Side Encryption

SNS supports server-side encryption (SSE) [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-server-side-encryption.html) using AWS KMS. When enabled, SNS encrypts message payloads at rest using your specified KMS key (either `AWS_MANAGED_KEY` or a CMK). Messages are encrypted immediately on publish and decrypted on delivery. Note that SSE protects the message at rest inside SNS — it does not encrypt the message in transit to subscribers (HTTPS endpoints handle that separately).

## Access Control: Topic Policies

There are two ways to control who can publish to or subscribe from an SNS topic [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-access-policy-use-cases.html):

- **IAM policies** — attached to IAM identities (users, roles). These work when the publisher or subscriber is within the same AWS account.
- **Topic resource policies** — JSON policies attached directly to the SNS topic, equivalent to S3 bucket policies. These are required for **cross-account access** and for allowing AWS services (like S3 or CloudWatch Alarms) to publish to your topic.

For example, to allow S3 to publish event notifications to your topic, you attach a topic policy granting `sns:Publish` to the S3 service principal (`s3.amazonaws.com`), scoped to a specific bucket ARN as a condition. IAM alone cannot grant this because S3 is not an IAM principal acting on behalf of your account.

When both an IAM policy and a topic policy apply, SNS evaluates them together — access is granted only if neither explicitly denies and at least one allows.