---
title: "31. Macie"
type: docs
weight: 4
---

## Macie

As applications grow, so does the amount of data they store in S3 — user uploads, logs, exports, backups. It becomes increasingly difficult to track whether any of that data contains sensitive information like names, email addresses, credit card numbers, or API keys. Amazon Macie exists to solve exactly this problem: it automatically scans S3 buckets using machine learning to detect sensitive and personally identifiable information (PII), and alerts you when it finds something — or when your bucket configurations expose data in risky ways.

Macie is particularly relevant in regulated industries (healthcare, finance, e-commerce) where accidental exposure of sensitive data carries legal and compliance consequences.

### How Macie Discovers Sensitive Data

Macie analyses S3 objects by running **sensitive data discovery jobs** [🔗](https://docs.aws.amazon.com/macie/latest/user/findings-sensitive-data.html) against one or more buckets. These jobs sample or fully scan object contents and classify them based on what Macie finds inside.

Macie uses two types of identifiers to recognise sensitive data:

- **Managed data identifiers** [🔗](https://docs.aws.amazon.com/macie/latest/user/managed-data-identifiers.html) are built-in detectors maintained by AWS. They cover a broad range of sensitive data categories out of the box — PII (names, addresses, passport numbers, national IDs), financial data (credit card numbers, bank account details), and credentials (AWS secret keys, private keys, OAuth tokens). You enable the categories relevant to your workload.

- **Custom data identifiers** [🔗](https://docs.aws.amazon.com/macie/latest/user/custom-data-identifiers.html) let you define your own detection patterns using a **regular expression**, combined with optional **keywords** that must appear near the match and an **ignore list** to suppress false positives. For example, you could write a custom identifier to detect internal employee IDs, patient record numbers, or proprietary reference codes that AWS wouldn't know about.

### Findings

When Macie detects something, it produces a **finding** [🔗](https://docs.aws.amazon.com/macie/latest/user/findings-types.html). There are two distinct categories:

- **Sensitive data findings** are generated when a discovery job finds sensitive content inside an S3 object — for example, a CSV export that contains credit card numbers or a log file with embedded AWS credentials.

- **Policy findings** are generated when a bucket's configuration changes in a way that reduces its security posture — for example, a bucket that was previously private becomes publicly accessible, or block public access settings are disabled. These are not about object content; they are about configuration drift.

Both finding types include details about the affected bucket, the object, the data category matched, and a severity level. Findings are retained for 90 days within Macie.

### Automated Remediation with EventBridge

Macie integrates natively with **Amazon EventBridge** [🔗](https://docs.aws.amazon.com/macie/latest/user/findings-publish-event-schemas.html), publishing findings as events in near real-time. This makes it straightforward to build automated response pipelines without polling Macie directly.

A typical pattern looks like this:

1. Macie generates a finding (e.g., a bucket policy finding indicating public exposure).
2. Macie publishes the finding to EventBridge.
3. An EventBridge rule matches on the finding type or severity.
4. The rule triggers an **SNS topic** to notify a security team, or invokes a **Lambda function** to take automated corrective action — for instance, re-applying a bucket policy, tagging the object for quarantine, or moving it to a restricted prefix.

This pattern is a common exam scenario: Macie surfaces the problem; EventBridge routes the event; Lambda or SNS handles the response. Understanding this three-part chain and being able to identify where each service fits is the key takeaway for the certification.

{{< qcm >}}
[
{
"question": "A company stores user uploads, logs, and backups in Amazon S3. The security team wants to automatically detect if any S3 objects contain personally identifiable information (PII) such as names, email addresses, or credit card numbers. Which AWS service should they use?",
"answers": [
{
"answer": "Amazon Macie",
"isCorrect": true,
"explanation": "Amazon Macie uses machine learning to automatically scan S3 buckets and detect sensitive data including PII, financial data, and credentials."
},
{
"answer": "Amazon GuardDuty",
"isCorrect": false,
"explanation": "GuardDuty is a threat detection service that monitors for malicious activity and unauthorized behavior, not for sensitive data classification within S3 objects."
},
{
"answer": "AWS Inspector",
"isCorrect": false,
"explanation": "AWS Inspector assesses EC2 instances and container images for software vulnerabilities and unintended network exposure. It does not scan S3 object contents for PII."
},
{
"answer": "AWS Config",
"isCorrect": false,
"explanation": "AWS Config tracks resource configuration changes and compliance, but it does not analyze S3 object contents for sensitive data."
}
]
},
{
"question": "A developer needs Amazon Macie to detect internal employee IDs stored in S3 objects. These IDs follow a proprietary format that AWS does not natively recognize. What is the correct approach?",
"answers": [
{
"answer": "Create a custom data identifier using a regular expression that matches the employee ID format",
"isCorrect": true,
"explanation": "Custom data identifiers allow you to define detection patterns with a regular expression, optional keywords, and an ignore list — ideal for proprietary formats AWS wouldn't know about."
},
{
"answer": "Enable all managed data identifiers and let Macie infer the format automatically",
"isCorrect": false,
"explanation": "Managed data identifiers are built-in and maintained by AWS. They cover standard categories like PII and financial data, but cannot detect proprietary internal formats."
},
{
"answer": "Use an S3 inventory report to identify objects and manually review them",
"isCorrect": false,
"explanation": "S3 inventory reports list objects and their metadata but do not analyze object content for sensitive data patterns."
},
{
"answer": "Configure an S3 event notification to trigger a Lambda function that scans objects with a regex",
"isCorrect": false,
"explanation": "While this could technically work as a custom solution, Macie's custom data identifiers are the purpose-built, managed approach for this exact use case."
}
]
},
{
"question": "Which of the following are valid components of a custom data identifier in Amazon Macie? (Select TWO)",
"answers": [
{
"answer": "A regular expression defining the data pattern to detect",
"isCorrect": true,
"explanation": "A regular expression is the core of a custom data identifier. It defines the pattern Macie will look for inside S3 objects."
},
{
"answer": "An ignore list to suppress false positives",
"isCorrect": true,
"explanation": "Custom data identifiers support an ignore list, which lets you exclude known non-sensitive matches and reduce false positives."
},
{
"answer": "A machine learning model trained on sample data",
"isCorrect": false,
"explanation": "Machine learning models are used internally by managed data identifiers, not by custom data identifiers. Custom identifiers rely on regex and keyword matching."
},
{
"answer": "A CloudWatch alarm threshold for detection frequency",
"isCorrect": false,
"explanation": "CloudWatch alarm thresholds are unrelated to Macie's data identifier configuration. Custom identifiers do not use CloudWatch metrics for detection."
}
]
},
{
"question": "Amazon Macie generates two categories of findings. Which of the following correctly describes each type? (Select TWO)",
"answers": [
{
"answer": "Sensitive data findings are generated when a discovery job detects sensitive content inside an S3 object",
"isCorrect": true,
"explanation": "Sensitive data findings are triggered by the content of S3 objects — for example, a CSV containing credit card numbers or a log file with embedded AWS credentials."
},
{
"answer": "Policy findings are generated when a bucket's configuration changes in a way that reduces its security posture",
"isCorrect": true,
"explanation": "Policy findings relate to configuration drift, such as a bucket becoming publicly accessible or block public access settings being disabled — not object content."
},
{
"answer": "Policy findings are generated when a discovery job scans more than a defined number of objects",
"isCorrect": false,
"explanation": "Policy findings are about bucket configuration changes, not scan volume thresholds. There is no such threshold-based policy finding type."
},
{
"answer": "Sensitive data findings are generated when an IAM user accesses an S3 bucket without MFA",
"isCorrect": false,
"explanation": "This describes an access control concern that might be flagged by GuardDuty or AWS Config, not a Macie sensitive data finding. Macie focuses on object content and bucket configuration."
}
]
},
{
"question": "A Macie finding indicates that an S3 bucket that was previously private is now publicly accessible. What type of Macie finding is this?",
"answers": [
{
"answer": "Policy finding",
"isCorrect": true,
"explanation": "Policy findings are triggered by bucket configuration changes that reduce security posture, such as a bucket becoming publicly accessible. They are not related to object content."
},
{
"answer": "Sensitive data finding",
"isCorrect": false,
"explanation": "Sensitive data findings are generated when a discovery job detects sensitive content inside an S3 object. A change in bucket access configuration is not a sensitive data finding."
},
{
"answer": "Compliance finding",
"isCorrect": false,
"explanation": "There is no 'compliance finding' category in Macie. The two categories are sensitive data findings and policy findings."
},
{
"answer": "Access finding",
"isCorrect": false,
"explanation": "Macie does not have an 'access finding' category. Configuration-based alerts fall under policy findings."
}
]
},
{
"question": "How long does Amazon Macie retain findings before they are deleted?",
"answers": [
{
"answer": "90 days",
"isCorrect": true,
"explanation": "Macie retains findings for 90 days. After this period, they are automatically removed from the Macie console."
},
{
"answer": "30 days",
"isCorrect": false,
"explanation": "30 days is not the correct retention period for Macie findings. Macie retains findings for 90 days."
},
{
"answer": "180 days",
"isCorrect": false,
"explanation": "180 days is incorrect. Macie findings are retained for 90 days."
},
{
"answer": "Indefinitely until manually deleted",
"isCorrect": false,
"explanation": "Macie findings are not retained indefinitely. They are automatically deleted after 90 days."
}
]
},
{
"question": "A security team wants to be automatically notified whenever Amazon Macie generates a finding indicating that an S3 bucket has become publicly accessible. They also want a Lambda function to automatically re-apply the correct bucket policy. What is the recommended architecture?",
"answers": [
{
"answer": "Macie publishes the finding to Amazon EventBridge → an EventBridge rule triggers both an SNS topic for notification and a Lambda function for remediation",
"isCorrect": true,
"explanation": "This is the canonical Macie remediation pattern: Macie surfaces the problem, EventBridge routes the event, and SNS/Lambda handle notification and automated remediation respectively."
},
{
"answer": "Macie publishes the finding to an SQS queue → a Lambda function polls the queue and sends an SNS notification",
"isCorrect": false,
"explanation": "Macie integrates natively with EventBridge, not SQS directly. The recommended pattern uses EventBridge as the event router between Macie and downstream services."
},
{
"answer": "Configure a CloudWatch alarm on Macie metrics → the alarm triggers an SNS topic → SNS invokes Lambda",
"isCorrect": false,
"explanation": "Macie integrates with EventBridge, not through CloudWatch alarms. Routing via CloudWatch alarms adds unnecessary complexity and is not the recommended pattern."
},
{
"answer": "Poll the Macie API periodically with a Lambda function and send findings to SNS",
"isCorrect": false,
"explanation": "Polling Macie directly is explicitly an anti-pattern. EventBridge integration provides near real-time event delivery without the need for polling."
}
]
},
{
"question": "In the Amazon Macie + EventBridge remediation pattern, what is the role of Amazon EventBridge?",
"answers": [
{
"answer": "It receives Macie findings as events and routes them to downstream services such as SNS or Lambda based on rules",
"isCorrect": true,
"explanation": "EventBridge acts as the event router in this pattern. It receives findings published by Macie and applies rules to trigger the appropriate response — SNS notification, Lambda remediation, or both."
},
{
"answer": "It stores Macie findings long-term for compliance auditing",
"isCorrect": false,
"explanation": "EventBridge is an event bus for routing events, not a storage or auditing service. Long-term storage of findings would require exporting them to S3 or a SIEM."
},
{
"answer": "It scans S3 buckets on behalf of Macie and reports results",
"isCorrect": false,
"explanation": "S3 scanning is performed by Macie itself through sensitive data discovery jobs. EventBridge has no role in the scanning process."
},
{
"answer": "It applies bucket policies directly when a policy finding is detected",
"isCorrect": false,
"explanation": "EventBridge does not apply bucket policies. It routes events to Lambda, which would then perform the actual remediation such as re-applying a bucket policy."
}
]
},
{
"question": "A company in the healthcare industry needs to ensure that S3 buckets do not contain files with patient record numbers, which follow an internal format. They also want to detect standard PII such as passport numbers. Which Macie features should they use? (Select TWO)",
"answers": [
{
"answer": "Managed data identifiers for standard PII such as passport numbers",
"isCorrect": true,
"explanation": "Managed data identifiers are built-in AWS detectors that cover standard sensitive data categories including PII such as passport numbers and national IDs — no configuration required beyond enabling the relevant categories."
},
{
"answer": "Custom data identifiers with a regex for the internal patient record number format",
"isCorrect": true,
"explanation": "Custom data identifiers are designed for proprietary patterns that AWS cannot know about. A regex-based custom identifier is the correct tool for detecting internal patient record numbers."
},
{
"answer": "S3 Object Lambda to intercept and inspect objects before they are stored",
"isCorrect": false,
"explanation": "S3 Object Lambda modifies object content on retrieval, not for sensitive data classification. It is not a Macie feature and is not the right tool for this use case."
},
{
"answer": "AWS Secrets Manager to scan S3 for exposed credentials",
"isCorrect": false,
"explanation": "AWS Secrets Manager stores and manages secrets; it does not scan S3 objects for sensitive data. Macie managed data identifiers can detect credentials like AWS secret keys."
}
]
},
{
"question": "Which statement best describes how Amazon Macie analyses S3 objects for sensitive data?",
"answers": [
{
"answer": "Macie runs sensitive data discovery jobs that sample or fully scan object contents and classify them based on what is found",
"isCorrect": true,
"explanation": "Macie uses sensitive data discovery jobs to analyse S3 objects. These jobs can sample or fully scan object contents and classify them using managed and/or custom data identifiers."
},
{
"answer": "Macie continuously streams all S3 object writes in real time and classifies each object immediately upon upload",
"isCorrect": false,
"explanation": "Macie does not continuously stream object writes in real time. Sensitive data discovery is performed through jobs that are configured to run against selected buckets."
},
{
"answer": "Macie reads S3 object metadata and tags to infer whether sensitive data is present",
"isCorrect": false,
"explanation": "Macie analyses object content, not just metadata or tags. Relying on metadata alone would miss sensitive data inside files."
},
{
"answer": "Macie integrates with S3 server-side encryption to decrypt and inspect objects stored with SSE-KMS",
"isCorrect": false,
"explanation": "While Macie can analyse encrypted objects it has permissions to access, this is not the primary description of how Macie works. The core mechanism is sensitive data discovery jobs analysing object contents."
}
]
}
]
{{< /qcm >}}