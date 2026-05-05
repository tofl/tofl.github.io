---
title: "Building an Inbound Email Processing Pipeline with SES Receipt Rules and Lambda"
---

## Building an Inbound Email Processing Pipeline with SES Receipt Rules and Lambda

Email remains one of the most reliable communication channels, and many applications benefit from processing inbound email automatically. Whether you're building a support ticket system that accepts emails, a document management platform, or a simple feedback collection tool, AWS provides a surprisingly elegant solution through Simple Email Service (SES) and Lambda. This article walks you through building a complete inbound email processing pipeline—from domain verification through to a working Lambda function that parses emails and stores data in DynamoDB.

Unlike many AWS services that feel purpose-built for a single use case, SES receipt rules offer flexibility that rewards understanding. You'll configure your domain to receive mail, define how emails should be processed, and chain together multiple AWS services to turn raw email into structured business data. By the end, you'll have a template you can adapt to dozens of real-world scenarios.

### Understanding SES Email Receiving

Amazon SES is primarily known for sending transactional emails—confirmation codes, password resets, order notifications. But SES also lets you *receive* email, which opens up possibilities for automation that many developers don't realize exist.

When someone sends an email to your domain, AWS can automatically parse it, extract the message and attachments, and trigger downstream actions. You control exactly what happens through receipt rules, which are processed in order against each inbound email. An email might be stored in S3, forwarded to a Lambda function, published to an SNS topic, bounced back to the sender, or several of these actions in combination.

This is powerful because it means you can build entirely email-driven workflows without maintaining your own mail server. No SMTP daemons, no storage management, no spam filtering configuration—AWS handles those operational concerns.

### Verifying Your Domain for Email Receiving

Before you can receive email through SES, you need to prove that you own the domain. This process is called domain verification, and it's slightly different from the verification flow for sending email, though if you've already verified a domain for sending, the receiving setup is often already in place.

To verify your domain in the SES console, navigate to the Verified Identities section and select your domain. AWS will ask you to add specific DNS records to your domain registrar. You'll typically need to add:

- An MX (mail exchange) record that points to SES's regional endpoint
- An SPF (Sender Policy Framework) record if you haven't already
- A DKIM (DomainKeys Identified Mail) record to sign your email cryptographically

The specific DNS values depend on your region. For example, in us-east-1, your MX record might point to `inbound-smtp.us-east-1.amazonaws.com`. Always check the verification details in the SES console for your specific region to get the exact values.

After you add these DNS records, AWS performs DNS lookups to confirm the records exist. This typically completes within minutes, though DNS propagation can occasionally take longer. Once verified, your domain is ready to receive mail through SES.

It's worth noting that SES inbound receiving is not available in all regions. At the time of writing, it's available in a limited set of regions including us-east-1, us-west-2, and eu-west-1, though you should verify current availability in the AWS documentation for your target region. If your primary region doesn't support inbound SES, you'll need to route mail through a supported region, which adds complexity to the solution.

### Creating and Ordering Receipt Rules

Once your domain is verified, you create receipt rules that define how to handle incoming email. Receipt rules live in a receipt rule set, and within a rule set, order matters tremendously. AWS processes rules top-to-bottom, and the first rule that matches a recipient address determines what happens to that email.

Each receipt rule specifies:

- **Recipient filters**: Which email addresses the rule applies to (exact address, domain, or patterns)
- **Enabled/disabled status**: Whether the rule is active
- **Actions**: What AWS should do when the rule matches
- **TLS requirement**: Whether to require TLS encryption for the incoming connection

Let's say you want to route emails sent to `support@example.com` to a Lambda function, but emails to `notifications@example.com` to S3. You'd create two rules: the first matching `support@example.com` with a Lambda action, and the second matching `notifications@example.com` with an S3 action. If an email arrived for `support@example.com`, the first rule would match and process it; the second rule would never be evaluated for that email (unless the first rule had a "continue processing" flag, which it doesn't by default).

This ordered approach means you can build increasingly specific rules. For instance, you might have a catch-all rule at the end that matches any email to your domain and stores it in S3, with more specific rules above it that route particular addresses to Lambda functions or other actions.

### Available Receipt Rule Actions

SES gives you several action types to choose from, and you can combine multiple actions in a single rule. Understanding each option helps you design the right pipeline for your use case.

**S3 Action** stores the complete email message (headers, body, and attachments) in an S3 bucket as a file. AWS generates a unique object key for each email, typically based on a timestamp and random identifier. The email is stored in MIME format, which is the standard Internet format for email messages. This action is useful as a fallback or archive mechanism. Many pipelines use S3 to store emails before processing them, so you have a durable record of what came in.

**Lambda Action** invokes a Lambda function synchronously with the email message. The Lambda function receives the email details—sender, recipient, subject, body, and attachment metadata—as the event payload. This is where the real magic happens: your function can parse the email content, extract information, validate data, and trigger business logic. The Lambda must complete within the SES receipt action timeout, which is generous at 15 minutes, so you have time for meaningful processing.

**SNS Action** publishes a notification to an SNS topic. This is excellent for decoupling the receipt pipeline from downstream processing. Rather than making the Lambda function do all the work, you could have a lightweight Lambda that publishes to SNS, and then multiple subscribers can process the email independently. This approach scales well and makes your pipeline more resilient to processing failures.

**Bounce Action** sends a bounce message back to the sender, rejecting the email. You typically use this in rules that match spam or unwanted addresses, allowing you to reject mail before it consumes your processing resources.

**Stop Action** halts rule processing for that email without taking any other action. This is useful as a guard: you might have a rule that matches a particular address and stops processing, preventing a catch-all rule at the end from also handling it.

**WorkMail Action** forwards the email to an Amazon WorkMail mailbox, integrating with AWS's managed email service.

In practice, a robust pipeline often chains these actions. A single rule might store the email in S3 *and* invoke a Lambda function, ensuring you have a backup in S3 while the Lambda does synchronous processing.

### Designing Your Lambda Function

The Lambda function is the brain of your pipeline. It receives the email event, extracts relevant information, and triggers whatever business logic you need—creating a support ticket, extracting invoice data, updating a CRM, or anything else.

When SES invokes your Lambda function, the event structure includes:

- `Records`: An array of email messages (typically one, but SES can batch them)
- For each record: the `messageId`, `receipt`, `mail`, and `content`
- `mail` object contains `source`, `destination`, `timestamp`, and `headers`
- `receipt` object contains metadata about mail server interactions
- `content` is the raw email in MIME format

Here's a practical example: imagine you're building a support ticket system that accepts emails at `support@example.com`. When someone emails support, you want to parse their message and create a ticket in DynamoDB.

```python
import json
import boto3
import email
from email.mime.text import MIMEText
from uuid import uuid4
from datetime import datetime
import base64

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
tickets_table = dynamodb.Table('SupportTickets')

def lambda_handler(event, context):
    """
    Process inbound email and create a support ticket in DynamoDB.
    Email is stored in S3 by the receipt rule; we retrieve it and parse it.
    """
    
    # Extract the message ID and S3 bucket/key from the event
    for record in event['Records']:
        message_id = record['ses']['mail']['messageId']
        receipt = record['ses']['receipt']
        mail_data = record['ses']['mail']
        
        source_email = mail_data['source']
        destination = mail_data['destination'][0]
        subject = next(
            (h['value'] for h in mail_data['headers'] if h['name'] == 'Subject'),
            'No Subject'
        )
        
        # Retrieve the full email from S3
        # The S3 bucket and key are typically provided in the Lambda event,
        # but SES also stores emails in a predictable location if you've configured it
        bucket = 'your-email-bucket'
        key = f'emails/{message_id}'
        
        try:
            response = s3_client.get_object(Bucket=bucket, Key=key)
            email_content = response['Body'].read().decode('utf-8')
        except Exception as e:
            print(f"Error retrieving email from S3: {e}")
            return {'statusCode': 500, 'body': 'Failed to retrieve email'}
        
        # Parse the MIME email
        parsed_email = email.message_from_string(email_content)
        
        # Extract body text
        body_text = ""
        if parsed_email.is_multipart():
            for part in parsed_email.walk():
                if part.get_content_type() == "text/plain":
                    payload = part.get_payload(decode=True)
                    body_text = payload.decode('utf-8', errors='ignore')
                    break
        else:
            body_text = parsed_email.get_payload(decode=True).decode('utf-8', errors='ignore')
        
        # Extract attachments if needed
        attachments = []
        if parsed_email.is_multipart():
            for part in parsed_email.walk():
                if part.get_content_disposition() == 'attachment':
                    attachments.append({
                        'filename': part.get_filename(),
                        'content_type': part.get_content_type()
                    })
        
        # Create a ticket in DynamoDB
        ticket_id = str(uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        try:
            tickets_table.put_item(
                Item={
                    'ticketId': ticket_id,
                    'senderEmail': source_email,
                    'subject': subject,
                    'body': body_text,
                    'attachmentCount': len(attachments),
                    'createdAt': timestamp,
                    'status': 'open',
                    'messageId': message_id
                }
            )
            
            print(f"Successfully created ticket {ticket_id} for {source_email}")
            return {
                'statusCode': 200,
                'body': json.dumps({'ticketId': ticket_id})
            }
            
        except Exception as e:
            print(f"Error creating ticket: {e}")
            return {'statusCode': 500, 'body': 'Failed to create ticket'}
```

This function demonstrates the core pattern: retrieve the raw email from S3, parse it using Python's standard `email` library, extract the information you need, and store it in a persistent data store. In a real application, you'd add validation (checking that the sender is legitimate), error handling (what happens if DynamoDB is unavailable?), and additional processing (extracting structured data from the email body, running spam checks, assigning tickets to teams).

The beauty of this approach is that you're not limited to simple parsing. Your Lambda could call external APIs, perform machine learning inference to categorize the email, or even generate a response email using SES's sending functionality.

### Configuring IAM Permissions and S3 Bucket Policy

For this pipeline to work, you need to grant the right permissions to both SES and your Lambda function.

Your Lambda function needs permissions to:

- Read objects from the S3 bucket where SES stores emails
- Write items to your DynamoDB table
- (Optionally) write logs to CloudWatch Logs

Create an IAM policy that grants these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-email-bucket/emails/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/SupportTickets"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

Attach this policy to the IAM role that your Lambda function assumes.

Additionally, SES needs permission to put objects into your S3 bucket. Add a bucket policy to allow the SES service to write to the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSESPutObject",
      "Effect": "Allow",
      "Principal": {
        "Service": "ses.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::your-email-bucket/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "123456789012"
        }
      }
    }
  ]
}
```

Replace the account ID with your actual AWS account number. This policy allows only SES in your account to write to the bucket, preventing other accounts from abusing it.

It's good practice to also enable versioning and lifecycle policies on your email bucket. You likely don't need to keep raw emails forever, so a lifecycle rule that deletes objects after 30 or 90 days saves storage costs:

```
- Rule: Delete old emails
  - Apply to: All objects
  - Expiration: 90 days after creation
```

### Understanding Regional Availability

One critical constraint to be aware of: SES inbound email receiving is not available in all AWS regions. As of now, it's supported in us-east-1, us-west-2, eu-west-1, and a handful of other regions, but it's not available everywhere.

This matters because if your primary application region doesn't support inbound SES, you have limited options. You could create a separate AWS account in a supported region just for email processing, or you could route emails through a third-party mail service that then forwards them to SES in a supported region. Neither approach is ideal, but sometimes it's necessary.

Before investing significant effort in an SES inbound pipeline, verify that your target region supports it. Check the current SES region availability in the AWS documentation, as supported regions do expand over time.

### Putting It Together: A Complete Example

Let's walk through a complete scenario to tie all these pieces together. You're building a feedback collection system for your SaaS application. Users can email `feedback@example.com`, and each email automatically creates a record in DynamoDB that your team reviews later.

First, you verify the `example.com` domain for SES receiving in the us-east-1 region. You add the necessary DNS records (MX, SPF, DKIM) to your domain registrar.

Next, you create an S3 bucket called `feedback-emails` and add the bucket policy allowing SES to write to it.

You create a DynamoDB table called `Feedback` with a partition key of `feedbackId` and a sort key of `createdAt`, allowing you to efficiently query feedback by creation time.

In the Lambda console, you create a function called `ProcessFeedbackEmail` and attach an execution role with permissions to read from the S3 bucket and write to the DynamoDB table. You paste the parsing code above, customized for your feedback system.

Finally, you create a receipt rule set in SES with a single rule:
- Recipient: `feedback@example.com`
- Actions: Store in S3 (bucket: `feedback-emails`), Invoke Lambda (function: `ProcessFeedbackEmail`)
- Enabled: Yes

When a user sends an email to `feedback@example.com`, SES receives it, stores the full message in S3, and invokes your Lambda function. The function retrieves the email from S3, parses it, extracts the sender and message body, and creates a DynamoDB item. Your team can then query and analyze feedback directly from DynamoDB, with the raw email preserved in S3 as a backup.

### Best Practices and Considerations

Building a production email pipeline requires attention to several operational concerns.

**Error handling** is critical. Your Lambda function should handle exceptions gracefully—missing S3 objects, malformed emails, database write failures—and log them clearly. Use structured logging so CloudWatch Logs are queryable. Don't let an individual email crash your function; instead, log the error and move on.

**Scalability** is generally handled automatically by Lambda and DynamoDB, but think about throttling. If you suddenly receive thousands of emails, your Lambda will scale up, but DynamoDB writes might be throttled if you haven't provisioned enough capacity or enabled on-demand billing. Use CloudWatch alarms to monitor throttling and adjust capacity accordingly.

**Security** matters with email, which can be a vector for attacks. Validate email addresses, check for spam signatures, and be cautious about parsing untrusted content. If you're allowing file uploads via email attachments, scan them for malware before processing. The email body might contain malicious scripts or links, so sanitize anything you display to users.

**Cost** is usually low for inbound email—AWS charges per email received—but the S3 storage, Lambda invocations, and DynamoDB writes add up. Use lifecycle policies to clean up old emails in S3. Monitor your usage in the AWS Billing console to catch any surprises.

**Testing** is tricky because you can't easily simulate SES receipt events locally. Use the SES console to send test emails to your domain (from a verified email address if you're in the sandbox, or freely if you've exited it). Verify that emails make their way through your receipt rules and into your Lambda function by checking CloudWatch Logs.

### Conclusion

SES receipt rules and Lambda together provide a surprisingly powerful way to build email-driven applications without managing mail infrastructure. By verifying your domain, setting up receipt rules, and writing a Lambda function to parse and process emails, you can automate workflows that would otherwise require manual work or complex integrations.

The pattern you've learned here—receiving email, storing it durably in S3, parsing it in Lambda, and storing the results in a database—is adaptable to countless scenarios: support ticket systems, expense report submission, survey collection, document intake, or any system where email is a natural input channel. The key is understanding how receipt rules process emails in order, how to grant the right permissions, and how to parse MIME format emails reliably.

As you build your own pipeline, remember to test thoroughly, monitor your Lambda function and database metrics, and plan for error cases. Email is inherently asynchronous and unpredictable, so build with resilience in mind. Start simple, validate that emails are flowing through your system correctly, and then add sophistication as your needs grow.
