---
title: "27. CloudTrail"
type: docs
weight: 3
---

## CloudTrail

Every action taken in your AWS account — whether from the console, CLI, SDK, or another AWS service — is an API call. CloudTrail records all of these calls, giving you a complete, auditable history of *who did what, when, and from where*. This makes it the foundational tool for security auditing, compliance, and forensic investigation. Without CloudTrail, answering questions like "who deleted that S3 bucket?" or "which IAM role created this resource at 2am?" would be nearly impossible.

CloudTrail is enabled by default in every AWS account, and the last 90 days of management activity are always available — no configuration required. For longer retention or advanced use, you create a **Trail**.

### Event Types

CloudTrail captures three categories of events [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html#cloudtrail-concepts-events):

- **Management events** — Operations on AWS resources themselves: creating an EC2 instance, attaching an IAM policy, deleting a VPC. These are recorded by default and represent the vast majority of what you'll audit. They are split into *read* (e.g., `DescribeInstances`) and *write* (e.g., `TerminateInstances`) events.
- **Data events** — High-volume, resource-level operations *within* a service: S3 object-level reads/writes (`GetObject`, `PutObject`), Lambda function invocations, DynamoDB item-level activity. Because these can be extremely noisy and costly, they are **not** enabled by default — you opt in explicitly per resource or resource type.
- **Insights events** — Automatically detected anomalies in your API call patterns, such as a sudden spike in `TerminateInstances` calls or an unusual volume of IAM actions. CloudTrail Insights compares current activity against a baseline and fires an event when something looks abnormal. This is covered in more detail below.

### Trails: Configuration and Storage

A **Trail** is a configuration that delivers a continuous stream of CloudTrail events to an S3 bucket, and optionally to CloudWatch Logs or EventBridge. You create a trail when you need retention beyond 90 days, cross-account visibility, or programmatic access to the raw log files [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-create-and-update-a-trail.html).

**Single-region vs. multi-region trails** — When creating a trail, you choose whether it applies to one region or all regions. A multi-region trail is strongly recommended: it ensures activity in every region (including regions you may not actively use) is captured in a single, centralized S3 bucket. If you only create a single-region trail, API activity in other regions is silently missed.

**S3 integration** — Log files are delivered to your chosen S3 bucket, typically within 15 minutes of the API call. The files are JSON-formatted and organized by account, region, and date. Enabling S3 server-side encryption (SSE-KMS) and access logging on that bucket are standard hardening steps to protect the audit trail itself.

### CloudTrail + CloudWatch Logs Integration

Sending CloudTrail events to CloudWatch Logs unlocks real-time monitoring and alerting on API activity [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/send-cloudtrail-events-to-cloudwatch-logs.html). Once the integration is configured, you can create **Metric Filters** on the log group to extract signals — for example, counting occurrences of `DeleteBucket` or root account logins — and attach CloudWatch Alarms to notify your team immediately when those events occur. This combination is a common pattern for compliance frameworks that require alerting on specific sensitive actions.

### Log File Integrity Validation

CloudTrail can generate a **digest file** for every hour of delivered logs [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html). Each digest file contains a hash of every log file delivered in that period, and digest files are chained together so that tampering with any log file — or deleting it — can be detected. You validate integrity using the AWS CLI:

```bash
aws cloudtrail validate-logs \
  --trail-arn arn:aws:cloudtrail:us-east-1:123456789012:trail/my-trail \
  --start-time 2024-01-01T00:00:00Z
```

This is a critical feature for security and compliance use cases: it gives you cryptographic proof that your audit logs haven't been altered after delivery.

### CloudTrail Insights

CloudTrail Insights [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-insights-events-with-cloudtrail.html) continuously analyzes write management events in your trail to establish a baseline of normal API activity. When it detects a statistically significant deviation — a burst of `CreateAccessKey` calls, an unusual number of `RunInstances` requests — it generates an Insights event. These events are stored in a separate prefix in your S3 bucket and can also be sent to CloudWatch or EventBridge for automated response. Insights must be explicitly enabled on a trail and incurs additional cost.

### Event History (No Trail Required)

Even without configuring a trail, every AWS account has access to **Event History** [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html) — a rolling 90-day record of management events in the current region, searchable directly from the CloudTrail console or via the `LookupEvents` API. This is often the first place you go when investigating a recent incident. For anything older than 90 days, or for data events, a trail with S3 delivery is required.

### Organization Trails

In a multi-account AWS environment using AWS Organizations, you can create an **organization trail** from the management account [🔗](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/creating-trail-organization.html). This automatically applies the trail to every existing and future member account in the organization, centralizing all API activity into a single S3 bucket. Member accounts can see that an organization trail exists but cannot modify or disable it — a key governance control that ensures no account can opt out of auditing.