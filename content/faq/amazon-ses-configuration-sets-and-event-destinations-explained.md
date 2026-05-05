---
title: "Amazon SES Configuration Sets and Event Destinations Explained"
---

## Amazon SES Configuration Sets and Event Destinations Explained

Email has become as critical to modern applications as databases and APIs. Whether you're sending password resets, order confirmations, or marketing newsletters, understanding what happens to your email after it leaves your application is essential. Amazon Simple Email Service (SES) gives you powerful tools to track and analyze email lifecycle events—but only if you know how to configure them properly.

This is where Amazon SES configuration sets and event destinations come in. They're the bridge between sending an email and understanding whether it was delivered, opened, clicked, or bounced. For developers building production systems, configuration sets transform raw email sending into a data-driven process that feeds directly into analytics pipelines, monitoring dashboards, and customer engagement platforms.

In this article, we'll explore configuration sets from the ground up: how to create them, attach them to your sending calls, understand the nine different event types SES can track, and route those events to the four supported destinations. By the end, you'll know exactly how to instrument your email sending pipeline for visibility and analytics.

### Understanding Configuration Sets and Why They Matter

Before diving into the mechanics, let's establish why configuration sets exist. When you send an email through SES without a configuration set, the service delivers it and moves on. You know whether the send API call succeeded, but you don't get detailed information about what happened after the email landed in a recipient's inbox—or bounced before it got there.

A configuration set is essentially a named container for email sending settings and event routing rules. Think of it as a logical grouping that lets you tag outgoing messages and decide where lifecycle events should go. You might have one configuration set for transactional emails (password resets, receipts) and another for marketing campaigns. Each can have different event destinations, allowing you to route data differently based on the email's purpose.

The real power emerges when you attach a configuration set to your sending calls. Instead of emails vanishing into the void, SES begins publishing detailed events to your chosen destinations—CloudWatch, Kinesis Data Firehose, SNS, or EventBridge. These events let you know not just that an email was sent, but whether it was delivered, when it was opened, whether links were clicked, and even why it bounced or was rejected.

### Creating a Configuration Set

Creating a configuration set is straightforward. You can do it through the AWS Management Console, the AWS CLI, or programmatically via the SDK. Let's start with the CLI, which is typically the fastest approach:

```bash
aws ses create-configuration-set \
  --configuration-set Name=my-transactional-emails \
  --region us-east-1
```

That's it. You now have a configuration set named `my-transactional-emails`. It exists but doesn't do anything yet because it has no event destinations attached to it.

In the console, you'd navigate to SES, find Configuration Sets under Sending Settings, and click Create Configuration Set. You can also add delivery options like TLS requirement or sending rate limits during creation, though these are typically optional and can be modified later.

One important note: configuration set names are regional. If you're sending from multiple regions, you'll need to create the same configuration set in each region where you plan to use it, or handle this in your application logic.

### Attaching Configuration Sets to Sending Calls

Creating a configuration set is only half the battle. You need to actually use it when sending email. SES supports two ways to do this: via the SMTP interface using a custom header, or via the SendEmail and SendBulkTemplatedEmail API calls using a parameter.

If you're using the SES SMTP interface (which some legacy applications or mail libraries do), you attach the configuration set by adding an `X-SES-CONFIGURATION-SET` header to your message:

```
X-SES-CONFIGURATION-SET: my-transactional-emails
```

For most developers using the SDK, however, you'll use the API parameter. Here's an example using the AWS SDK for Python (Boto3):

```python
import boto3

client = boto3.client('ses', region_name='us-east-1')

response = client.send_email(
    Source='sender@example.com',
    Destination={'ToAddresses': ['recipient@example.com']},
    Message={
        'Subject': {'Data': 'Your password reset link'},
        'Body': {'Text': {'Data': 'Click here: https://example.com/reset/abc123'}}
    },
    ConfigurationSetName='my-transactional-emails'
)
```

Notice the `ConfigurationSetName` parameter at the end. That's how you attach the configuration set. Without it, the email sends but no events are routed to your destinations.

Here's the equivalent in Node.js using the AWS SDK for JavaScript:

```javascript
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: 'us-east-1' });

const params = {
    Source: 'sender@example.com',
    Destination: { ToAddresses: ['recipient@example.com'] },
    Message: {
        Subject: { Data: 'Your password reset link' },
        Body: { Text: { Data: 'Click here: https://example.com/reset/abc123' } }
    },
    ConfigurationSetName: 'my-transactional-emails'
};

ses.sendEmail(params, (err, data) => {
    if (err) console.error(err);
    else console.log('Email sent:', data.MessageId);
});
```

A common pitfall: if you specify a configuration set that doesn't exist, SES will reject the send call entirely. Always verify that your configuration set is created and that your application logic references the correct name.

### The Nine Event Types

SES publishes nine different event types that occur throughout an email's lifecycle. Understanding each one helps you build meaningful analytics and alerting around your email program.

**Send** is the earliest event. It fires when SES successfully accepts the email for delivery. This doesn't mean it reached the recipient's inbox yet—just that SES processed it. If you're measuring email volume or debugging send failures, the Send event is your starting point.

**Delivery** indicates that the email reached the recipient's mail server and was accepted. The mail server has it, though the user hasn't necessarily opened it yet. This event is crucial for confirming that your email actually made it to its destination.

**Bounce** happens when the recipient's mail server rejected the email and returned it. Bounces can be permanent (hard bounces) or temporary (soft bounces). A hard bounce typically means the address doesn't exist or the domain rejected it outright. A soft bounce usually indicates a temporary issue like the mailbox being full or the server being temporarily unavailable. The bounce event includes metadata telling you which type it was.

**Complaint** is triggered when a recipient marks your email as spam or clicks "Report Abuse" in their email client. This is important to track because repeated complaints to ISPs can damage your sender reputation. Many applications use complaint events to automatically unsubscribe users or flag them for review.

**Open** fires when the recipient opens the email. This is typically detected by SES embedding a small, invisible tracking pixel in the email body. Not all email clients load images by default, so open rates are approximate, but they're still valuable for engagement measurement. Note that opens are only tracked if you configure a tracking destination and the recipient's email client loads images.

**Click** occurs when the recipient clicks a link in the email. SES rewrites links to route through its click tracking infrastructure, records the click event, then redirects to the original URL. The recipient never sees the redirect—it's transparent to them.

**Rendering Failure** is a less common but important event. It means SES attempted to render a templated email but failed, typically due to missing substitution variables or malformed template syntax. This helps you catch template issues before they affect your recipients.

**Reject** fires when SES refuses to send the email before even attempting delivery. Common reasons include the sender address not being verified, the recipient address being on the SES suppression list, or the message exceeding size limits. Unlike bounces, which happen after the mail server rejects the email, rejects happen within SES itself.

**DeliveryDelay** indicates that the mail server temporarily delayed accepting the email but hasn't rejected it. This is useful for understanding delivery latency and identifying potential issues with recipient mail servers.

These nine events, combined with timestamps and metadata like message IDs and recipient addresses, give you a complete picture of email performance. You can track conversion funnels (sent → delivered → opened → clicked), identify problematic recipient domains, and understand where your email program succeeds and fails.

### The Four Event Destinations

Once you've chosen which events you want to track, you need somewhere to send them. SES supports four destinations, each suited to different use cases.

**Amazon CloudWatch** is the simplest option for getting started. SES publishes events as CloudWatch metrics and logs, allowing you to set up dashboards and alarms. If you want to know that your bounce rate spiked, you can create a CloudWatch alarm and get notified. The downside is that CloudWatch isn't ideal for high-volume event processing or complex analytics—it's better for monitoring and alerting than for building a data pipeline.

**Amazon Kinesis Data Firehose** is the workhorse for serious email analytics. Firehose is a managed service that captures, transforms, and delivers streaming data. You can configure SES to send all events to a Firehose delivery stream, which then buffers the data and automatically loads it into Amazon S3, Redshift, or even an HTTP endpoint. This is the pattern most organizations use when they want to perform post-send analytics—landing all email events in an S3 data lake where they can be queried with Athena or fed into a data warehouse.

**Amazon Simple Notification Service (SNS)** acts as a fan-out mechanism. When SES publishes events to an SNS topic, SNS can deliver them to multiple subscribers: Lambda functions, HTTP webhooks, email addresses, or SQS queues. This is useful if you want real-time event processing. For example, you might subscribe a Lambda function to a bounce event topic, and that function automatically unsubscribes the bounced address from your mailing list.

**Amazon EventBridge** provides event routing on steroids. You publish SES events to EventBridge, then define rules that match specific event patterns and route them to different targets. This is powerful for complex workflows. For instance, you could route all complaint events to one Lambda function, delivery events to another target, and bounces to yet another. EventBridge's rule-based approach is more flexible than SNS's simpler fan-out model.

Each destination has trade-offs. CloudWatch is easiest for monitoring. Firehose is best for high-volume analytics. SNS is best for simple, real-time processing. EventBridge is best for complex, rule-driven workflows. Many organizations use a combination—for example, sending all events to Firehose for analytics while also routing critical events like complaints to an SNS topic for immediate alerting.

### Configuring Event Destinations

Now that you understand what events are and where they can go, let's configure an actual event destination. We'll walk through each type with concrete examples.

**Setting up a CloudWatch destination** is the fastest way to start seeing events. In the console, you navigate to your configuration set, click "Add Destination," and select CloudWatch Logs. SES will prompt you to name the destination and specify a log group. SES will then publish events to that log group as JSON documents.

Via the CLI, it looks like this:

```bash
aws ses put-configuration-set-event-destination \
  --configuration-set-name my-transactional-emails \
  --event-destination-name my-cloudwatch-destination \
  --event-destination \
    MatchingEventTypes=send,delivery,bounce,complaint,open,click \
    Enabled=true \
    CloudWatchDestination='{LogGroupName=/aws/ses/my-transactional-emails}' \
  --region us-east-1
```

This creates a destination within the configuration set that publishes send, delivery, bounce, complaint, open, and click events to a CloudWatch log group.

**For Firehose**, the setup is similar but you need to ensure the Firehose delivery stream exists first. Here's the CLI command:

```bash
aws ses put-configuration-set-event-destination \
  --configuration-set-name my-transactional-emails \
  --event-destination-name my-firehose-destination \
  --event-destination \
    MatchingEventTypes=send,delivery,bounce,complaint,open,click \
    Enabled=true \
    KinesisFirehoseDestination='{IAMRoleArn=arn:aws:iam::ACCOUNT:role/SES-Firehose-Role,DeliveryStreamArn=arn:aws:firehose:us-east-1:ACCOUNT:deliverystream/ses-events}' \
  --region us-east-1
```

Notice the `IAMRoleArn` parameter. SES needs permission to put records into your Firehose stream, which we'll cover in the IAM section.

**For SNS**, you specify a topic ARN:

```bash
aws ses put-configuration-set-event-destination \
  --configuration-set-name my-transactional-emails \
  --event-destination-name my-sns-destination \
  --event-destination \
    MatchingEventTypes=bounce,complaint \
    Enabled=true \
    SNSDestination='{TopicArn=arn:aws:sns:us-east-1:ACCOUNT:ses-bounces}' \
  --region us-east-1
```

This configuration sends only bounce and complaint events to the SNS topic, allowing you to handle critical issues separately from other events.

**For EventBridge**, SES publishes events to the default event bus:

```bash
aws ses put-configuration-set-event-destination \
  --configuration-set-name my-transactional-emails \
  --event-destination-name my-eventbridge-destination \
  --event-destination \
    MatchingEventTypes=send,delivery,bounce,complaint,open,click,reject,rendering-failure,delivery-delay \
    Enabled=true \
    EventBridgeDestination='{}' \
  --region us-east-1
```

Once SES publishes events to EventBridge, you define rules in EventBridge to route them. For example, you might create a rule that matches all bounce events and sends them to a Lambda function.

### IAM Permissions Required

For SES to publish events to your chosen destinations, you need to grant it the appropriate permissions. This is where many implementations stumble—you create a configuration set and event destination, but events don't show up because the IAM role lacks permissions.

**For CloudWatch Logs**, SES needs permission to create log groups and put log events:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:PutLogEvents",
        "logs:CreateLogStream",
        "logs:CreateLogGroup"
      ],
      "Resource": "arn:aws:logs:us-east-1:ACCOUNT:log-group:/aws/ses/*"
    }
  ]
}
```

**For Kinesis Data Firehose**, SES needs permission to put records:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "firehose:PutRecord",
      "Resource": "arn:aws:firehose:us-east-1:ACCOUNT:deliverystream/ses-events"
    }
  ]
}
```

Note that this is the minimum. If your Firehose delivery stream transforms or enriches data, you might need additional permissions.

**For SNS**, SES needs permission to publish to the topic:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:ACCOUNT:ses-bounces"
    }
  ]
}
```

**For EventBridge**, SES needs permission to put events:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:ACCOUNT:event-bus/default"
    }
  ]
}
```

Additionally, the role or user sending emails needs the `ses:SendEmail` and `ses:SendBulkTemplatedEmail` permissions. Here's the basic policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendBulkTemplatedEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

A best practice is to attach all these permissions to a service role that your application assumes, rather than embedding credentials in your application code. If you're running on EC2, use an instance role. On Lambda, create an execution role. This way, you can rotate credentials without redeploying code.

### Real-World Pattern: Landing Email Events in S3 for Analytics

Let's walk through a complete, production-ready pattern that ties everything together: capturing all email events and landing them in S3 for analytics.

The architecture is simple: SES publishes events to a Kinesis Data Firehose delivery stream, which buffers them and automatically uploads them to S3 in batches. You can then query the data with Amazon Athena or load it into Redshift for dashboards.

First, create the S3 bucket where events will land:

```bash
aws s3 mb s3://my-email-events-bucket --region us-east-1
```

Next, create an IAM role that Firehose will assume to write to S3:

```bash
aws iam create-role \
  --role-name firehose-ses-events-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "firehose.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

aws iam put-role-policy \
  --role-name firehose-ses-events-role \
  --policy-name firehose-s3-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::my-email-events-bucket",
          "arn:aws:s3:::my-email-events-bucket/*"
        ]
      }
    ]
  }'
```

Now create the Firehose delivery stream:

```bash
aws firehose create-delivery-stream \
  --delivery-stream-name ses-events-stream \
  --s3-destination-configuration \
    RoleARN=arn:aws:iam::ACCOUNT:role/firehose-ses-events-role,\
    BucketARN=arn:aws:s3:::my-email-events-bucket,\
    BufferingHints="{SizeInMBs=128,IntervalInSeconds=60}",\
    Prefix="events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/",\
    ErrorOutputPrefix="errors/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/!{firehose:error-output-type}" \
  --region us-east-1
```

The `Prefix` parameter uses Firehose's dynamic partitioning to organize events by date, which makes querying with Athena much faster. Events will land in S3 paths like `s3://my-email-events-bucket/events/year=2024/month=01/day=15/`.

Now create an IAM role for SES to assume:

```bash
aws iam create-role \
  --role-name ses-firehose-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "ses.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

aws iam put-role-policy \
  --role-name ses-firehose-role \
  --policy-name ses-firehose-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "firehose:PutRecord",
        "Resource": "arn:aws:firehose:us-east-1:ACCOUNT:deliverystream/ses-events-stream"
      }
    ]
  }'
```

Finally, create the configuration set and attach the Firehose destination:

```bash
aws ses create-configuration-set \
  --configuration-set Name=analytics-config-set \
  --region us-east-1

aws ses put-configuration-set-event-destination \
  --configuration-set-name analytics-config-set \
  --event-destination-name firehose-events \
  --event-destination \
    MatchingEventTypes=send,delivery,bounce,complaint,open,click,reject,rendering-failure,delivery-delay \
    Enabled=true \
    KinesisFirehoseDestination='{
      IAMRoleArn=arn:aws:iam::ACCOUNT:role/ses-firehose-role,
      DeliveryStreamArn=arn:aws:firehose:us-east-1:ACCOUNT:deliverystream/ses-events-stream
    }' \
  --region us-east-1
```

Now whenever you send an email with this configuration set, all nine event types will flow into the Firehose stream, which will batch them up and land them in S3 every minute (or every 128 MB, whichever comes first).

To query the data with Athena, first create a table:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS ses_events (
  eventType STRING,
  messageId STRING,
  source STRING,
  destination ARRAY<STRING>,
  sendingAccountId STRING,
  timestamp BIGINT,
  bounce STRUCT<bounceType:STRING, bounceSubType:STRING, bouncedRecipients:ARRAY<STRUCT<emailAddress:STRING, status:STRING, diagnosticCode:STRING>>>,
  complaint STRUCT<complaintFeedbackType:STRING, complainedRecipients:ARRAY<STRUCT<emailAddress:STRING>>>,
  delivery STRUCT<timestamp:BIGINT, processingTimeMillis:BIGINT, recipients:ARRAY<STRING>, smtpResponse:STRING, remoteMtaIp:STRING>,
  open STRUCT<timestamp:BIGINT, userAgent:STRING>,
  click STRUCT<timestamp:BIGINT, userAgent:STRING, link:STRING, linkTags:MAP<STRING,ARRAY<STRING>>>
)
PARTITIONED BY (year STRING, month STRING, day STRING)
STORED AS JSON
LOCATION 's3://my-email-events-bucket/events/'
```

Now you can run queries like:

```sql
SELECT 
  eventType,
  COUNT(*) as count
FROM ses_events
WHERE year = '2024' AND month = '01' AND day = '15'
GROUP BY eventType
```

This gives you a high-level view of email activity. You can drill deeper:

```sql
SELECT 
  source,
  COUNT(CASE WHEN eventType = 'Bounce' THEN 1 END) as bounces,
  COUNT(CASE WHEN eventType = 'Delivery' THEN 1 END) as deliveries,
  ROUND(
    COUNT(CASE WHEN eventType = 'Bounce' THEN 1 END) * 100.0 / 
    COUNT(CASE WHEN eventType = 'Send' THEN 1 END), 
    2
  ) as bounce_rate
FROM ses_events
WHERE year = '2024' AND month = '01'
GROUP BY source
```

This pattern scales beautifully. Firehose handles high-volume email events without you needing to manage infrastructure, and S3 cost-effectively stores the raw data for as long as you need it.

### Common Pitfalls and How to Avoid Them

Building with SES configuration sets and event destinations is straightforward once you understand the concepts, but there are several common mistakes that trip up developers.

**Forgetting to attach the configuration set to your send calls** is surprisingly common. You create a configuration set, set up event destinations, but then send emails without specifying the configuration set name. The emails send fine, but no events appear. Always double-check that your sending code includes the `ConfigurationSetName` parameter.

**Misunderstanding event timing** can skew your analytics. The Send event fires immediately when SES accepts the email. Delivery typically follows within seconds, but the exact timing depends on the recipient's mail server. Open and click events depend on the recipient's actions and may never arrive if they don't open or click. Don't assume that the absence of a Delivery event means the email failed—it might still arrive.

**Configuring event destinations without the proper IAM permissions** results in silent failures. SES won't complain when it can't publish events; the events simply won't appear. Always verify that the role specified in your event destination has the necessary permissions to write to the target resource.

**Treating bounces and complaints as identical** is a mistake. Bounces are mail server rejections, which might be temporary. Complaints are user-initiated, indicating an engagement problem. Many organizations automatically unsubscribe on complaints but retry on soft bounces.

**Not handling the SES suppression list** is a related issue. If an address is on the SES suppression list (due to a complaint), SES will reject the send entirely, and you'll get a Reject event. The suppression list is per-region, so an address might be suppressed in us-east-1 but not in eu-west-1.

**Exceeding Firehose batch size limits** can cause data loss if you're not careful. Firehose has a maximum record size; if you try to put a record larger than 1 MB, it will fail. SES event records are typically small JSON documents, so this is rare, but it's worth knowing.

**Over-partitioning in S3** can make Athena queries slow. The example above partitions by year, month, and day, which is reasonable. Some organizations partition more granularly (by hour or minute), which can create thousands of partitions and slow down queries that need to scan all partitions. Balance partitioning granularity with query performance.

### Event Destination Best Practices

Now that you understand the mechanics, here are some best practices for choosing and configuring event destinations.

Use **CloudWatch for alerting and monitoring**. Set up CloudWatch Alarms that trigger when your bounce rate exceeds a threshold or when you receive complaints. CloudWatch dashboards are excellent for real-time visibility, though they're not ideal for high-volume analytics.

Use **Firehose for long-term analytics and archival**. If you're building reports, dashboards, or machine learning models on email data, Firehose into S3 is the right choice. The automatic partitioning and low cost per event make it perfect for this use case.

Use **SNS for real-time, event-driven workflows**. If you need to react immediately to bounce or complaint events—for example, updating a subscription database—SNS is simpler than EventBridge. Subscribe a Lambda function or SQS queue to the SNS topic and process events as they arrive.

Use **EventBridge for complex, rule-based routing**. If you need different event types to trigger different actions, or if you need to correlate SES events with other AWS service events, EventBridge's rule engine is powerful.

Many production systems use a combination. For instance, you might send all events to Firehose for analytics while also sending bounces and complaints to an SNS topic that triggers a Lambda function to update your subscription database in real time.

**Enable click and open tracking judiciously.** Click and open tracking provide valuable engagement data, but they require SES to modify email links and add tracking pixels. This can affect deliverability with some ISPs and may impact email rendering. Test before enabling broadly.

**Monitor your Firehose delivery stream.** Firehose will log errors to CloudWatch if it can't deliver data to S3. Set up alerts on these errors so you catch permission or quota issues quickly.

**Version your S3 prefixes.** When you need to change your Firehose configuration or event schema, consider using versioned prefixes like `s3://bucket/events/v1/` and `s3://bucket/events/v2/`. This lets you maintain backward compatibility and makes rollback easier.

### Conclusion

Amazon SES configuration sets and event destinations give you deep visibility into your email sending program. By understanding what each event type represents, how to choose the right destination, and how to connect them with proper IAM permissions, you can transform email from a black box into a data-driven channel.

The pattern of routing all events to Firehose and landing them in S3 is especially powerful for modern applications. It's scalable, cost-effective, and integrates seamlessly with analytics tools like Athena and Redshift. Combined with real-time processing via SNS or EventBridge for critical events like bounces and complaints, you get both real-time visibility and long-term analytics.

As you build production email systems, remember that configuration sets are optional but highly recommended for any application that cares about email delivery quality and engagement. The small effort required to set them up pays dividends in operational visibility and data-driven decision-making.
