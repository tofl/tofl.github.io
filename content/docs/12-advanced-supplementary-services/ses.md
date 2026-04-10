---
title: "45. SES"
type: docs
weight: 8
---

## SES (Simple Email Service)

Sending email from an application sounds simple until you have to deal with deliverability, spam reputation, bounce management, and mail server infrastructure. Amazon SES exists to solve exactly that: it is a cloud-based email sending service that lets you send transactional and marketing email at scale without operating your own mail server or worrying about IP reputation. It handles the SMTP infrastructure, deliverability optimizations, and feedback loops with inbox providers on your behalf.

### Sending Methods

SES gives you three ways to send email, which you choose based on how your application is built:

- **SMTP interface** — drop-in replacement for any existing SMTP client. Point your app or email library at the SES SMTP endpoint with your SMTP credentials [🔗](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html). Useful for frameworks or legacy apps that already speak SMTP.
- **SES API** — direct HTTPS calls to the `SendEmail` or `SendRawMessage` API actions. Most flexible option for custom integrations [🔗](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendEmail.html).
- **AWS SDK** — wraps the API for your language of choice (Python, Node.js, Java, etc.). Preferred for new application code since it handles request signing and retries automatically [🔗](https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html).

### Sandbox Mode and Sending Limits

New SES accounts start in **sandbox mode**, which restricts you to sending only to verified email addresses and imposes low daily and per-second sending quotas. This is a deliberate friction point to prevent abuse before AWS has had a chance to evaluate your sending patterns. To send to arbitrary recipients in production, you must submit a request to move out of the sandbox [🔗](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html). Once approved, your account receives a **sending quota** (maximum emails per 24-hour period) and a **maximum send rate** (emails per second), both of which can be increased through Service Quotas.

### Identities: Email Addresses vs Domains

Before SES will send email on your behalf, you must verify that you own the sending address or domain. SES supports two identity types:

- **Email address identity** — verify a single address. Simple to set up, but you can only send from that exact address.
- **Domain identity** — verify an entire domain, allowing any address at that domain as the sender. Required for production use.

Domain verification is done by publishing DNS records, and SES expects three authentication standards to be in place for good deliverability:

- **SPF** (Sender Policy Framework) — declares which servers are authorized to send on behalf of your domain [🔗](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-spf.html).
- **DKIM** (DomainKeys Identified Mail) — attaches a cryptographic signature to outgoing messages so receivers can verify the message was not tampered with. SES supports Easy DKIM, where it generates the keys and you just publish the provided CNAME records [🔗](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim.html).
- **DMARC** — policy layer on top of SPF and DKIM that tells receiving mail servers what to do when a message fails authentication (e.g., quarantine or reject it) [🔗](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

All three together are the foundation of a trustworthy sending reputation.

### Bounce and Complaint Handling

When you send email at scale, some messages will inevitably bounce (the recipient address does not exist or the mailbox is full) and some recipients will click "Mark as spam" (a complaint). These events are critical to monitor because inbox providers will penalize senders with high bounce or complaint rates by sending their mail to spam or blocking it entirely.

SES automatically handles the feedback loop by routing these notifications through **SNS**. You configure a **notification topic** for bounces and complaints on your verified identity, and SES publishes a structured JSON event to that topic whenever one occurs [🔗](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html). Your application subscribes to those topics (via SQS, Lambda, or HTTPS) and takes corrective action — typically removing the offending address from your mailing list. SES will also automatically suppress persistently bouncing addresses in your **account-level suppression list** [🔗](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html).

### SES Event Publishing

Beyond bounces and complaints, SES can emit a full event stream covering the entire email lifecycle: **sends, deliveries, bounces, complaints, opens, clicks, rendering failures, and rejects**. This is done through **configuration sets** — a named configuration you attach to a sending call that routes events to one or more **event destinations** [🔗](https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html).

Supported event destinations include:
- **CloudWatch** — for dashboards and alarms on delivery rates
- **Kinesis Data Firehose** — to stream events into S3 or a data warehouse for long-term analysis
- **SNS** — for near-real-time notifications to downstream systems
- **EventBridge** — for routing events to a wide range of AWS targets

A concrete example: attach a configuration set to every transactional email your application sends, route open and click events to Firehose, and land them in S3 for analysis. This gives you a complete audit trail of email engagement without third-party tooling.

### SES Email Receiving

SES can also **receive** inbound email for your verified domain and trigger automated processing through **receipt rules** [🔗](https://docs.aws.amazon.com/ses/latest/dg/receiving-email.html). Receipt rules are evaluated in order against the recipient address and can perform one or more actions:

- **S3** — store the raw message in an S3 bucket
- **Lambda** — invoke a function with the message content for custom processing (e.g., parse an email and create a support ticket)
- **SNS** — publish a notification with the message content
- **Stop** — halt rule evaluation

This makes SES a useful building block for email-driven workflows, such as processing incoming invoices, handling reply-to flows, or building a lightweight inbound email parser — without managing an MX server.