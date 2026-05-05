---
title: "Handling SES Bounces and Complaints with SNS, SQS, and Lambda"
---

## Handling SES Bounces and Complaints with SNS, SQS, and Lambda

Email delivery is deceptively complex. You send a message through Amazon Simple Email Service, and even if it leaves your account successfully, a dozen things can still go wrong on the receiving end. The mailbox might not exist. The recipient's server might reject it. Or the customer might hit the spam button. Without visibility into these outcomes, you're flying blind—and worse, you risk damaging your sender reputation and triggering AWS account restrictions.

Amazon SES provides a powerful mechanism to capture bounce and complaint events in real time, but only if you build the infrastructure to listen for them. That's where the combination of SNS, SQS, and Lambda becomes indispensable. This guide walks you through a complete, production-ready architecture for processing these critical events, updating your suppression lists automatically, and maintaining a healthy sending reputation.

### Why Bounce and Complaint Handling Matters

Let's start with the stakes. AWS monitors your bounce and complaint rates across all messages sent from your account. If your bounce rate exceeds 5 percent or your complaint rate hits 0.1 percent, AWS will place your account under review. Exceed those thresholds consistently, and you'll face sending restrictions or account suspension. These are hard limits designed to protect the entire AWS email infrastructure from becoming a vector for spam.

A bounce occurs when SES attempts to deliver your message to a recipient's mail server, but that server rejects it. There are two flavors: a permanent bounce (the address doesn't exist, or the server has permanently rejected it) and a transient bounce (temporary issues like a full mailbox or server unavailability). A complaint, by contrast, is when a recipient explicitly marks your message as spam or uses their email provider's abuse report feature. These are handled differently by SES and should trigger different suppression strategies.

Without automated bounce and complaint processing, you'd need to manually review delivery reports, identify bad addresses, and remove them from your sending lists. That approach doesn't scale. By the time you've processed a batch report, you've already sent to hundreds of dead addresses, tanking your metrics. Automation is not optional—it's the foundation of responsible email operations.

### The Architecture: SNS as Your Event Hub

When you send an email through SES, the service can publish bounce and complaint events to an SNS topic. This is configured at the domain or email identity level and happens automatically when you set it up. SNS acts as your event broker, decoupling SES from your processing logic.

To enable this, you first verify a domain or email address with SES. Then, navigate to the SES identity settings and configure notifications. You'll specify separate SNS topics for bounces, complaints, and delivery notifications. Each event category gets its own topic, which is a sensible architectural choice because bounces and complaints have different urgency levels and processing requirements. You might want to handle a hard bounce immediately, but delivery notifications could be processed in batch.

Here's the critical point: the SNS topic must be in the same AWS region as your SES identity. SES won't publish to a topic in a different region, so if you're sending from us-east-1, your SNS topics must be there too.

Once the SNS topic exists and is configured on your SES identity, SES begins publishing events to it automatically. You'll see nothing happen on the SNS side—no messages accumulate—until SES actually encounters a bounce or complaint. This is fine for testing, but in production, you'll want to make sure your subscriber is ready to receive before you start sending volume.

### Choosing Your Subscriber: SQS or Lambda?

This is the first architectural decision you'll make after setting up SNS. Both SQS and Lambda can subscribe to SNS, but they serve different use cases.

**SQS provides durable buffering.** When SES publishes a bounce event to the SNS topic, SQS receives it and holds it in a queue. Your processing logic (typically a Lambda function running on a schedule or triggered by SQS events) reads from the queue, processes the message, and deletes it upon success. If processing fails, the message returns to the queue after the visibility timeout expires, and you get a retry. This approach is fault-tolerant by design. If your processing Lambda crashes or your database is temporarily unavailable, the events are safely stored in SQS, and you'll process them when you're back online.

**Lambda offers immediate processing.** Configure SNS to trigger a Lambda function directly, and that function executes the moment SES publishes an event. There's no intermediate storage. This is lower latency—you're suppressing bad addresses the instant SES detects them. However, it's also less forgiving. If your Lambda crashes or times out, you've lost the event unless you've built additional error handling and logging.

The right choice depends on your volume and tolerance for failure. High-volume senders who can't afford to miss events should use SQS as a buffer, then process the queue with Lambda. Lower-volume senders with simple processing logic might opt for direct Lambda invocation, accepting slightly more latency in exchange for simpler infrastructure.

For this guide, we'll cover both patterns, but the production recommendation is SQS + Lambda for reliability.

### Understanding the SES Event Structure

When SES publishes a bounce or complaint event to SNS, it wraps the actual event in a JSON structure. Understanding this structure is essential for parsing and acting on the data.

Here's what a bounce event looks like:

```json
{
  "eventType": "Bounce",
  "bounce": {
    "bounceType": "Permanent",
    "bounceSubType": "General",
    "bouncedRecipients": [
      {
        "emailAddress": "invalid@example.com",
        "status": "5.1.1",
        "diagnosticCode": "smtp; 550 5.1.1 The email account that you tried to reach does not exist"
      }
    ],
    "timestamp": "2024-01-15T10:30:45.123Z",
    "feedbackId": "0000014c-7c18-4c83-bf3e-2aa8c4dbe040"
  },
  "mail": {
    "messageId": "abc123def456",
    "source": "noreply@yourdomain.com",
    "sourceArn": "arn:aws:ses:us-east-1:123456789012:identity/yourdomain.com",
    "sendingAccountId": "123456789012",
    "timestamp": "2024-01-15T10:30:30.000Z",
    "destination": ["invalid@example.com"]
  }
}
```

The `eventType` field tells you this is a bounce. The `bounce` object contains the details. Notice the `bounceType`: Permanent or Transient. A Permanent bounce means the address is definitely bad—the mailbox doesn't exist, or the domain has permanently rejected it. You should suppress these immediately and indefinitely. Transient bounces are temporary issues; you might suppress them for a few hours but retry later.

The `bouncedRecipients` array lists each address that bounced. A single email can have multiple recipients, so you might see several addresses in this array. For each, you get the `emailAddress`, an SMTP status code, and a diagnostic message.

A complaint event has a similar structure:

```json
{
  "eventType": "Complaint",
  "complaint": {
    "complaintFeedbackType": "abuse",
    "complainedRecipients": [
      {
        "emailAddress": "spam-complainer@example.com"
      }
    ],
    "timestamp": "2024-01-15T11:15:22.456Z",
    "feedbackId": "0000014c-7c18-4c83-bf3e-2aa8c4dbe041"
  },
  "mail": {
    "messageId": "xyz789abc123",
    "source": "noreply@yourdomain.com",
    "sourceArn": "arn:aws:ses:us-east-1:123456789012:identity/yourdomain.com",
    "sendingAccountId": "123456789012",
    "timestamp": "2024-01-15T11:15:10.000Z",
    "destination": ["spam-complainer@example.com"]
  }
}
```

The `complaint` object includes `complaintFeedbackType`, which can be "abuse", "auth-failure", "fraud", "not-spam", or "other". An "abuse" complaint is someone hitting the spam button; that's the most serious. "Not-spam" is rarer but indicates a false positive—the recipient didn't actually complain. You should always suppress addresses that generate complaints, regardless of type, but the feedback type can inform your analytics.

When SNS delivers to SQS, the event gets wrapped in another JSON envelope, so you need to parse accordingly. When SNS triggers Lambda directly, you'll receive the event in a specific format that we'll cover in the code examples below.

### Building the Processing Lambda

Let's write a Lambda function that processes bounce and complaint events. This function will read the SES event from SNS, parse it, identify the affected email addresses, and write them to a DynamoDB suppression table.

```python
import json
import boto3
from datetime import datetime, timedelta

dynamodb = boto3.resource('dynamodb')
suppression_table = dynamodb.Table('EmailSuppressionList')

def lambda_handler(event, context):
    """
    Process SES bounce and complaint events from SNS.
    Parses the event, extracts affected email addresses, and updates DynamoDB.
    """
    
    # Parse the SNS message
    sns_message = json.loads(event['Records'][0]['Sns']['Message'])
    
    event_type = sns_message.get('eventType')
    
    if event_type == 'Bounce':
        process_bounce(sns_message)
    elif event_type == 'Complaint':
        process_complaint(sns_message)
    else:
        print(f"Unknown event type: {event_type}")
        return {'statusCode': 400, 'body': 'Unknown event type'}
    
    return {'statusCode': 200, 'body': 'Event processed successfully'}

def process_bounce(event):
    """
    Handle a bounce event.
    Permanent bounces suppress indefinitely.
    Transient bounces suppress for 24 hours.
    """
    bounce = event['bounce']
    bounce_type = bounce['bounceType']  # 'Permanent' or 'Transient'
    timestamp = bounce['timestamp']
    feedback_id = bounce['feedbackId']
    
    # Determine suppression duration
    if bounce_type == 'Permanent':
        suppress_until = None  # Suppress indefinitely
        reason = 'permanent_bounce'
    else:
        # Suppress for 24 hours
        suppress_until = (datetime.now() + timedelta(hours=24)).isoformat()
        reason = 'transient_bounce'
    
    # Process each bounced recipient
    for recipient in bounce['bouncedRecipients']:
        email = recipient['emailAddress']
        diagnostic = recipient.get('diagnosticCode', 'Unknown')
        
        update_suppression_list(
            email_address=email,
            reason=reason,
            suppress_until=suppress_until,
            diagnostic=diagnostic,
            feedback_id=feedback_id,
            timestamp=timestamp
        )
        print(f"Suppressed {email} due to {bounce_type} bounce")

def process_complaint(event):
    """
    Handle a complaint event.
    All complaints result in indefinite suppression.
    """
    complaint = event['complaint']
    timestamp = complaint['timestamp']
    feedback_id = complaint['feedbackId']
    feedback_type = complaint.get('complaintFeedbackType', 'unknown')
    
    # Process each complained address
    for recipient in complaint['complainedRecipients']:
        email = recipient['emailAddress']
        
        update_suppression_list(
            email_address=email,
            reason=f'complaint_{feedback_type}',
            suppress_until=None,  # Indefinite suppression
            diagnostic=feedback_type,
            feedback_id=feedback_id,
            timestamp=timestamp
        )
        print(f"Suppressed {email} due to complaint ({feedback_type})")

def update_suppression_list(email_address, reason, suppress_until, diagnostic, feedback_id, timestamp):
    """
    Update the DynamoDB suppression list.
    Uses email address as the partition key.
    """
    item = {
        'email': email_address,
        'reason': reason,
        'suppressedAt': timestamp,
        'feedbackId': feedback_id,
        'diagnostic': diagnostic
    }
    
    if suppress_until:
        item['suppressUntil'] = suppress_until
    
    try:
        suppression_table.put_item(Item=item)
    except Exception as e:
        print(f"Error updating suppression list for {email_address}: {str(e)}")
        raise
```

This function handles the SNS event format directly. When SNS triggers Lambda, it wraps the SES event in a Records array, with the actual message in the `Sns.Message` field. We parse that JSON, determine whether it's a bounce or complaint, and dispatch to the appropriate handler.

For bounces, we distinguish between Permanent and Transient types. Permanent bounces are absolute—those addresses will never accept mail, so we suppress them indefinitely. Transient bounces are temporary issues that might resolve, so we suppress for 24 hours, allowing retries later.

For complaints, we suppress indefinitely regardless of the feedback type. If someone marks your email as spam, you don't want to send to them again.

The `update_suppression_list` function writes to DynamoDB. The email address is the partition key, making lookups fast. We store the reason, timestamp, feedback ID, and diagnostic information for later analysis.

### Integrating with SQS for Durable Processing

If you prefer the buffering approach, you'd configure SNS to deliver to an SQS queue, then have a separate Lambda process the queue. Here's how the queue-reading Lambda differs:

```python
import json
import boto3
from datetime import datetime, timedelta

sqs = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')
suppression_table = dynamodb.Table('EmailSuppressionList')

def lambda_handler(event, context):
    """
    Process SES bounce/complaint events from an SQS queue.
    """
    for record in event['Records']:
        try:
            # SQS wraps the SNS message in the body
            sns_message_json = record['body']
            sns_message = json.loads(sns_message_json)
            
            # The SNS message itself is JSON, extract the Message field
            ses_event = json.loads(sns_message['Message'])
            
            event_type = ses_event.get('eventType')
            
            if event_type == 'Bounce':
                process_bounce(ses_event)
            elif event_type == 'Complaint':
                process_complaint(ses_event)
            
            # If successful, the message is deleted by returning normally
            # AWS Lambda automatically handles SQS integration
        except Exception as e:
            print(f"Error processing message: {str(e)}")
            # If an error occurs, the message remains in the queue
            # and will be retried based on the visibility timeout
            raise

def process_bounce(event):
    # (Same implementation as the direct Lambda version)
    bounce = event['bounce']
    bounce_type = bounce['bounceType']
    timestamp = bounce['timestamp']
    feedback_id = bounce['feedbackId']
    
    if bounce_type == 'Permanent':
        suppress_until = None
        reason = 'permanent_bounce'
    else:
        suppress_until = (datetime.now() + timedelta(hours=24)).isoformat()
        reason = 'transient_bounce'
    
    for recipient in bounce['bouncedRecipients']:
        email = recipient['emailAddress']
        diagnostic = recipient.get('diagnosticCode', 'Unknown')
        
        update_suppression_list(
            email_address=email,
            reason=reason,
            suppress_until=suppress_until,
            diagnostic=diagnostic,
            feedback_id=feedback_id,
            timestamp=timestamp
        )

def process_complaint(event):
    # (Same implementation as the direct Lambda version)
    complaint = event['complaint']
    timestamp = complaint['timestamp']
    feedback_id = complaint['feedbackId']
    feedback_type = complaint.get('complaintFeedbackType', 'unknown')
    
    for recipient in complaint['complainedRecipients']:
        email = recipient['emailAddress']
        
        update_suppression_list(
            email_address=email,
            reason=f'complaint_{feedback_type}',
            suppress_until=None,
            diagnostic=feedback_type,
            feedback_id=feedback_id,
            timestamp=timestamp
        )

def update_suppression_list(email_address, reason, suppress_until, diagnostic, feedback_id, timestamp):
    # (Same implementation as before)
    item = {
        'email': email_address,
        'reason': reason,
        'suppressedAt': timestamp,
        'feedbackId': feedback_id,
        'diagnostic': diagnostic
    }
    
    if suppress_until:
        item['suppressUntil'] = suppress_until
    
    try:
        suppression_table.put_item(Item=item)
    except Exception as e:
        print(f"Error updating suppression list for {email_address}: {str(e)}")
        raise
```

The key difference is the message parsing. SQS delivers the SNS message in the record's `body` field, and that body is JSON-encoded. We have to parse it once to extract the actual SES event. The logic is otherwise identical.

With SQS, if the function raises an exception, the message isn't deleted from the queue, so it will be retried. This gives you a safety net. If DynamoDB is temporarily unavailable, the message stays in the queue and is retried a few minutes later.

### Configuring the SNS-SQS Integration

To hook up SNS and SQS, you need to create an SQS queue and subscribe it to the SNS topic. Here's the configuration using AWS CLI:

```bash
# Create the SQS queue
aws sqs create-queue --queue-name ses-bounce-complaint-queue --region us-east-1

# Store the queue URL for later
QUEUE_URL="https://sqs.us-east-1.amazonaws.com/123456789012/ses-bounce-complaint-queue"

# Get the queue ARN
aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names QueueArn --region us-east-1
# Copy the QueueArn from the output

QUEUE_ARN="arn:aws:sqs:us-east-1:123456789012:ses-bounce-complaint-queue"

# Subscribe the queue to the SNS topic
aws sns subscribe --topic-arn "arn:aws:sns:us-east-1:123456789012:ses-bounces" \
  --protocol sqs \
  --notification-endpoint $QUEUE_ARN \
  --region us-east-1
```

You'll also need to attach a queue policy allowing SNS to send messages to SQS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:ses-bounce-complaint-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:ses-bounces"
        }
      }
    }
  ]
}
```

Then configure your Lambda to be triggered by SQS events. In the Lambda console, add an SQS trigger, point it to the queue, and set the batch size to something reasonable like 10. The batch size determines how many messages Lambda reads from the queue at once; larger batches are more efficient for high-volume scenarios.

### Checking Against the Account-Level Suppression List

AWS SES maintains an account-level suppression list that's separate from your custom suppression logic. When an email address is added to the suppression list due to a bounce or complaint, SES won't attempt delivery to that address from any sender in your account, regardless of whether your application checks your own suppression table.

You can query this list via the SES API:

```python
import boto3

ses_client = boto3.client('ses', region_name='us-east-1')

def is_suppressed(email_address):
    """
    Check if an email address is on the account-level SES suppression list.
    """
    try:
        response = ses_client.get_suppressed_destination(EmailAddress=email_address)
        # If we get here, the email is suppressed
        return True, response['SuppressedDestinationAttributes']['Reason']
    except ses_client.exceptions.NotFoundException:
        # Email is not on the suppression list
        return False, None
```

The `Reason` field will be "BOUNCE" or "COMPLAINT", indicating why the address was suppressed. You can use this to validate your application's suppression table against AWS's, and to understand why specific addresses can't be sent to.

Importantly, you can't directly add addresses to this account-level list yourself. SES populates it automatically based on bounce and complaint events. However, you can remove addresses with the `delete_suppressed_destination` API if you need to reset a suppression:

```python
def remove_suppression(email_address):
    """
    Remove an email address from the account-level suppression list.
    Use this sparingly—only if you've confirmed a bounce or complaint was erroneous.
    """
    try:
        ses_client.delete_suppressed_destination(EmailAddress=email_address)
        print(f"Removed {email_address} from suppression list")
    except Exception as e:
        print(f"Error removing suppression: {str(e)}")
```

### Building a Pre-Send Suppression Check

Before sending an email, you should check your suppression table. This prevents wasted sends and keeps your bounce rate clean:

```python
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
suppression_table = dynamodb.Table('EmailSuppressionList')

def should_suppress(email_address):
    """
    Determine if an email address should be suppressed.
    Returns True if the address is permanently suppressed or temporarily suppressed and the hold time hasn't expired.
    """
    try:
        response = suppression_table.get_item(Key={'email': email_address})
        
        if 'Item' not in response:
            return False  # Not suppressed
        
        item = response['Item']
        
        # If there's a suppressUntil field, check if the hold has expired
        if 'suppressUntil' in item:
            suppress_until_dt = datetime.fromisoformat(item['suppressUntil'])
            if datetime.now() < suppress_until_dt:
                return True  # Still within the suppression window
            else:
                # Suppression window has expired, remove the entry
                suppression_table.delete_item(Key={'email': email_address})
                return False
        else:
            # No suppressUntil means indefinite suppression (complaint or permanent bounce)
            return True
    
    except Exception as e:
        print(f"Error checking suppression for {email_address}: {str(e)}")
        # On error, err on the side of caution and suppress
        return True

def send_email_safely(recipient, subject, body):
    """
    Send an email only if the recipient is not suppressed.
    """
    if should_suppress(recipient):
        print(f"Skipping send to {recipient} - address is suppressed")
        return False
    
    ses_client = boto3.client('ses', region_name='us-east-1')
    
    try:
        ses_client.send_email(
            Source='noreply@yourdomain.com',
            Destination={'ToAddresses': [recipient]},
            Message={
                'Subject': {'Data': subject},
                'Body': {'Text': {'Data': body}}
            }
        )
        print(f"Sent email to {recipient}")
        return True
    except Exception as e:
        print(f"Error sending email to {recipient}: {str(e)}")
        return False
```

This function queries DynamoDB before each send. For permanent bounces and complaints (which have no `suppressUntil`), it always suppresses. For transient bounces, it checks whether the suppression window has expired. If it has, the function removes the entry, allowing retries.

This adds a database query to every send operation, which can add latency. For high-volume senders, you might cache this data in memory or use DynamoDB's TTL feature to automatically expire transient suppression records:

```python
# When updating suppression for transient bounces:
item = {
    'email': email_address,
    'reason': 'transient_bounce',
    'suppressedAt': timestamp,
    'feedbackId': feedback_id,
    'diagnostic': diagnostic,
    'suppressUntil': suppress_until_timestamp,
    'ttl': int((datetime.now() + timedelta(hours=24)).timestamp())
}
```

Set a TTL attribute with a Unix timestamp, and DynamoDB automatically deletes the item after that time. You'd still want to check the `suppressUntil` field before sending, but at least the database won't accumulate stale entries.

### Monitoring Your Bounce and Complaint Rates

AWS CloudWatch publishes metrics for bounces and complaints. You should monitor these constantly:

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def get_bounce_rate():
    """
    Retrieve the bounce rate metric for the last hour.
    """
    response = cloudwatch.get_metric_statistics(
        Namespace='AWS/SES',
        MetricName='Bounce',
        Dimensions=[
            {
                'Name': 'Identity',
                'Value': 'yourdomain.com'
            }
        ],
        StartTime=datetime.now() - timedelta(hours=1),
        EndTime=datetime.now(),
        Period=3600,
        Statistics=['Sum']
    )
    
    datapoints = response['Datapoints']
    if not datapoints:
        return None
    
    total_bounces = sum([dp['Sum'] for dp in datapoints])
    return total_bounces

def get_complaint_rate():
    """
    Retrieve the complaint rate metric for the last hour.
    """
    response = cloudwatch.get_metric_statistics(
        Namespace='AWS/SES',
        MetricName='Complaint',
        Dimensions=[
            {
                'Name': 'Identity',
                'Value': 'yourdomain.com'
            }
        ],
        StartTime=datetime.now() - timedelta(hours=1),
        EndTime=datetime.now(),
        Period=3600,
        Statistics=['Sum']
    )
    
    datapoints = response['Datapoints']
    if not datapoints:
        return None
    
    total_complaints = sum([dp['Sum'] for dp in datapoints])
    return total_complaints
```

You should also track the number of sends to calculate the actual rates. CloudWatch publishes a Send metric too. Set up a CloudWatch alarm that triggers if your bounce rate approaches 5 percent or your complaint rate nears 0.1 percent. This gives you early warning before you hit AWS's thresholds.

### Best Practices and Common Pitfalls

Here are several important considerations as you build this system:

**Test with sandbox mode first.** If your AWS account is in SES sandbox mode, you can only send to verified email addresses. This limits your ability to test bounce and complaint events naturally. Use the SES test email addresses (mailbox-simulator@example.com) to trigger test events. You can send to bounce-simulator@example.com to trigger a bounce event, or complaint-simulator@example.com to trigger a complaint.

**Set reasonable Lambda timeouts.** Bounce and complaint processing shouldn't take long, but if you're updating multiple records in DynamoDB, allocate at least 30 seconds. If processing times out, the message won't be deleted from SQS, and you'll retry, potentially duplicating your suppression updates. DynamoDB's put_item is idempotent, so duplicates aren't harmful, but they waste resources.

**Monitor for duplicate events.** SNS doesn't guarantee exactly-once delivery in all edge cases. You might receive the same bounce or complaint event twice. Use the `feedbackId` to detect and ignore duplicates. Store the feedback ID in DynamoDB alongside the suppression record, and check for it before processing.

**Be careful with complaint suppression removal.** If someone complains, never automatically unsuppress them. Complaints indicate intent to not receive your mail. If you want to resend to a previously complained address, require explicit re-consent.

**Use separate topics for bounces and complaints.** As mentioned earlier, configuring separate SNS topics for each event type allows you to handle them with different logic or different Lambda functions. Bounces might be processed immediately, while complaints might be logged to a separate audit trail.

**Keep suppression records indefinitely.** While transient bounces expire after 24 hours, keep a historical record of all bounce and complaint events in a separate table for analytics and compliance. You might want to know that an address bounced three months ago.

**Test the end-to-end flow in staging.** Before deploying to production, trigger test events from SES and verify that your Lambda processes them correctly, that DynamoDB gets updated, and that subsequent sends are suppressed. Use CloudWatch Logs to trace execution.

### Conclusion

Building an automated bounce and complaint processing pipeline is essential for maintaining a healthy sender reputation and avoiding AWS account restrictions. By combining SNS as your event broker, SQS for durable buffering (or direct Lambda invocation for simplicity), and DynamoDB for your suppression list, you create a resilient system that keeps your delivery rates clean and your metrics healthy.

The key architectural decisions are choosing between immediate Lambda processing and SQS-buffered processing based on your volume and fault-tolerance requirements, properly parsing the SES event structure to extract bounce types and complaint feedback, and checking your suppression list before every send. Combined with monitoring your bounce and complaint metrics in CloudWatch, this architecture gives you visibility into your email health and the automation to maintain it.

Start by configuring SNS notifications on a verified SES identity, then build and test your processing Lambda in a non-production environment. Use the mailbox-simulator addresses to trigger test events and validate your end-to-end flow. Once you're confident, deploy to production and watch your suppression system automatically protect your sending reputation.
