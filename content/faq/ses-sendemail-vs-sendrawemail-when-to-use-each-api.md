---
title: "SES SendEmail vs SendRawEmail: When to Use Each API"
---

## SES SendEmail vs SendRawEmail: When to Use Each API

Amazon SES provides multiple APIs for sending emails, and choosing the right one can mean the difference between a straightforward implementation and days of debugging. Whether you're sending a password reset link, a receipt with a PDF attachment, or a bulk marketing campaign, AWS SES has an API designed for your use case. In this article, we'll explore the two main sending APIs—SendEmail and SendRawEmail—along with their templated cousins, and help you understand when to reach for each one.

### Understanding the Two Core SES APIs

AWS SES offers two fundamental approaches to sending emails: the high-level SendEmail API and the low-level SendRawEmail API. The difference between them hinges on what control you need over the email's structure and content.

**SendEmail** is the straightforward option. You provide a subject, body content, and recipient addresses, and SES assembles a proper email message for you. It's the API equivalent of handing someone a letter and asking them to mail it—they handle the envelope, postage, and delivery logistics. This API is perfect for transactional emails: password resets, order confirmations, account notifications, and similar one-off messages where you care about getting information to the user quickly without fussing over the fine details of email formatting.

**SendRawEmail**, by contrast, expects you to provide the entire email message in MIME format. MIME (Multipurpose Internet Mail Extensions) is the standard format that email systems use under the hood—it's essentially the raw, fully-formed letter you'd prepare yourself before handing it to the postal service. This gives you granular control over every aspect of the email: custom headers, attachments, multipart message structures with both HTML and plain text versions, and cryptographic signatures. The tradeoff is complexity; you're responsible for constructing valid MIME, and mistakes can result in malformed emails or delivery failures.

### SendEmail: The Simple Path for Transactional Messages

SendEmail is designed for developers who want to send emails without getting bogged down in email standards. You call the API with a straightforward structured payload, and SES takes care of the rest.

Here's what a typical SendEmail call looks like using the AWS SDK for Python (boto3):

```python
import boto3

ses_client = boto3.client('ses', region_name='us-east-1')

response = ses_client.send_email(
    Source='noreply@example.com',
    Destination={
        'ToAddresses': ['user@example.com'],
        'CcAddresses': ['manager@example.com'],
        'BccAddresses': []
    },
    Message={
        'Subject': {
            'Data': 'Your Account Confirmation',
            'Charset': 'UTF-8'
        },
        'Body': {
            'Text': {
                'Data': 'Please confirm your account by clicking the link below.',
                'Charset': 'UTF-8'
            },
            'Html': {
                'Data': '<html><body><p>Please confirm your account by <a href="https://example.com/confirm">clicking here</a>.</p></body></html>',
                'Charset': 'UTF-8'
            }
        }
    }
)

print(f"Email sent! Message ID: {response['MessageId']}")
```

Notice how clean this is. You're declaring your intent in clear, structured fields: who it's from, who it goes to, what the subject is, and what the body contains. The SDK and SES handle email formatting, proper encoding, and MIME structure generation behind the scenes.

SendEmail is particularly well-suited for high-volume transactional email because it's simple to implement, harder to misconfigure, and performs well under load. If you're building a sign-up flow, password recovery, or invoice delivery system, SendEmail is often your best choice. The API even lets you specify both plain text and HTML versions of your body, so email clients can choose whichever they prefer to display.

One limitation worth noting: SendEmail does not natively support file attachments. If you need to attach a PDF invoice, a CSV export, or any other file, SendEmail alone won't do it. That's where SendRawEmail enters the picture.

### SendRawEmail: Full Control for Complex Requirements

SendRawEmail demands that you provide a complete, valid MIME message as a single string. This is more complex to construct, but it unlocks capabilities SendEmail doesn't provide: attachments, custom headers, DKIM signatures of your custom content, and fine-grained control over multipart message structures.

Constructing MIME by hand is tedious and error-prone, which is why most developers use their language's email library to build the message, then pass it to SendRawEmail. Let's see how this works in Python using the `email` library:

```python
import boto3
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

ses_client = boto3.client('ses', region_name='us-east-1')

# Create a multipart message
msg = MIMEMultipart('alternative')
msg['Subject'] = 'Your Invoice'
msg['From'] = 'billing@example.com'
msg['To'] = 'customer@example.com'

# Attach plain text version
text_part = MIMEText('Please see the attached invoice.', 'plain')
msg.attach(text_part)

# Attach HTML version
html_part = MIMEText('<html><body><p>Please see the attached invoice.</p></body></html>', 'html')
msg.attach(html_part)

# Attach PDF file
with open('invoice.pdf', 'rb') as attachment:
    part = MIMEBase('application', 'octet-stream')
    part.set_payload(attachment.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', 'attachment', filename='invoice.pdf')
    msg.attach(part)

# Send via SendRawEmail
response = ses_client.send_raw_email(
    RawMessage={
        'Data': msg.as_string()
    }
)

print(f"Email sent! Message ID: {response['MessageId']}")
```

Here, we're using Python's built-in `email.mime` modules to construct a proper MIME message with multiple parts: plain text, HTML, and a binary attachment. The `msg.as_string()` method serializes this into the raw MIME format that SendRawEmail expects. SES then sends this message exactly as you've built it.

In Node.js, the pattern is similar, though you might lean on a library like `nodemailer` or `aws-sdk` with the `raw-email` approach. Here's an example using the AWS SDK for JavaScript with the `mailcomposer` pattern (or a similar utility):

```javascript
const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');

const ses = new AWS.SES({ region: 'us-east-1' });

// Create a transporter using SES
const transporter = nodemailer.createTransport({
    SES: ses
});

const mailOptions = {
    from: 'billing@example.com',
    to: 'customer@example.com',
    subject: 'Your Invoice',
    text: 'Please see the attached invoice.',
    html: '<html><body><p>Please see the attached invoice.</p></body></html>',
    attachments: [
        {
            filename: 'invoice.pdf',
            path: './invoice.pdf',
            contentType: 'application/pdf'
        }
    ]
};

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error('Error sending email:', error);
    } else {
        console.log('Email sent! Message ID:', info.response);
    }
});
```

Nodemailer abstracts away much of the MIME complexity, making SendRawEmail easier to work with in Node.js. The library handles MIME construction internally and passes the raw message to SES.

### Why Use SendRawEmail?

Beyond attachments, SendRawEmail is the right choice when you need:

Custom headers for tracking or routing. You might add an `X-Custom-ID` header to correlate the email with a record in your database, or set headers that downstream systems will parse. SendEmail doesn't give you this flexibility.

DKIM signing of your custom content. If you're handling DKIM signing yourself (rather than letting SES manage it), SendRawEmail lets you sign the message before sending.

Complex multipart structures. While SendEmail supports text and HTML alternatives, SendRawEmail gives you full control over nested multiparts, which can be useful for sophisticated email layouts or when integrating with specialized email rendering systems.

Precise control over character encoding or MIME boundaries. For most use cases this isn't necessary, but if you're dealing with legacy systems or unusual character sets, SendRawEmail gives you the control.

### Templated Sending: SendTemplatedEmail and SendBulkTemplatedEmail

For mass mailing campaigns or when you're sending similar emails with slight variations (like including a customer's name or order number), AWS SES provides templated APIs that sit between SendEmail's simplicity and SendRawEmail's complexity.

**SendTemplatedEmail** sends a single email using a template you've defined in SES. You provide template variables, and SES substitutes them into your pre-designed template. This is ideal for scenarios where you have a standard email design but need to personalize it slightly for each recipient.

**SendBulkTemplatedEmail** extends this concept to many recipients at once. Instead of making a separate API call for each customer, you pass a list of recipients and their individual variables in a single call, and SES handles sending to all of them. This is far more efficient for newsletters, announcements, or bulk transactional emails.

Here's how SendTemplatedEmail works in Python:

```python
import boto3

ses_client = boto3.client('ses', region_name='us-east-1')

response = ses_client.send_templated_email(
    Source='noreply@example.com',
    Destination={
        'ToAddresses': ['john@example.com']
    },
    Template='WelcomeEmail',  # Name of your template in SES
    TemplateData='{"name": "John", "confirmationLink": "https://example.com/confirm/abc123"}'
)

print(f"Email sent! Message ID: {response['MessageId']}")
```

You'd have created the `WelcomeEmail` template in SES beforehand, with placeholders like `{{name}}` and `{{confirmationLink}}`. The `TemplateData` parameter passes JSON that fills in those placeholders.

SendBulkTemplatedEmail is perfect when you're sending the same template to hundreds or thousands of recipients with personalized data:

```python
import boto3
import json

ses_client = boto3.client('ses', region_name='us-east-1')

destinations = [
    {
        'Destination': {'ToAddresses': ['alice@example.com']},
        'ReplacementTemplateData': json.dumps({
            'name': 'Alice',
            'confirmationLink': 'https://example.com/confirm/xyz789'
        })
    },
    {
        'Destination': {'ToAddresses': ['bob@example.com']},
        'ReplacementTemplateData': json.dumps({
            'name': 'Bob',
            'confirmationLink': 'https://example.com/confirm/def456'
        })
    }
]

response = ses_client.send_bulk_templated_email(
    Source='noreply@example.com',
    Template='WelcomeEmail',
    DefaultTemplateData=json.dumps({'confirmationLink': 'https://example.com/confirm'}),
    Destinations=destinations
)

print(f"Bulk emails queued! Message IDs: {response['Status']}")
```

SendBulkTemplatedEmail returns status for each destination, letting you know which recipients were successfully queued for delivery.

### Choosing the Right API for Your Use Case

The decision tree is straightforward once you understand what each API offers:

**Use SendEmail** if you're sending transactional, one-off messages without attachments. Password resets, OTP codes, order confirmations, and account alerts are prime candidates. The simplicity and low error rate make it ideal for high-volume transactional email.

**Use SendRawEmail** if you need to attach files, set custom headers, or have other requirements beyond what SendEmail supports. The complexity is worthwhile when you genuinely need the extra control.

**Use SendTemplatedEmail** for single, personalized emails built from a standard template. Welcome emails, personalized recommendations, and one-off notifications where you want consistent design with variable content fit well here.

**Use SendBulkTemplatedEmail** when you're sending the same template to many recipients with slight variations for each. Newsletters, marketing campaigns, bulk onboarding emails, and similar batch operations are where this API shines. It's far more efficient than calling SendTemplatedEmail repeatedly.

### Common Pitfalls and Best Practices

A frequent mistake with SendRawEmail is forgetting to properly encode attachments or construct valid MIME. Always use your language's email library (Python's `email.mime`, Node.js's `nodemailer`, etc.) rather than trying to build MIME strings by hand. Errors in MIME syntax can cause emails to arrive malformed or not at all.

Another pitfall is attempting to use SendEmail for scenarios that actually need SendRawEmail. Developers sometimes try to work around SendEmail's lack of attachment support by encoding files in the body as base64 or HTML, which is messy and unreliable. If you need attachments, just use SendRawEmail and be done with it.

Remember that all SES APIs require the sender address to be verified in SES. If you're in the sandbox (the default state for new SES accounts), recipient addresses must also be verified. Once you request production access, you can send to any address, though you'll still want to manage your sending reputation carefully.

For security, never hardcode AWS credentials in your code. Use IAM roles if you're running on EC2, ECS, or Lambda. For local development, use the AWS CLI credentials file or environment variables.

### Conclusion

SendEmail and SendRawEmail represent two different philosophies: convenience versus control. SendEmail gets you sending emails quickly with minimal boilerplate, making it ideal for transactional messages. SendRawEmail unlocks advanced features like attachments and custom headers, at the cost of additional complexity. The templated APIs layer on top of these, providing efficiency and consistency for bulk sending scenarios.

The right choice depends on your specific requirements. Start with SendEmail for transactional messages, reach for SendRawEmail when you need attachments or custom control, and leverage the templated APIs when you're personalizing standard designs at scale. Understanding these distinctions will save you time during implementation and help you build robust, maintainable email systems on AWS.
