---
title: "13. SNS"
type: docs
weight: 3
---

## SNS (Simple Notification Service)

Amazon Simple Notification Service (SNS) [🔗](https://docs.aws.amazon.com/sns/latest/dg/welcome.html) is a fully managed pub/sub messaging service. Where SQS decouples a single producer from a single consumer, SNS solves a different problem: **broadcasting one message to many recipients simultaneously**. A single `Publish` call to an SNS topic can trigger an email notification, invoke a Lambda function, and drop a copy of the message into an SQS queue — all at once. This makes SNS the natural choice for fan-out architectures and alert pipelines.

### Topics: Standard vs FIFO

Like SQS, SNS comes in two flavors [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-fifo-topics.html):

- **Standard topics** offer maximum throughput with best-effort ordering and at-least-once delivery. Use these when delivery speed matters more than strict sequencing.
- **FIFO topics** guarantee strict message ordering and exactly-once delivery, but only support SQS FIFO queues as subscribers. Throughput is capped (300 published messages/second without batching, 3,000 with). Use these when downstream consumers must process events in the exact order they were published — for example, a sequence of inventory updates.

### Publishers and Subscribers

Any application, AWS service, or AWS account that calls `sns:Publish` on a topic is a **publisher**. An SNS topic can fan out to a wide range of **subscriber types** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html):

- **SQS** — the most common pattern; durable, decoupled processing
- **Lambda** — invoke a function directly on each message
- **HTTP/HTTPS** — push to any public webhook endpoint
- **Email / Email-JSON** — useful for ops alerts and notifications
- **SMS** — send text messages to phone numbers
- **Mobile push** — deliver to APNs (Apple) or FCM (Google) via platform applications

Each topic can have up to 12,500,000 subscriptions [🔗](https://docs.aws.amazon.com/general/latest/gr/sns.html).

### Message Filtering with Subscription Filter Policies

By default, every subscriber receives every message published to a topic. **Subscription filter policies** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html) let each subscriber declare which messages it actually wants, based on message attributes. SNS evaluates the policy before delivering, so irrelevant messages are dropped before they ever reach the subscriber.

For example, imagine an e-commerce order topic. A `payments-service` SQS queue can filter for `{"event_type": ["payment_processed"]}` while a `shipping-service` queue filters for `{"event_type": ["order_placed"]}` — both subscribed to the same topic, each seeing only what it needs.

Filter policies can match on **attribute values** (exact match, prefix, numeric range) or, with the newer **payload-based filtering** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html#sns-message-filtering-payload), on the message body itself.

### SNS + SQS Fan-Out Pattern

The canonical pattern for reliable fan-out is: **one SNS topic → multiple SQS queues** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html). Each downstream service subscribes with its own SQS queue. This gives you:

- **Durability** — SQS persists the message if a consumer is temporarily unavailable.
- **Independent scaling** — each consumer processes at its own pace.
- **Isolation** — a failure in one consumer doesn't affect others.

A common real-world example: an S3 event notification is sent to an SNS topic, which fans out to a thumbnail-generation queue, an audit-log queue, and a search-index queue simultaneously. Without SNS in the middle, S3 can only notify one destination directly.

### Message Attributes

Message attributes [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html) are structured metadata attached to a message alongside its body. Each attribute has a name, a data type (`String`, `Number`, `Binary`), and a value. They serve two purposes: driving subscription filter policies (as described above) and passing context to subscribers without embedding it in the message payload. Up to 10 attributes are allowed per message.

### SNS FIFO: Ordering and Deduplication

On FIFO topics, **message group ID** controls ordering — messages with the same group ID are delivered in strict sequence to subscribers. **Deduplication** works the same way as SQS FIFO: either via a deduplication ID you supply, or via SHA-256 content-based hashing enabled on the topic. Duplicate messages published within the 5-minute deduplication window are silently discarded [🔗](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-dedup.html).

### Dead-Letter Queues for SNS Subscriptions

When SNS fails to deliver a message to a subscriber (after exhausting retries), it can route the failed message to a **Dead-Letter Queue** [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html) attached to that specific subscription — not to the topic itself. This is an important distinction: the DLQ is per subscription, so a delivery failure to one subscriber doesn't affect others. The DLQ must be an SQS queue in the same AWS account and region. Inspect messages in the DLQ to diagnose why delivery failed (endpoint unreachable, Lambda throttled, malformed message, etc.).

### Server-Side Encryption

SNS supports server-side encryption (SSE) [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-server-side-encryption.html) using AWS KMS. When enabled, SNS encrypts message payloads at rest using your specified KMS key (either `AWS_MANAGED_KEY` or a CMK). Messages are encrypted immediately on publish and decrypted on delivery. Note that SSE protects the message at rest inside SNS — it does not encrypt the message in transit to subscribers (HTTPS endpoints handle that separately).

### Access Control: Topic Policies

There are two ways to control who can publish to or subscribe from an SNS topic [🔗](https://docs.aws.amazon.com/sns/latest/dg/sns-access-policy-use-cases.html):

- **IAM policies** — attached to IAM identities (users, roles). These work when the publisher or subscriber is within the same AWS account.
- **Topic resource policies** — JSON policies attached directly to the SNS topic, equivalent to S3 bucket policies. These are required for **cross-account access** and for allowing AWS services (like S3 or CloudWatch Alarms) to publish to your topic.

For example, to allow S3 to publish event notifications to your topic, you attach a topic policy granting `sns:Publish` to the S3 service principal (`s3.amazonaws.com`), scoped to a specific bucket ARN as a condition. IAM alone cannot grant this because S3 is not an IAM principal acting on behalf of your account.

When both an IAM policy and a topic policy apply, SNS evaluates them together — access is granted only if neither explicitly denies and at least one allows.

{{< qcm >}}
[
{
"question": "A developer is designing a system where a single order event must simultaneously trigger a payment service, a shipping service, and an analytics service. Which AWS service combination best supports this architecture?",
"answers": [
{
"answer": "One SQS queue shared by all three services",
"isCorrect": false,
"explanation": "A single SQS queue would deliver each message to only one consumer, not all three services simultaneously. This does not achieve fan-out."
},
{
"answer": "One SNS topic with three SQS queues as subscribers",
"isCorrect": true,
"explanation": "This is the canonical SNS + SQS fan-out pattern. A single SNS Publish call fans out to all three SQS queues simultaneously, giving each service its own durable, independent queue."
},
{
"answer": "Three separate SQS queues polled independently by each service",
"isCorrect": false,
"explanation": "Without SNS, the producer would need to send three separate messages to three queues, introducing coupling and duplication logic in the producer."
},
{
"answer": "One SNS topic with direct Lambda invocations for each service",
"isCorrect": false,
"explanation": "While Lambda is a valid SNS subscriber type, using SQS queues in between provides durability and independent scaling, which is preferred for reliable fan-out. Lambda invocations directly from SNS offer no built-in buffering."
}
]
},
{
"question": "An SNS topic receives order events with a message attribute `event_type`. A `shipping-service` SQS queue should only receive messages where `event_type` is `order_placed`. How should a developer implement this?",
"answers": [
{
"answer": "Apply a subscription filter policy on the shipping-service subscription filtering on `event_type: order_placed`",
"isCorrect": true,
"explanation": "Subscription filter policies allow each subscriber to declare which messages it wants based on message attributes. SNS evaluates the policy before delivery, so only matching messages reach the queue."
},
{
"answer": "Add a message deduplication ID to filter out unwanted messages",
"isCorrect": false,
"explanation": "Deduplication IDs are used to prevent duplicate message delivery in FIFO topics/queues, not to filter messages by content or attributes."
},
{
"answer": "Configure an SQS queue policy to reject messages with wrong attributes",
"isCorrect": false,
"explanation": "SQS queue policies control access permissions, not message content filtering. Filtering must be configured at the SNS subscription level."
},
{
"answer": "Use a Lambda function between SNS and SQS to manually filter messages",
"isCorrect": false,
"explanation": "While technically possible, this adds unnecessary complexity and cost. SNS natively supports subscription filter policies for this exact use case."
}
]
},
{
"question": "A company requires that a sequence of inventory update events be processed in strict order by downstream consumers. Which SNS topic type should be used, and what is a key limitation to be aware of?",
"answers": [
{
"answer": "SNS Standard topic; it supports all subscriber types and high throughput",
"isCorrect": false,
"explanation": "Standard topics offer best-effort ordering only, not strict ordering. They are not suitable when exact sequence is required."
},
{
"answer": "SNS FIFO topic; it only supports SQS FIFO queues as subscribers",
"isCorrect": true,
"explanation": "SNS FIFO topics guarantee strict message ordering and exactly-once delivery, but they can only fan out to SQS FIFO queues — not Lambda, HTTP, email, or SMS subscribers."
},
{
"answer": "SNS FIFO topic; it supports all subscriber types including Lambda and HTTP",
"isCorrect": false,
"explanation": "SNS FIFO topics are limited to SQS FIFO queues as subscribers. Lambda, HTTP/HTTPS, email, and SMS are not supported as subscribers for FIFO topics."
},
{
"answer": "SNS Standard topic with message group IDs to enforce ordering",
"isCorrect": false,
"explanation": "Message group IDs are a feature of FIFO topics/queues, not Standard topics. Standard topics do not support ordering guarantees."
}
]
},
{
"question": "SNS fails to deliver a message to one of its SQS subscribers after all retries are exhausted. What happens, and where is the failed message routed?",
"answers": [
{
"answer": "The message is dropped and all other subscriptions to the topic are also paused",
"isCorrect": false,
"explanation": "A delivery failure for one subscriber does not affect other subscribers. Each subscription is independent."
},
{
"answer": "The message is routed to a Dead-Letter Queue attached to that specific subscription",
"isCorrect": true,
"explanation": "SNS DLQs are configured per subscription, not per topic. A delivery failure to one subscriber sends the message to that subscription's DLQ without impacting other subscribers."
},
{
"answer": "The message is routed to a Dead-Letter Queue attached to the SNS topic itself",
"isCorrect": false,
"explanation": "DLQs in SNS are attached at the subscription level, not the topic level. This is an important distinction from SQS where the DLQ is on the queue."
},
{
"answer": "SNS retries indefinitely until the subscriber becomes available",
"isCorrect": false,
"explanation": "SNS has a finite retry policy. After retries are exhausted, the message is sent to the configured DLQ (if one exists), not retried indefinitely."
}
]
},
{
"question": "A developer wants to allow Amazon S3 to publish event notifications directly to an SNS topic owned by the same AWS account. Which access control mechanism is required?",
"answers": [
{
"answer": "An IAM role attached to the S3 bucket",
"isCorrect": false,
"explanation": "S3 is not an IAM principal acting on behalf of your account, so an IAM role cannot be attached to a bucket to grant S3 publish permissions. A topic resource policy is needed."
},
{
"answer": "A topic resource policy granting sns:Publish to the S3 service principal",
"isCorrect": true,
"explanation": "To allow AWS services like S3 to publish to an SNS topic, you must attach a topic resource policy granting sns:Publish to the s3.amazonaws.com service principal, scoped to the specific bucket ARN as a condition."
},
{
"answer": "An IAM policy attached to the SNS topic",
"isCorrect": false,
"explanation": "IAM policies are attached to IAM identities (users, roles), not to SNS topics. They also cannot grant permissions to AWS service principals like S3."
},
{
"answer": "No additional configuration is needed; S3 can publish to SNS by default",
"isCorrect": false,
"explanation": "By default, S3 has no permission to publish to an SNS topic. An explicit topic resource policy must be created to allow it."
}
]
},
{
"question": "What is the maximum number of subscriptions allowed per SNS topic?",
"answers": [
{
"answer": "1,000",
"isCorrect": false,
"explanation": "1,000 is not the correct limit for SNS topic subscriptions."
},
{
"answer": "100,000",
"isCorrect": false,
"explanation": "100,000 is not the correct limit. SNS supports a significantly higher number of subscriptions per topic."
},
{
"answer": "12,500,000",
"isCorrect": true,
"explanation": "Each SNS topic supports up to 12,500,000 subscriptions, making it suitable for massive broadcast scenarios."
},
{
"answer": "Unlimited",
"isCorrect": false,
"explanation": "SNS topic subscriptions are not unlimited. The service limit is 12,500,000 subscriptions per topic."
}
]
},
{
"question": "A developer enables Server-Side Encryption (SSE) on an SNS topic using AWS KMS. Which of the following statements about SNS SSE is correct? (Select TWO)",
"answers": [
{
"answer": "Messages are encrypted at rest inside SNS immediately upon publish",
"isCorrect": true,
"explanation": "When SSE is enabled, SNS encrypts message payloads at rest using the specified KMS key immediately when the message is published."
},
{
"answer": "SSE also encrypts messages in transit between SNS and its subscribers",
"isCorrect": false,
"explanation": "SSE protects messages at rest inside SNS only. Encryption in transit to subscribers (e.g., HTTPS endpoints) is handled separately by transport-layer security."
},
{
"answer": "A customer-managed KMS key (CMK) or the AWS managed key can be used for encryption",
"isCorrect": true,
"explanation": "SNS SSE supports both the AWS managed key (AWS_MANAGED_KEY) and customer-managed KMS keys (CMK), giving flexibility in key management."
},
{
"answer": "SSE can only be enabled on SNS FIFO topics, not Standard topics",
"isCorrect": false,
"explanation": "SSE is available for both Standard and FIFO SNS topics. There is no such restriction."
}
]
},
{
"question": "An SNS FIFO topic is used to publish inventory update events. A developer wants to ensure that duplicate events published within a short time window are silently discarded. Which two mechanisms can be used to achieve this? (Select TWO)",
"answers": [
{
"answer": "Providing a unique deduplication ID with each published message",
"isCorrect": true,
"explanation": "Supplying a MessageDeduplicationId with each publish call allows SNS FIFO to detect and discard duplicates within the 5-minute deduplication window."
},
{
"answer": "Enabling content-based deduplication using SHA-256 hashing on the topic",
"isCorrect": true,
"explanation": "When content-based deduplication is enabled, SNS FIFO automatically generates a deduplication ID by SHA-256 hashing the message body, discarding duplicates within the 5-minute window."
},
{
"answer": "Setting a message retention period to prevent duplicate processing",
"isCorrect": false,
"explanation": "Message retention period is an SQS concept for how long messages are stored. It does not perform deduplication on SNS FIFO topics."
},
{
"answer": "Using a subscription filter policy to exclude duplicate messages",
"isCorrect": false,
"explanation": "Subscription filter policies filter messages by attributes or payload content, not by deduplication logic. They cannot detect or discard duplicate messages."
}
]
},
{
"question": "Which of the following are valid subscriber types for an SNS Standard topic? (Select THREE)",
"answers": [
{
"answer": "SQS Standard queue",
"isCorrect": true,
"explanation": "SQS queues (Standard and FIFO) are valid SNS subscriber types and represent the most common fan-out pattern."
},
{
"answer": "AWS Lambda function",
"isCorrect": true,
"explanation": "Lambda functions can be subscribed to SNS Standard topics and are invoked directly for each published message."
},
{
"answer": "HTTP/HTTPS webhook endpoint",
"isCorrect": true,
"explanation": "SNS can push messages to any public HTTP or HTTPS endpoint, making it suitable for integrating with external systems or webhooks."
},
{
"answer": "Amazon DynamoDB table",
"isCorrect": false,
"explanation": "DynamoDB is not a supported SNS subscriber type. To write SNS messages to DynamoDB, you would need an intermediary such as a Lambda function or Kinesis."
},
{
"answer": "Amazon RDS database",
"isCorrect": false,
"explanation": "Amazon RDS is not a supported SNS subscriber type. SNS cannot push messages directly to a relational database."
}
]
},
{
"question": "A developer attaches both an IAM policy and a topic resource policy to control access to an SNS topic. A user has sns:Publish allowed in the IAM policy but the topic resource policy has no explicit statement for that user. Will the user be able to publish to the topic?",
"answers": [
{
"answer": "No, both the IAM policy and the topic resource policy must explicitly allow the action",
"isCorrect": false,
"explanation": "SNS does not require both policies to allow the action. Access is granted if neither explicitly denies and at least one allows."
},
{
"answer": "Yes, because when both an IAM policy and a topic policy apply, access is granted if at least one allows and neither explicitly denies",
"isCorrect": true,
"explanation": "SNS evaluates IAM and topic resource policies together. If the IAM policy allows sns:Publish and the topic policy has no explicit deny, the user is granted access."
},
{
"answer": "No, the topic resource policy always takes precedence over IAM policies for SNS",
"isCorrect": false,
"explanation": "Neither policy type automatically takes precedence. Both are evaluated together, and access requires at least one allow with no explicit deny from either."
},
{
"answer": "Yes, but only if the topic resource policy explicitly grants access to all principals with a wildcard",
"isCorrect": false,
"explanation": "A wildcard in the topic policy is not required. The existing IAM policy allow is sufficient as long as there is no explicit deny in either policy."
}
]
},
{
"question": "What is the primary advantage of the SNS + SQS fan-out pattern compared to sending a message directly from a producer to multiple SQS queues?",
"answers": [
{
"answer": "It reduces the cost of SQS message storage",
"isCorrect": false,
"explanation": "The fan-out pattern does not inherently reduce SQS storage costs. Each SQS queue still stores its own copy of the message."
},
{
"answer": "It decouples the producer from having to know about or write to each individual consumer queue",
"isCorrect": true,
"explanation": "With SNS as the intermediary, the producer only needs to publish to a single topic. New consumers can subscribe without any changes to the producer, achieving loose coupling and independent scalability."
},
{
"answer": "It allows the producer to control the order in which each consumer receives the message",
"isCorrect": false,
"explanation": "SNS does not guarantee delivery order to different subscribers on Standard topics. FIFO topics guarantee ordering per message group, but not across different subscriber queues."
},
{
"answer": "It automatically batches messages for efficiency before delivering to each queue",
"isCorrect": false,
"explanation": "SNS does not batch messages when fanning out to SQS queues. Each published message is delivered individually to all subscribing queues."
}
]
},
{
"question": "A developer needs to implement cross-account access so that an SNS topic in Account A can be published to by an application running in Account B. Which mechanism must be used?",
"answers": [
{
"answer": "An IAM policy in Account A granting the Account B role sns:Publish",
"isCorrect": false,
"explanation": "IAM policies work for same-account access. For cross-account access, a topic resource policy on the SNS topic is required."
},
{
"answer": "A topic resource policy on the SNS topic in Account A granting sns:Publish to the Account B principal",
"isCorrect": true,
"explanation": "Cross-account SNS access requires a topic resource policy (similar to an S3 bucket policy) attached directly to the SNS topic, explicitly granting the cross-account principal permission to publish."
},
{
"answer": "An SCP (Service Control Policy) in AWS Organizations allowing cross-account SNS access",
"isCorrect": false,
"explanation": "SCPs set permission guardrails but do not grant permissions. They cannot substitute for the explicit allow required in a topic resource policy for cross-account access."
},
{
"answer": "No additional configuration is needed; SNS allows cross-account publishing by default",
"isCorrect": false,
"explanation": "Cross-account access is not allowed by default. An explicit topic resource policy must be configured to grant access to principals from another account."
}
]
},
{
"question": "A developer publishes a message to an SNS topic and includes 12 message attributes. What will happen?",
"answers": [
{
"answer": "The message is published successfully with all 12 attributes",
"isCorrect": false,
"explanation": "SNS allows a maximum of 10 message attributes per message. Publishing with 12 attributes will fail."
},
{
"answer": "SNS will reject the publish request because the maximum number of message attributes is 10",
"isCorrect": true,
"explanation": "SNS enforces a hard limit of 10 message attributes per message. Exceeding this limit results in a publish failure."
},
{
"answer": "SNS will silently drop the extra 2 attributes and deliver the message with 10 attributes",
"isCorrect": false,
"explanation": "SNS does not silently truncate attributes. It rejects the entire publish request if more than 10 attributes are provided."
},
{
"answer": "SNS will deliver the message but subscription filter policies will only evaluate the first 10 attributes",
"isCorrect": false,
"explanation": "SNS rejects the request outright when more than 10 message attributes are included. There is no partial processing."
}
]
},
{
"question": "On an SNS FIFO topic, a developer publishes several messages with the same Message Group ID. What is the guaranteed behavior?",
"answers": [
{
"answer": "Messages with the same group ID are delivered in strict FIFO order to subscribers",
"isCorrect": true,
"explanation": "Message group ID controls ordering on FIFO topics. All messages sharing the same group ID are delivered in the exact order they were published."
},
{
"answer": "Messages with the same group ID are automatically deduplicated",
"isCorrect": false,
"explanation": "Message group ID controls ordering, not deduplication. Deduplication is managed separately via a deduplication ID or content-based hashing."
},
{
"answer": "Messages with the same group ID are batched and delivered together as one payload",
"isCorrect": false,
"explanation": "SNS does not batch messages by group ID. Each message is delivered individually; the group ID only enforces delivery ordering."
},
{
"answer": "Messages with the same group ID are round-robin distributed across all subscribers",
"isCorrect": false,
"explanation": "SNS delivers each message to all subscribed consumers, not in a round-robin fashion. Round-robin is a pattern associated with competing consumers on SQS."
}
]
},
{
"question": "A developer wants SNS subscription filter policies to evaluate conditions on the body of the message rather than on message attributes. Which feature enables this?",
"answers": [
{
"answer": "Message deduplication ID",
"isCorrect": false,
"explanation": "Deduplication IDs are used to prevent duplicate message delivery on FIFO topics, not for content-based filtering."
},
{
"answer": "Payload-based filtering",
"isCorrect": true,
"explanation": "Payload-based filtering is a newer SNS feature that allows subscription filter policies to match on the message body itself, not just on message attributes."
},
{
"answer": "Server-Side Encryption (SSE)",
"isCorrect": false,
"explanation": "SSE encrypts message payloads at rest. It has no relation to filtering messages by their content."
},
{
"answer": "Topic resource policy conditions",
"isCorrect": false,
"explanation": "Topic resource policies control access permissions, not message filtering logic. Payload-based filtering is the correct mechanism here."
}
]
}
]
{{< /qcm >}}