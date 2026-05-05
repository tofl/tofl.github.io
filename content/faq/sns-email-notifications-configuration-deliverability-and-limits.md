---
title: "SNS Email Notifications: Configuration, Deliverability, and Limits"
---

## SNS Email Notifications: Configuration, Deliverability, and Limits

Email has remained one of the most reliable notification channels for decades, and AWS Simple Notification Service (SNS) makes it straightforward to add email capabilities to your applications. However, SNS email isn't a fire-and-forget feature—it comes with a specific set of constraints, configuration requirements, and operational considerations that many developers discover only after their first production incident. Understanding these nuances is essential for building reliable notification systems that actually reach your users' inboxes.

In this guide, we'll explore how SNS email notifications work, from the initial subscription flow through the confirmation workflow, the different message formats available, and the sandbox limitations that catch many developers off guard. We'll also cover deliverability best practices and the crucial moment when you'll know it's time to graduate to Amazon SES for more demanding email workloads.

### Understanding SNS Email Subscriptions

When you decide to send email through SNS, you're starting with a straightforward model: you create an SNS topic, add email subscribers, and publish messages. The elegance lies in SNS's ability to handle multiple subscription types from a single topic—you could have email, SMS, and Lambda subscribers all listening to the same event stream. However, email subscribers bring their own complexity.

SNS supports two distinct email subscription types, each suited for different scenarios. The Email subscription type delivers messages as plain text emails, which is ideal for simple notifications where you want the message content to appear directly in the email body. In contrast, Email-JSON subscriptions wrap your message in a JSON structure that includes additional metadata, allowing subscribers to understand the topic, message ID, timestamp, and signature information. This extra structure makes Email-JSON particularly valuable when you need programmatic processing or when the recipient needs to understand the message's origin and authenticity.

Let's consider a practical example. Imagine you're building a user account notification system. For simple "your password was reset" messages, Email might be perfectly adequate. But if you're notifying third-party integrations or need to include cryptographic verification that a message genuinely came from your SNS topic, Email-JSON becomes necessary.

The choice between these two formats affects not just the email content but also how your subscribers perceive and process the messages. Plain Email feels more natural to humans reading in their inbox, while Email-JSON provides the structure that systems expect.

### The Email Confirmation Workflow

Here's something that surprises many developers: just adding an email address as an SNS subscriber doesn't immediately enable message delivery. SNS requires explicit confirmation, and this happens through what AWS calls the *subscription confirmation workflow*.

When you subscribe an email address to an SNS topic—whether through the AWS Management Console, API call, or infrastructure-as-code tool—SNS immediately sends a confirmation email to that address. This email contains a subject line like "AWS Notification - Subscription Confirmation" and includes a clickable link along with instructions to confirm the subscription. The recipient must actually click this link or visit a confirmation URL to activate the subscription. Until they do, SNS will not deliver any topic messages to that email address.

This design serves an important purpose: it prevents bad actors from subscribing arbitrary email addresses to topics and spamming them with unwanted notifications. It also provides users with an explicit moment to review what they've subscribed to and understand what notifications they'll receive.

The practical implication is clear: if you're programmatically adding subscribers to SNS topics, you need to account for the fact that confirmation emails must be read and acted upon. In a development or testing environment, this isn't usually a problem—you can confirm subscriptions yourself. But in production systems, you may need to implement workflows that handle unconfirmed subscriptions or communicate to users about the confirmation step.

The confirmation link itself is valid for three days. If a user doesn't click it within that window, the subscription remains pending indefinitely, and no messages will be delivered. Some teams implement reminder emails or in-app notifications to guide users through this step, particularly when the confirmation email might land in spam folders.

### Email Format Options: Plain Text vs. JSON

Understanding the difference between Email and Email-JSON isn't just academic—it directly affects what your subscribers see and how they interact with your notifications.

With a standard **Email** subscription, when you publish a message to the topic with the message content "Your verification code is 123456," that exact text appears in the email body. The email is clean and simple, with minimal overhead. This works beautifully for straightforward notifications: password resets, account confirmations, billing alerts, and similar communications where the subscriber just needs the essential information.

With an **Email-JSON** subscription, the same message gets wrapped in a JSON envelope. The subscriber receives an email containing something like:

```json
{
  "Type" : "Notification",
  "MessageId" : "12345678-1234-1234-1234-123456789012",
  "TopicArn" : "arn:aws:sns:us-east-1:123456789012:MyTopic",
  "Subject" : "My Topic Notification",
  "Message" : "Your verification code is 123456",
  "Timestamp" : "2024-01-15T14:30:00.000Z",
  "SignatureVersion" : "1",
  "Signature" : "...",
  "SigningCertUrl" : "...",
  "UnsubscribeUrl" : "...",
  "SubscribeUrl" : "..."
}
```

This structure is intentionally designed to mirror what SNS delivers to other subscription types like HTTP/HTTPS or SQS. It allows recipients (whether they're people reading email or systems parsing it) to verify the message's authenticity using the provided signature, understand exactly which topic it came from, and see metadata like when it was published.

For human subscribers, Email-JSON emails are less pleasant to read—they contain a lot of technical detail. But for B2B integrations or scenarios where verification matters, they're essential. Choose Email-JSON when your subscribers need to trust the message's origin or when they're systems that will parse and validate the message structure.

### Configuring Message Attributes and Custom Headers

While SNS email notifications are relatively straightforward compared to dedicated email services, you do have options for customization that can improve deliverability and user experience.

When publishing a message to an SNS topic, you can include a **Subject** attribute that becomes the email's subject line. This is important—a clear, relevant subject line dramatically improves whether your email gets opened and, in some email clients, whether it even gets delivered. Without explicitly setting a subject, email subscribers receive a generic subject line that provides no context.

Beyond the subject, SNS allows you to set a **MessageStructure** property to specify different message content for different subscription types. This is powerful when you have multiple subscribers to the same topic. For instance, you might want email subscribers to receive a human-readable message while SQS subscribers receive JSON, and SMS subscribers get a truncated version. You do this by publishing a JSON structure where each key represents a subscription protocol:

```json
{
  "default": "This is the default message",
  "email": "Click here to verify your account: https://example.com/verify",
  "sqs": "{\"action\": \"verify_account\", \"user_id\": \"12345\"}",
  "sms": "Verify your account at https://example.com/verify"
}
```

When SNS delivers this message, each subscriber type receives only the content meant for them.

For email deliverability, you should also understand that SNS adds certain headers automatically—things like Return-Path, DKIM signatures, and others that email systems use to verify authenticity. These are handled entirely by AWS, and you don't need to configure them yourself. However, they're one reason why SNS email is generally more deliverable than sending from ad-hoc systems.

### The Sandbox Limitation: Why Your Test Emails Might Not Arrive

One of the most critical constraints in SNS email is the **sandbox environment**, and it catches developers by surprise regularly. When you first create an AWS account, all SNS email functionality operates in sandbox mode. What does this mean in practice? Only email addresses that you have explicitly verified can receive emails from your SNS topics.

This is a significant limitation for testing and development. You might think you can publish test emails to any address you want, but you'll discover that emails sent to unverified addresses are silently dropped—they don't bounce or generate errors; they simply don't arrive. From SNS's perspective, the message was published successfully. The problem is downstream, in the delivery step.

To verify an email address (or an entire domain), you request verification through the SES console, even though you're using SNS. AWS uses the same verification infrastructure for both services. When you request verification for an address like `team@example.com`, AWS sends a verification email to that address containing a confirmation link. Clicking the link marks that address as verified in your account.

Verifying individual addresses works fine for small teams or testing. You might verify your email, your team members' emails, and a few test addresses. But as you scale toward production, this approach becomes impractical. If you're building a service that sends notifications to thousands of different users, verifying each address individually is impossible.

This is where the sandbox becomes a hard ceiling. To move out of sandbox mode and remove the restriction, you must request production access from AWS. The process involves submitting a request through the SES console describing your use case, the types of emails you'll send, and how you handle bounces and complaints. AWS reviews these requests to prevent abuse and protect email infrastructure.

Getting approved for production access typically takes a day or two, and the criteria are straightforward: demonstrate that you understand your use case, show awareness of best practices around bounce and complaint handling, and explain your sending volume and patterns. Once approved, the sandbox restriction lifts, and you can send to any email address.

This progression—sandbox during development and testing, production access for deployment—is a safety mechanism that protects the email ecosystem. It's worth planning for when you're architecting notification systems.

### Daily Sending Quotas and Rate Limits

Beyond the sandbox environment, SNS imposes a daily sending quota for email. By default, your account can send a maximum of 200 emails per day, regardless of how many topics or publishers you have. This quota is relatively generous for notification scenarios but becomes a limiting factor if you're considering SNS for any kind of bulk email.

The daily quota resets at midnight UTC. If you send 150 emails on Monday and 100 on Tuesday, you've consumed your quota for the day, and any additional publishing attempts on Tuesday will fail with a throttling error. The quota applies per account, not per topic or per subscription type.

For many applications—password resets, account confirmations, order notifications, alert digests—a 200-per-day quota is entirely adequate. A typical production system might send dozens of emails per day, well within this limit. But if you're considering SNS for scenarios like daily summary emails to an entire user base or bulk promotional messages, this quota becomes a blocker immediately.

There's also a sending rate limit of approximately 14 emails per second. This is a soft limit—brief spikes above this rate might be tolerated, but sustained high-rate sending will trigger throttling. In practice, for application-triggered notifications (password resets, alerts, confirmations), you'll rarely hit this limit unless you're intentionally bulk-publishing.

### Bounces, Complaints, and Suspension Risks

Email systems are inherently messy. Addresses bounce for all sorts of reasons—the recipient deleted their account, they've moved to a different email provider, or there's a temporary server issue. Additionally, users sometimes mark legitimate emails as spam, which email providers track as "complaints."

SNS monitors both bounces and complaints, and this is crucial: **if your bounce or complaint rate exceeds certain thresholds, AWS will automatically suspend your email sending privileges**. The exact thresholds aren't publicly documented with precision, but industry standards suggest that a complaint rate above 0.1% (one complaint per thousand emails) or a persistent bounce rate above a few percent will trigger suspension.

When suspension happens, it's not gradual. AWS doesn't warn you that you're approaching the threshold; your emails suddenly stop being delivered, and you'll receive notification that your sending privileges have been suspended. Recovery requires contacting AWS support, explaining what went wrong, and often implementing processes to prevent the same issue from recurring.

This dynamic creates an important operational concern: you must actively monitor and handle bounces and complaints. Here's what this means practically:

SNS can automatically send bounce and complaint notifications to an SNS topic that you configure. By subscribing to this topic (perhaps with a Lambda function or SQS queue), you can automatically detect bounces and complaints and remove problematic email addresses from your systems. If an email bounces as a permanent failure (the address doesn't exist), you should immediately stop trying to send to that address. If it's a temporary bounce, you might retry later or wait for user action.

For complaints, the message is clear: the user marked your email as spam. You should respect that signal and remove them from your mailing list. Continuing to send to users who've complained is not only ineffective but also accelerates toward suspension.

Without automated bounce and complaint handling, you're essentially operating blind. You might be unknowingly sending to invalid addresses or ignoring signals that users don't want your emails. This path leads directly to suspension.

### Best Practices for SNS Email Deliverability

Beyond the technical constraints, several operational practices significantly improve whether your SNS emails actually reach inboxes.

**Use clear, relevant subject lines.** This seems obvious, but it's foundational. A subject line like "Account Verification Required" is infinitely better than "Notification" or worse, no subject line at all. Email clients and filters use subject lines to make routing decisions, and users are far more likely to open emails with clear context.

**Authenticate your sending domain.** While SNS doesn't require this for sandbox testing, moving to production with domain authentication is essential. When you configure SNS to send on behalf of your domain (not just an AWS SNS address), you're establishing trust with email providers. This typically involves adding DKIM and SPF records to your domain's DNS configuration, signaling to email providers that you're authorized to send mail on your domain's behalf.

**Keep your sender address consistent.** Don't vary the From address across emails or send from different domains unpredictably. Email providers track reputation at the sender address and domain level. A consistent sender address builds positive reputation over time. "noreply@example.com" is a conventional choice that users understand is automated.

**Segment your sending.** If you have different categories of notifications—alerts, marketing, account notifications—consider using separate topics. This allows you to manage reputation separately and makes it easier to implement different handling for different notification types. If marketing emails have high complaint rates, you don't want that affecting the deliverability of critical account notifications.

**Handle feedback actively.** Subscribe to SNS bounce and complaint notifications, and automatically clean your contact lists. Remove addresses that bounce permanently, respect complaint signals immediately, and monitor your bounce and complaint rates. Many services that use SNS maintain running metrics on these signals, alerting teams if rates suddenly spike.

**Test before production.** In sandbox mode, send test emails to addresses you've verified and check that they arrive reliably. If you're using Email-JSON format, validate that the structure is correct. If you're using custom subjects or message structures, verify they appear as intended. This is also where you verify that your messages render properly in common email clients—SNS sends plain text or plain JSON, not HTML, so formatting is minimal, but it's worth confirming.

### When to Move Beyond SNS to Amazon SES

SNS email is genuinely useful for application notifications, but it has clear boundaries. Understanding when SNS is sufficient and when you need to graduate to Amazon SES is an important architectural decision.

Amazon SES is AWS's dedicated email service. It's purpose-built for email and offers capabilities that SNS doesn't provide: HTML email templates, advanced tracking, detailed bounce and complaint handling, sending at much higher volumes, and direct control over sender authentication. SES also doesn't have the same daily quota restrictions or sandbox limitations (you still need to request production access, but the process is similar).

Use SNS for email when your requirements are straightforward: application-triggered notifications that are relatively infrequent, messages to a known set of recipients who have opted in, and cases where HTML formatting or advanced email features aren't critical. Password resets, account confirmations, two-factor authentication codes, billing alerts—these are ideal SNS email scenarios.

Use SES when you're sending substantial volumes, need HTML formatting, want detailed delivery tracking and analytics, or are building a system where email is central (not just supplementary). SES is also the right choice if you're operating a platform where multiple tenants send email or where user-generated emails flow through your system.

There's also a middle ground: use SNS for the orchestration and routing logic (topics, subscriptions, message filtering), and use SES for the actual email delivery. SNS can integrate with SES as a destination, allowing you to benefit from SNS's topic and subscription model while leveraging SES's email capabilities.

The transition isn't difficult—both services share similar verification and authentication requirements—but planning for it early in your architecture is wise. If you start with SNS and later realize you need SES, the migration is straightforward but requires updating how you're publishing messages.

### Putting It Together: A Practical Scenario

Let's walk through how these pieces work together in a real application. Suppose you're building a web service where users register accounts and need to verify their email addresses.

You create an SNS topic called `user-verification-emails`. When a user registers, your application publishes a message to this topic containing the verification link and code. During development and testing, you've verified a few email addresses (your team members, test accounts), and you have the topic configured with Email subscriptions.

The SNS topic sends a confirmation email to each email address you've added as a subscriber, and you click the confirmation link in your inbox to activate the subscription. Once subscribed, when you publish a verification message, the email appears in your inbox seconds later.

When you're ready for production, you request production access from AWS by going to the SES console and submitting your use case. You explain that you're sending account verification emails, that your system automatically handles bounces and complaints by removing addresses from future sends, and that your volume is expected to be around 50-100 emails per day. AWS approves your request after a day or two.

Now, rather than verifying individual email addresses, you can send to any address. But you're not naive about it—you've implemented a bounce and complaint handler that listens to an SNS topic for these notifications. When a verification email bounces as permanent, your system records that the address is invalid and never attempts to send to it again. When a user marks an email as spam (a complaint), your system logs that and respects the user's preference.

You monitor your bounce and complaint rates weekly, ensuring they stay well below dangerous thresholds. You've configured your emails to come from `noreply@yourcompany.com` consistently, and you've added SPF and DKIM records to your domain so that email providers recognize you as an authorized sender.

This setup is robust, maintainable, and gives you a foundation to scale notifications across your application. If your needs grow significantly—perhaps you add marketing emails or notifications to millions of users—you can evaluate moving to SES, but for now, SNS is doing exactly what it's designed to do.

### Conclusion

SNS email notifications are a straightforward way to add email capabilities to AWS applications, but the service has clear constraints and requirements that shape how you use it. The sandbox environment and daily quotas are safety mechanisms, not bugs. The confirmation workflow and bounce handling are essential for building reliable systems. Understanding the difference between Email and Email-JSON, knowing when to use custom message structures, and actively managing bounce and complaint signals—these practices separate successful implementations from problematic ones.

For application notifications—password resets, account verifications, alerts, and similar transactional emails—SNS is often the right choice. It's simple, integrated with the rest of the AWS ecosystem, and sufficient for most use cases. But recognize the boundaries: sandbox limitations for development, the 200-email daily quota, and the need for production access before deploying to real users. As your requirements evolve toward higher volumes, HTML formatting, or more sophisticated email features, SES becomes the natural next step.

The key is to plan for email early, understand these constraints, and implement the operational practices—bounce handling, complaint monitoring, consistent sender addresses, and clear subject lines—that keep your notifications reliable and deliverable. With these foundations in place, email becomes a dependable channel in your broader notification architecture.
