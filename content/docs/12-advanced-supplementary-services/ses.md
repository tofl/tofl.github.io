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

{{< qcm >}}
[
{
"question": "A developer is building a new application that needs to send transactional emails. They want to use the AWS SDK to integrate email sending directly into their code. Which SES API actions can they use to send email? (Select TWO)",
"answers": [
{
"answer": "SendEmail",
"isCorrect": true,
"explanation": "SendEmail is one of the two core SES API actions for sending email, suitable for standard messages with text or HTML body."
},
{
"answer": "SendRawMessage",
"isCorrect": true,
"explanation": "SendRawMessage is the second core SES API action, used when you need full control over the MIME message, such as including attachments."
},
{
"answer": "PublishEmail",
"isCorrect": false,
"explanation": "PublishEmail does not exist in SES. PublishEmail is not a valid SES API action."
},
{
"answer": "DispatchMessage",
"isCorrect": false,
"explanation": "DispatchMessage is not a real SES API action. It does not exist in the SES API."
},
{
"answer": "PutEmailMessage",
"isCorrect": false,
"explanation": "PutEmailMessage is not a valid SES API action. SES uses SendEmail and SendRawMessage for sending."
}
]
},
{
"question": "A company has just created a new AWS account and wants to start sending marketing emails using Amazon SES. They attempt to send an email to a customer but the send fails. What is the most likely reason?",
"answers": [
{
"answer": "SES requires a dedicated IP address before sending any email.",
"isCorrect": false,
"explanation": "Dedicated IPs are optional and not required to begin sending. New accounts use shared IPs by default."
},
{
"answer": "New SES accounts start in sandbox mode, which restricts sending to verified email addresses only.",
"isCorrect": true,
"explanation": "All new SES accounts are placed in sandbox mode. In this mode, you can only send to addresses you have explicitly verified, and daily/per-second sending quotas are very low. You must request production access to send to arbitrary recipients."
},
{
"answer": "SES does not support marketing email, only transactional email.",
"isCorrect": false,
"explanation": "SES supports both transactional and marketing email sending at scale."
},
{
"answer": "The SES SMTP credentials have not been generated yet.",
"isCorrect": false,
"explanation": "While SMTP credentials are needed for the SMTP interface, this is not the root cause. The sandbox restriction is the primary blocker for sending to unverified addresses."
}
]
},
{
"question": "A developer wants to migrate a legacy application to use Amazon SES for email delivery. The application is already configured to use an SMTP client library and the team wants to minimize code changes. Which SES sending method should they use?",
"answers": [
{
"answer": "AWS SDK",
"isCorrect": false,
"explanation": "The AWS SDK is preferred for new application code but would require code changes to integrate, making it a poor fit for legacy SMTP-based apps with minimal change requirements."
},
{
"answer": "SMTP interface",
"isCorrect": true,
"explanation": "The SES SMTP interface is a drop-in replacement for any existing SMTP client. You simply point the existing app at the SES SMTP endpoint with SES SMTP credentials, requiring minimal code changes."
},
{
"answer": "SES API via direct HTTPS calls",
"isCorrect": false,
"explanation": "While the SES API is flexible, it would require significant code changes to an app already built around an SMTP client library."
},
{
"answer": "Amazon SNS",
"isCorrect": false,
"explanation": "SNS is a notification service and is not used for sending outbound email to recipients."
}
]
},
{
"question": "Which of the following are valid identity types that can be verified in Amazon SES? (Select TWO)",
"answers": [
{
"answer": "Email address identity",
"isCorrect": true,
"explanation": "SES allows you to verify a single email address as an identity. It is simple to set up but restricts sending to that exact address."
},
{
"answer": "Domain identity",
"isCorrect": true,
"explanation": "A domain identity verifies an entire domain, allowing any address at that domain to be used as the sender. This is the recommended approach for production use."
},
{
"answer": "IAM user identity",
"isCorrect": false,
"explanation": "IAM users are used for authentication and authorization in AWS, not as SES sending identities."
},
{
"answer": "IP address identity",
"isCorrect": false,
"explanation": "SES does not support IP address as a verified identity type. Identities are email addresses or domains."
}
]
},
{
"question": "A company wants to ensure the best email deliverability for their domain configured in Amazon SES. Which three email authentication standards should be configured? (Select THREE)",
"answers": [
{
"answer": "SPF (Sender Policy Framework)",
"isCorrect": true,
"explanation": "SPF declares which mail servers are authorized to send email on behalf of your domain, helping receiving servers validate the sender's legitimacy."
},
{
"answer": "DKIM (DomainKeys Identified Mail)",
"isCorrect": true,
"explanation": "DKIM attaches a cryptographic signature to outgoing messages so receivers can verify the message has not been tampered with. SES supports Easy DKIM where it manages the keys."
},
{
"answer": "DMARC",
"isCorrect": true,
"explanation": "DMARC is a policy layer on top of SPF and DKIM that instructs receiving mail servers what to do when authentication fails (e.g., quarantine or reject). Together, SPF, DKIM, and DMARC form the foundation of a trustworthy sending reputation."
},
{
"answer": "TLS (Transport Layer Security)",
"isCorrect": false,
"explanation": "TLS encrypts data in transit but is not one of the three email authentication standards referenced by SES for deliverability and domain reputation."
},
{
"answer": "MX (Mail Exchange) record",
"isCorrect": false,
"explanation": "MX records are used to route inbound email to a mail server, not to authenticate outbound email. They are not one of the three authentication standards for SES deliverability."
}
]
},
{
"question": "With Amazon SES Easy DKIM, what is the developer's responsibility to enable DKIM signing?",
"answers": [
{
"answer": "Generate RSA keys and upload the private key to SES.",
"isCorrect": false,
"explanation": "With Easy DKIM, SES generates and manages the cryptographic keys on your behalf. You do not need to generate or upload any keys."
},
{
"answer": "Publish the CNAME records provided by SES into your domain's DNS.",
"isCorrect": true,
"explanation": "With Easy DKIM, SES generates the key pair and provides CNAME records. The only action required from the developer is to publish those CNAME records in the domain's DNS configuration."
},
{
"answer": "Configure DKIM settings in IAM.",
"isCorrect": false,
"explanation": "DKIM configuration for SES is managed within SES itself and DNS, not through IAM."
},
{
"answer": "Enable DKIM from the SES console and no DNS changes are needed.",
"isCorrect": false,
"explanation": "DNS changes are always required for DKIM. SES generates the keys and provides CNAME records that must be added to the domain's DNS zone."
}
]
},
{
"question": "An application sends thousands of emails per day using Amazon SES. The team wants to be notified when email addresses bounce or when recipients mark emails as spam, so they can remove those addresses from their mailing list. How should they implement this?",
"answers": [
{
"answer": "Poll the SES GetSendStatistics API periodically to detect bounces and complaints.",
"isCorrect": false,
"explanation": "While GetSendStatistics provides aggregate metrics, it does not deliver per-address bounce/complaint details in real time. Polling is inefficient and does not provide the address-level data needed for list management."
},
{
"answer": "Configure SNS notification topics for bounces and complaints on the SES verified identity, and subscribe an SQS queue or Lambda function to process the events.",
"isCorrect": true,
"explanation": "SES routes bounce and complaint notifications through SNS. You configure a notification topic on the verified identity, and SES publishes a structured JSON event to that topic for each bounce or complaint. The application then processes these events (via SQS, Lambda, or HTTPS) and removes offending addresses."
},
{
"answer": "Enable SES event publishing to CloudWatch and create alarms for bounce metrics.",
"isCorrect": false,
"explanation": "CloudWatch alarms can alert on aggregate bounce rates but do not provide the per-address details needed to remove specific addresses from a mailing list."
},
{
"answer": "Configure an SES receipt rule to capture bounced emails.",
"isCorrect": false,
"explanation": "Receipt rules handle inbound email routing, not bounce/complaint feedback loops for outbound email."
}
]
},
{
"question": "What does Amazon SES automatically do with email addresses that persistently bounce?",
"answers": [
{
"answer": "It deletes the sending identity associated with those addresses.",
"isCorrect": false,
"explanation": "SES does not delete your sending identity based on recipient bounces. The action taken is suppression of the bouncing recipient address."
},
{
"answer": "It adds them to the account-level suppression list to prevent future sends to those addresses.",
"isCorrect": true,
"explanation": "SES maintains an account-level suppression list and automatically adds persistently bouncing addresses to it. This protects your sender reputation by preventing continued attempts to send to invalid addresses."
},
{
"answer": "It sends an alert to the AWS root account email.",
"isCorrect": false,
"explanation": "SES does not send alerts to the root account email for individual bouncing addresses. Bounce notifications are handled through SNS topics."
},
{
"answer": "It pauses the sending quota for the account.",
"isCorrect": false,
"explanation": "SES does not pause your sending quota for individual bounces. High bounce rates can lead to account review, but the automatic action for persistent bounces is suppression of the address."
}
]
},
{
"question": "A developer wants to track email opens, clicks, deliveries, and bounces for all transactional emails sent by their application. Which SES feature enables this full email lifecycle event tracking?",
"answers": [
{
"answer": "SES receipt rules",
"isCorrect": false,
"explanation": "Receipt rules handle inbound email processing, not outbound event tracking."
},
{
"answer": "Configuration sets with event destinations",
"isCorrect": true,
"explanation": "Configuration sets are named configurations you attach to a sending call. They route email lifecycle events (sends, deliveries, bounces, complaints, opens, clicks, rendering failures, rejects) to one or more event destinations such as CloudWatch, Kinesis Data Firehose, SNS, or EventBridge."
},
{
"answer": "SES sending quotas",
"isCorrect": false,
"explanation": "Sending quotas control the volume of email you can send (emails per day and per second), not event tracking."
},
{
"answer": "IAM CloudTrail logging",
"isCorrect": false,
"explanation": "CloudTrail logs API calls for auditing purposes but does not track email lifecycle events like opens, clicks, or deliveries."
}
]
},
{
"question": "Which of the following are supported event destinations for SES configuration sets? (Select THREE)",
"answers": [
{
"answer": "Amazon CloudWatch",
"isCorrect": true,
"explanation": "CloudWatch is a supported event destination, useful for creating dashboards and alarms on delivery rates and other email metrics."
},
{
"answer": "Amazon Kinesis Data Firehose",
"isCorrect": true,
"explanation": "Kinesis Data Firehose is a supported event destination, allowing you to stream email events into S3 or a data warehouse for long-term analysis."
},
{
"answer": "Amazon EventBridge",
"isCorrect": true,
"explanation": "EventBridge is a supported event destination, enabling routing of SES events to a wide range of AWS targets."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "RDS is a relational database service and is not a supported SES event destination. Events must flow through CloudWatch, Firehose, SNS, or EventBridge."
},
{
"answer": "Amazon DynamoDB Streams",
"isCorrect": false,
"explanation": "DynamoDB Streams is not a supported SES event destination. You could route events to DynamoDB indirectly via Lambda, but DynamoDB Streams is not a direct destination."
}
]
},
{
"question": "A team wants to analyze email engagement data (opens and clicks) over time for business intelligence purposes. They want the raw event data stored in Amazon S3. What is the recommended SES architecture?",
"answers": [
{
"answer": "Configure an SES configuration set with a Kinesis Data Firehose event destination that delivers to an S3 bucket.",
"isCorrect": true,
"explanation": "Attaching a configuration set to sending calls and routing open/click events to Kinesis Data Firehose is the recommended pattern for landing email engagement data in S3 for long-term analysis, without requiring third-party tooling."
},
{
"answer": "Use SES receipt rules to store engagement data in S3.",
"isCorrect": false,
"explanation": "Receipt rules handle inbound email routing (storing received messages), not outbound engagement events like opens and clicks."
},
{
"answer": "Configure CloudWatch to export email metrics directly to S3.",
"isCorrect": false,
"explanation": "CloudWatch stores aggregate metrics, not raw per-email event data. It is not the right tool for landing individual open/click events in S3."
},
{
"answer": "Subscribe an SQS queue to an SNS topic and batch-write messages to S3 using a cron job.",
"isCorrect": false,
"explanation": "While technically possible, this is a much more complex and fragile architecture compared to using Kinesis Data Firehose, which is purpose-built for streaming data delivery to S3."
}
]
},
{
"question": "A developer needs to build an automated system where inbound emails sent to support@example.com trigger a Lambda function that creates a support ticket. The domain example.com is already verified in SES. What SES feature should be used?",
"answers": [
{
"answer": "SES configuration sets with an SNS event destination",
"isCorrect": false,
"explanation": "Configuration sets handle outbound email event tracking, not inbound email processing."
},
{
"answer": "SES receipt rules with a Lambda action",
"isCorrect": true,
"explanation": "SES receipt rules are designed for inbound email processing. You can create a receipt rule that matches the recipient address and invokes a Lambda function with the message content, enabling automated workflows like support ticket creation."
},
{
"answer": "SES sandbox mode with an SMTP listener",
"isCorrect": false,
"explanation": "Sandbox mode is a restriction on new accounts for outbound email, not a feature for receiving email."
},
{
"answer": "An SQS queue subscribed to an SES notification topic",
"isCorrect": false,
"explanation": "SES notification topics via SNS are for bounce and complaint feedback on outbound email, not for processing inbound email content."
}
]
},
{
"question": "Which actions can be configured in an SES receipt rule? (Select THREE)",
"answers": [
{
"answer": "Store the raw email in an S3 bucket",
"isCorrect": true,
"explanation": "S3 is a supported receipt rule action. SES can store the full raw email message in an S3 bucket for later processing or archiving."
},
{
"answer": "Invoke a Lambda function with the message content",
"isCorrect": true,
"explanation": "Lambda is a supported receipt rule action, allowing custom processing of inbound emails such as parsing content, triggering workflows, or integrating with other services."
},
{
"answer": "Stop rule evaluation",
"isCorrect": true,
"explanation": "The Stop action halts further rule evaluation for a matched message, giving you control over rule precedence and preventing unintended processing by subsequent rules."
},
{
"answer": "Forward the email to an SES sending identity",
"isCorrect": false,
"explanation": "Forwarding to a sending identity is not a built-in receipt rule action. You would need to implement forwarding logic in a Lambda function triggered by a receipt rule."
},
{
"answer": "Write the email directly to an RDS database",
"isCorrect": false,
"explanation": "Direct RDS writes are not a supported receipt rule action. You would need a Lambda function to parse the email and write to a database."
}
]
},
{
"question": "A company's SES account has been approved for production access. They want to increase their sending quota beyond the default limits. What should they do?",
"answers": [
{
"answer": "Contact AWS Support to manually override sending limits.",
"isCorrect": false,
"explanation": "While AWS Support can help, the standard mechanism for increasing SES quotas is through Service Quotas, not a direct support contact."
},
{
"answer": "Submit a quota increase request through AWS Service Quotas.",
"isCorrect": true,
"explanation": "Once approved for production access, SES sending quota (emails per 24-hour period) and maximum send rate (emails per second) can be increased through the AWS Service Quotas service."
},
{
"answer": "Use multiple AWS accounts to multiply the available sending quota.",
"isCorrect": false,
"explanation": "Using multiple accounts to work around quotas is not the recommended approach and can violate AWS usage policies. The correct path is requesting a quota increase."
},
{
"answer": "Purchase a dedicated IP to remove all sending limits.",
"isCorrect": false,
"explanation": "Dedicated IPs improve deliverability and reputation control, but they do not remove sending quotas. Quotas are still managed through Service Quotas."
}
]
},
{
"question": "A developer is integrating Amazon SES into a new Node.js application and wants automatic request signing and retry handling. Which sending method is most appropriate?",
"answers": [
{
"answer": "SMTP interface",
"isCorrect": false,
"explanation": "The SMTP interface is best for legacy apps or frameworks that already use SMTP. It does not provide automatic AWS request signing or SDK-level retry logic."
},
{
"answer": "Direct HTTPS calls to the SES API",
"isCorrect": false,
"explanation": "Direct API calls are flexible but require you to implement request signing (SigV4) and retry logic yourself."
},
{
"answer": "AWS SDK",
"isCorrect": true,
"explanation": "The AWS SDK is the preferred method for new application code. It wraps the SES API, handles SigV4 request signing automatically, and provides built-in retry logic — reducing boilerplate and potential errors."
},
{
"answer": "Amazon SNS",
"isCorrect": false,
"explanation": "SNS is a pub/sub notification service, not a method for sending email to external recipients."
}
]
},
{
"question": "What must a developer do before Amazon SES will send email on behalf of a domain?",
"answers": [
{
"answer": "Create an IAM role with SES full access permissions.",
"isCorrect": false,
"explanation": "IAM permissions are required for the application to call the SES API, but they do not verify domain ownership. Domain verification via DNS is a separate, required step."
},
{
"answer": "Verify ownership of the domain by publishing DNS records required by SES.",
"isCorrect": true,
"explanation": "Before SES will send on behalf of a domain, the domain must be verified. This involves publishing DNS records (for domain verification, SPF, DKIM CNAME records, etc.) to prove ownership of the domain."
},
{
"answer": "Register the domain through Route 53.",
"isCorrect": false,
"explanation": "The domain does not need to be registered through Route 53. Any domain registrar can be used, as long as the required DNS records are published."
},
{
"answer": "Enable SES in the AWS Management Console and accept the terms of service.",
"isCorrect": false,
"explanation": "While you need to enable SES in a region, accepting terms of service alone does not verify domain ownership. DNS record publication is the actual verification mechanism."
}
]
},
{
"question": "Which SES event types are captured and can be routed through configuration sets? (Select THREE)",
"answers": [
{
"answer": "Sends",
"isCorrect": true,
"explanation": "SES emits a Send event whenever an email is successfully submitted for delivery, which can be routed via configuration sets."
},
{
"answer": "Opens",
"isCorrect": true,
"explanation": "SES tracks when a recipient opens an email (via a tracking pixel) and emits an Open event, which can be routed via configuration sets."
},
{
"answer": "Rendering failures",
"isCorrect": true,
"explanation": "Rendering failures occur when SES cannot render an email template, and this event type is captured and routable via configuration sets."
},
{
"answer": "DNS resolution failures",
"isCorrect": false,
"explanation": "DNS resolution failures for recipient mail servers are not an event type emitted by SES configuration sets. These are internal infrastructure concerns handled by SES."
},
{
"answer": "IAM policy evaluations",
"isCorrect": false,
"explanation": "IAM policy evaluations are logged in CloudTrail, not emitted as SES email lifecycle events."
}
]
}
]
{{< /qcm >}}