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

{{< qcm >}}
[
{
"question": "A security engineer needs to investigate who deleted an S3 bucket in their AWS account three days ago. They have not configured any CloudTrail trails. Where can they find this information?",
"answers": [
{
"answer": "CloudTrail Event History in the CloudTrail console",
"isCorrect": true,
"explanation": "CloudTrail Event History provides a rolling 90-day record of management events (including S3 bucket deletion) without requiring any trail configuration. It is searchable directly from the console or via the LookupEvents API."
},
{
"answer": "CloudWatch Logs",
"isCorrect": false,
"explanation": "CloudWatch Logs only receives CloudTrail events if a trail has been explicitly configured to deliver logs there. Since no trail exists, no data was sent to CloudWatch Logs."
},
{
"answer": "S3 server access logs",
"isCorrect": false,
"explanation": "S3 server access logs track object-level requests to a bucket, not management-level operations like bucket deletion performed via the AWS API. This is not the right source for this type of event."
},
{
"answer": "AWS Config",
"isCorrect": false,
"explanation": "AWS Config tracks resource configuration changes over time but is not a substitute for CloudTrail event history. It would not provide the detailed API call record (who, when, from where) that CloudTrail offers."
}
]
},
{
"question": "A company wants to retain CloudTrail logs for 2 years for compliance purposes. What must they configure to achieve this?",
"answers": [
{
"answer": "Create a CloudTrail Trail that delivers logs to an S3 bucket",
"isCorrect": true,
"explanation": "The default Event History only retains 90 days of management events. To retain logs beyond 90 days, you must create a Trail, which continuously delivers log files to an S3 bucket where you can apply your own retention policies."
},
{
"answer": "Enable CloudTrail Insights",
"isCorrect": false,
"explanation": "CloudTrail Insights detects anomalies in API call patterns. It does not extend log retention or replace the need for a Trail with S3 delivery."
},
{
"answer": "Increase the Event History retention period in the CloudTrail console settings",
"isCorrect": false,
"explanation": "The 90-day Event History retention is fixed and cannot be extended through any console setting. A Trail with S3 delivery is required for longer retention."
},
{
"answer": "Configure a CloudWatch Logs log group with a 2-year retention policy",
"isCorrect": false,
"explanation": "While sending CloudTrail events to CloudWatch Logs is useful for real-time alerting, it still requires a Trail to be configured first. CloudWatch Logs alone cannot be a primary long-term audit store without the Trail setup."
}
]
},
{
"question": "Which of the following are CloudTrail event types? (Select THREE)",
"answers": [
{
"answer": "Management events",
"isCorrect": true,
"explanation": "Management events record operations on AWS resources themselves (e.g., creating an EC2 instance, deleting a VPC). They are enabled by default and are the most commonly audited event type."
},
{
"answer": "Data events",
"isCorrect": true,
"explanation": "Data events record high-volume, resource-level operations within a service, such as S3 object reads/writes or Lambda invocations. They must be explicitly opted into because they can be noisy and costly."
},
{
"answer": "Insights events",
"isCorrect": true,
"explanation": "Insights events are automatically generated when CloudTrail detects statistically significant anomalies in write management API call patterns, such as a sudden spike in TerminateInstances calls."
},
{
"answer": "Network events",
"isCorrect": false,
"explanation": "There is no 'Network events' category in CloudTrail. Network-level monitoring is handled by services like VPC Flow Logs, not CloudTrail."
},
{
"answer": "Compliance events",
"isCorrect": false,
"explanation": "'Compliance events' is not a CloudTrail event type. CloudTrail captures management, data, and insights events. Compliance evaluation is a function of AWS Config, not CloudTrail."
}
]
},
{
"question": "By default, which CloudTrail event type is NOT recorded without explicit opt-in?",
"answers": [
{
"answer": "Data events",
"isCorrect": true,
"explanation": "Data events (e.g., S3 GetObject/PutObject, Lambda invocations, DynamoDB item-level activity) are not enabled by default because they can be extremely high-volume and costly. You must opt in per resource or resource type."
},
{
"answer": "Management events",
"isCorrect": false,
"explanation": "Management events are recorded by default. They cover operations on AWS resources such as creating or deleting EC2 instances, attaching IAM policies, etc."
},
{
"answer": "Read management events",
"isCorrect": false,
"explanation": "Read management events (e.g., DescribeInstances) are a subcategory of management events and are recorded by default, though you can choose to filter them out to reduce noise."
},
{
"answer": "Write management events",
"isCorrect": false,
"explanation": "Write management events (e.g., TerminateInstances) are also recorded by default as part of management events. No opt-in is required."
}
]
},
{
"question": "A developer wants to track every time a specific Lambda function is invoked in their AWS account. What must they configure in CloudTrail?",
"answers": [
{
"answer": "Enable data events for the Lambda function in a CloudTrail Trail",
"isCorrect": true,
"explanation": "Lambda function invocations are data events in CloudTrail. Data events are not enabled by default and must be explicitly opted into on a per-resource or resource-type basis within a Trail configuration."
},
{
"answer": "Enable CloudTrail Insights on the Trail",
"isCorrect": false,
"explanation": "CloudTrail Insights detects anomalies in API call patterns; it does not record individual Lambda invocations. You need data events for that."
},
{
"answer": "Nothing — Lambda invocations are recorded automatically as management events",
"isCorrect": false,
"explanation": "Lambda invocations are data events, not management events. They are not recorded by default and require explicit configuration."
},
{
"answer": "Create a CloudWatch Logs metric filter on the Lambda log group",
"isCorrect": false,
"explanation": "CloudWatch Logs metric filters work on application-level logs produced by Lambda, not on CloudTrail invocation records. This would not give you a CloudTrail audit record of each invocation."
}
]
},
{
"question": "A company operates in multiple AWS regions. A security team discovers that API activity in eu-west-2 was not captured in their audit logs, even though they had a CloudTrail trail configured. What is the most likely cause?",
"answers": [
{
"answer": "The trail was configured as a single-region trail, not a multi-region trail",
"isCorrect": true,
"explanation": "A single-region trail only captures activity in the region where it was created. API activity in other regions is silently missed. A multi-region trail is strongly recommended to capture activity across all regions in a single centralized S3 bucket."
},
{
"answer": "CloudTrail is not available in eu-west-2",
"isCorrect": false,
"explanation": "CloudTrail is available in all AWS commercial regions, including eu-west-2. Availability is not the issue here."
},
{
"answer": "Data events were not enabled for eu-west-2",
"isCorrect": false,
"explanation": "Data events are a separate category and would not explain the absence of management event logs in a region. The root cause is the single-region trail configuration."
},
{
"answer": "The S3 bucket for log delivery was in a different region",
"isCorrect": false,
"explanation": "CloudTrail can deliver logs to an S3 bucket in a different region without any issues. Cross-region log delivery is standard and not a cause for missing logs."
}
]
},
{
"question": "A compliance officer needs to verify that CloudTrail log files delivered to S3 have not been tampered with or deleted since their delivery. Which CloudTrail feature should they use?",
"answers": [
{
"answer": "Log file integrity validation",
"isCorrect": true,
"explanation": "Log file integrity validation causes CloudTrail to generate hourly digest files containing hashes of all delivered log files. Digest files are chained together, so any tampering or deletion can be cryptographically detected using the AWS CLI validate-logs command."
},
{
"answer": "CloudTrail Insights",
"isCorrect": false,
"explanation": "CloudTrail Insights detects anomalies in API call patterns. It does not provide cryptographic verification of log file integrity."
},
{
"answer": "S3 versioning on the log bucket",
"isCorrect": false,
"explanation": "S3 versioning preserves previous versions of objects but does not provide cryptographic proof that logs were unmodified after delivery. Log file integrity validation is the correct mechanism."
},
{
"answer": "CloudWatch Logs metric filters",
"isCorrect": false,
"explanation": "Metric filters extract signals from CloudWatch Logs for alerting purposes. They have no role in verifying the integrity of CloudTrail log files stored in S3."
}
]
},
{
"question": "Which AWS CLI command is used to verify the integrity of CloudTrail log files?",
"answers": [
{
"answer": "aws cloudtrail validate-logs",
"isCorrect": true,
"explanation": "The aws cloudtrail validate-logs command uses the digest files generated by CloudTrail's log file integrity validation feature to cryptographically verify that no log files have been modified or deleted since delivery."
},
{
"answer": "aws cloudtrail lookup-events",
"isCorrect": false,
"explanation": "aws cloudtrail lookup-events is used to query Event History for recent management events. It does not validate the integrity of log files stored in S3."
},
{
"answer": "aws s3 checksum",
"isCorrect": false,
"explanation": "There is no aws s3 checksum command. Integrity validation of CloudTrail logs is performed specifically through the aws cloudtrail validate-logs command using CloudTrail's own digest chain."
},
{
"answer": "aws cloudtrail get-trail-status",
"isCorrect": false,
"explanation": "aws cloudtrail get-trail-status returns operational information about a trail (e.g., last delivery time, last log file delivered). It does not verify log file integrity."
}
]
},
{
"question": "A security team wants to receive an immediate alert whenever someone uses the AWS root account to log in. Which combination of services should they use?",
"answers": [
{
"answer": "CloudTrail + CloudWatch Logs + CloudWatch Metric Filter + CloudWatch Alarm + SNS",
"isCorrect": true,
"explanation": "This is the standard pattern: CloudTrail sends events to CloudWatch Logs, a Metric Filter extracts root login events, a CloudWatch Alarm triggers when the count is non-zero, and SNS sends the notification. This enables real-time alerting on specific sensitive API actions."
},
{
"answer": "CloudTrail Insights + SNS",
"isCorrect": false,
"explanation": "CloudTrail Insights detects statistical anomalies in write management events over time. It would not necessarily fire on a single root login event, which may not be statistically anomalous. The metric filter approach is the correct pattern for this use case."
},
{
"answer": "S3 event notifications on the CloudTrail log bucket",
"isCorrect": false,
"explanation": "S3 event notifications fire when objects are created or deleted in a bucket, not when specific API events occur within those log files. You cannot use S3 notifications to parse CloudTrail log content in real time."
},
{
"answer": "AWS Config rules + SNS",
"isCorrect": false,
"explanation": "AWS Config evaluates resource configuration compliance. It does not monitor or alert on specific real-time API call events like root account logins."
}
]
},
{
"question": "What does CloudTrail Insights analyze to detect anomalies?",
"answers": [
{
"answer": "Write management events",
"isCorrect": true,
"explanation": "CloudTrail Insights continuously analyzes write management events (e.g., RunInstances, CreateAccessKey, TerminateInstances) to establish a baseline and detect statistically significant deviations from normal activity."
},
{
"answer": "Read management events",
"isCorrect": false,
"explanation": "CloudTrail Insights focuses on write management events, not read events. Read events like DescribeInstances are not analyzed by Insights."
},
{
"answer": "Data events",
"isCorrect": false,
"explanation": "CloudTrail Insights does not analyze data events such as S3 object reads/writes or Lambda invocations. Its scope is limited to write management events."
},
{
"answer": "CloudWatch Logs metric values",
"isCorrect": false,
"explanation": "CloudTrail Insights operates independently of CloudWatch Logs. It analyzes the CloudTrail event stream directly, not CloudWatch metrics."
}
]
},
{
"question": "A company with 50 AWS accounts managed under AWS Organizations wants to centralize all API activity logs into a single S3 bucket, ensuring no member account can disable logging. What is the recommended approach?",
"answers": [
{
"answer": "Create an organization trail from the management account",
"isCorrect": true,
"explanation": "An organization trail created from the management account automatically applies to all existing and future member accounts. Member accounts can see the trail but cannot modify or disable it, providing a strong governance control and centralized audit log."
},
{
"answer": "Create individual trails in each of the 50 accounts and configure them to deliver to the same S3 bucket",
"isCorrect": false,
"explanation": "While technically possible, this approach is operationally complex, does not scale to new accounts automatically, and does not prevent member accounts from disabling their own trails. The organization trail is the correct solution."
},
{
"answer": "Enable CloudTrail Event History in each account and export it daily to S3",
"isCorrect": false,
"explanation": "Event History is limited to 90 days, is region-specific, and there is no built-in export mechanism. This approach does not scale and would leave gaps in coverage."
},
{
"answer": "Use AWS Config aggregator to collect CloudTrail logs across accounts",
"isCorrect": false,
"explanation": "AWS Config aggregator collects compliance and configuration data across accounts, not CloudTrail raw log files. It is not a mechanism for centralizing CloudTrail audit logs."
}
]
},
{
"question": "Which of the following statements about CloudTrail organization trails are correct? (Select TWO)",
"answers": [
{
"answer": "An organization trail automatically applies to all current and future member accounts in the organization",
"isCorrect": true,
"explanation": "This is a key benefit of organization trails: they are automatically applied to every existing and future member account, eliminating the need to configure individual trails per account."
},
{
"answer": "Member accounts cannot modify or disable an organization trail",
"isCorrect": true,
"explanation": "Member accounts can see that an organization trail exists but cannot modify or disable it. This is a critical governance control ensuring no account can opt out of auditing."
},
{
"answer": "Organization trails can only be created from a member account",
"isCorrect": false,
"explanation": "Organization trails must be created from the management (master) account of the AWS Organization. Member accounts do not have this capability."
},
{
"answer": "Organization trails only capture data events across member accounts",
"isCorrect": false,
"explanation": "Organization trails capture all configured event types (management events by default, and optionally data events and Insights events), not just data events."
}
]
},
{
"question": "How soon after an API call are CloudTrail log files typically delivered to the S3 bucket?",
"answers": [
{
"answer": "Within 15 minutes",
"isCorrect": true,
"explanation": "CloudTrail delivers log files to the designated S3 bucket typically within 15 minutes of the API call. This is not real-time but is sufficient for near-real-time audit purposes."
},
{
"answer": "Within 1 minute",
"isCorrect": false,
"explanation": "CloudTrail does not guarantee delivery within 1 minute. The typical delivery time is within 15 minutes. For real-time monitoring, CloudWatch Logs integration is a better option."
},
{
"answer": "Within 1 hour",
"isCorrect": false,
"explanation": "While 1 hour is the period used for digest file generation, log delivery itself typically occurs within 15 minutes, not an hour."
},
{
"answer": "Immediately upon the API call",
"isCorrect": false,
"explanation": "CloudTrail log delivery to S3 is not real-time. There is a delay, typically up to 15 minutes. For near real-time visibility, sending events to CloudWatch Logs is recommended."
}
]
},
{
"question": "A developer queries the CloudTrail LookupEvents API to find who terminated an EC2 instance. The event they need is from 4 months ago but is not returned. What is the most likely reason?",
"answers": [
{
"answer": "LookupEvents only returns events from the last 90 days (Event History)",
"isCorrect": true,
"explanation": "The LookupEvents API (and the Event History in the console) only covers the last 90 days of management events. For events older than 90 days, a Trail with S3 delivery must have been configured and the logs queried from S3 directly or via Athena."
},
{
"answer": "EC2 termination events are data events and are never visible in LookupEvents",
"isCorrect": false,
"explanation": "EC2 instance termination (TerminateInstances) is a management event (write), not a data event. It is visible in Event History/LookupEvents within the 90-day window."
},
{
"answer": "LookupEvents requires a Trail to be configured",
"isCorrect": false,
"explanation": "LookupEvents works without a Trail configuration — it queries the built-in 90-day Event History. The issue here is the 90-day retention limit, not the absence of a Trail."
},
{
"answer": "The event was not recorded because CloudTrail was not enabled",
"isCorrect": false,
"explanation": "CloudTrail management event recording is enabled by default in every AWS account. The most likely reason the event is not returned is that it falls outside the 90-day Event History window."
}
]
},
{
"question": "Which of the following best describes the purpose of CloudTrail digest files?",
"answers": [
{
"answer": "They allow detection of any tampering or deletion of CloudTrail log files after delivery",
"isCorrect": true,
"explanation": "Digest files are generated hourly and contain cryptographic hashes of all log files delivered in that period. They are chained together so that any modification or deletion of a log file can be detected, providing cryptographic proof of log integrity."
},
{
"answer": "They provide a compressed summary of the most important events in each hour",
"isCorrect": false,
"explanation": "Digest files are not summaries of events. They are cryptographic integrity files containing hashes of log files, used solely to verify that logs have not been altered."
},
{
"answer": "They enable CloudTrail Insights to detect anomalies",
"isCorrect": false,
"explanation": "CloudTrail Insights analyzes write management events from the trail itself, not from digest files. Digest files serve an entirely different purpose: integrity validation."
},
{
"answer": "They replace the need for S3 server-side encryption on the log bucket",
"isCorrect": false,
"explanation": "Digest files provide integrity verification, not confidentiality. S3 server-side encryption (SSE-KMS) is still recommended to protect the contents of log files from unauthorized access."
}
]
},
{
"question": "A company wants to automatically detect when an unusually large number of IAM access keys are created in a short period, which could indicate a compromised automation script. Which CloudTrail feature is best suited for this?",
"answers": [
{
"answer": "CloudTrail Insights",
"isCorrect": true,
"explanation": "CloudTrail Insights is designed exactly for this use case. It analyzes write management events (like CreateAccessKey) against a baseline and fires an Insights event when it detects a statistically significant deviation, such as a burst of access key creation."
},
{
"answer": "CloudTrail Event History",
"isCorrect": false,
"explanation": "Event History lets you search past events but does not automatically analyze patterns or detect anomalies. It is a reactive lookup tool, not a proactive detection mechanism."
},
{
"answer": "CloudTrail log file integrity validation",
"isCorrect": false,
"explanation": "Log file integrity validation detects tampering with log files. It does not analyze API call patterns or detect behavioral anomalies."
},
{
"answer": "A CloudTrail multi-region trail",
"isCorrect": false,
"explanation": "A multi-region trail ensures comprehensive log capture across regions but does not inherently analyze activity patterns or generate anomaly alerts."
}
]
},
{
"question": "Which of the following are recommended security hardening steps for the S3 bucket used to store CloudTrail logs? (Select TWO)",
"answers": [
{
"answer": "Enable S3 server-side encryption with KMS (SSE-KMS)",
"isCorrect": true,
"explanation": "Enabling SSE-KMS on the CloudTrail log bucket protects the confidentiality of audit logs at rest, ensuring only authorized principals with access to the KMS key can read the log files."
},
{
"answer": "Enable S3 access logging on the CloudTrail log bucket",
"isCorrect": true,
"explanation": "Enabling access logging on the CloudTrail S3 bucket creates an audit trail of who accessed the log bucket itself. This helps detect unauthorized access to or tampering with your audit records."
},
{
"answer": "Enable S3 Transfer Acceleration on the CloudTrail log bucket",
"isCorrect": false,
"explanation": "S3 Transfer Acceleration speeds up uploads via CloudFront edge locations but has no bearing on the security or integrity of the stored CloudTrail logs. It is not a relevant hardening step."
},
{
"answer": "Disable S3 versioning to prevent log file duplication",
"isCorrect": false,
"explanation": "Disabling versioning would actually reduce protection, not improve it. S3 versioning can be a useful complement to log file integrity validation by preserving prior versions of log files if they are overwritten."
}
]
},
{
"question": "CloudTrail is enabled by default in every AWS account. What does this provide without any additional configuration?",
"answers": [
{
"answer": "A 90-day rolling history of management events in each region, viewable in the console or via LookupEvents",
"isCorrect": true,
"explanation": "Without any configuration, every AWS account has access to Event History: a 90-day, per-region record of management events. This is available immediately in the CloudTrail console and via the LookupEvents API."
},
{
"answer": "Continuous delivery of all event types to an S3 bucket",
"isCorrect": false,
"explanation": "S3 delivery requires explicit Trail configuration. The default CloudTrail setup provides Event History in the console but does not deliver logs to S3."
},
{
"answer": "Real-time CloudWatch Alarms for sensitive API calls",
"isCorrect": false,
"explanation": "CloudWatch Alarms require a Trail, CloudWatch Logs integration, and metric filter configuration. None of this is set up by default."
},
{
"answer": "Anomaly detection via CloudTrail Insights across all regions",
"isCorrect": false,
"explanation": "CloudTrail Insights must be explicitly enabled on a Trail and incurs additional cost. It is not active by default."
}
]
}
]
{{< /qcm >}}