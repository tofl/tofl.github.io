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