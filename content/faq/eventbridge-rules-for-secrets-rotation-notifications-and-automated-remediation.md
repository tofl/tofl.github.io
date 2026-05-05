---
title: "EventBridge Rules for Secrets Rotation Notifications and Automated Remediation"
---

# EventBridge Rules for Secrets Rotation Notifications and Automated Remediation

Secret rotation is one of those operational practices that feels boring until something goes wrong. You're cruising along with your application happily refreshing database credentials every 30 days, and then rotation fails silently. By the time you notice, your application is already rejecting connections and the on-call engineer is fielding angry Slack messages at 2 AM.

What if you could detect rotation failures the moment they happen and automatically trigger remediation? What if you could notify your ops team before customers start complaining? This is where AWS Secrets Manager and EventBridge work together to transform secret rotation from a silent background process into a fully orchestrated, observable workflow.

In this article, we'll explore how Secrets Manager publishes rotation events, how EventBridge captures and routes those events, and how you can build automated responses that keep your applications resilient even when secrets need refreshing. You'll learn to distinguish between RotationSucceeded and RotationFailed events, craft effective EventBridge rules, and chain together services like SNS, Lambda, and SQS to create a rotation workflow that actually helps you sleep at night.

### Understanding Secrets Manager Rotation Events

When Secrets Manager rotates a secret, it doesn't just quietly update the value in a vault somewhere. Instead, it emits CloudEvents that describe exactly what happened. These events are sent to your AWS account's default event bus, where EventBridge can pick them up and route them wherever you need them to go.

Secrets Manager publishes two primary rotation-related events: `RotationSucceeded` and `RotationFailed`. A `RotationSucceeded` event fires when a rotation completes without errors. This might seem like a "do nothing" scenario—everything worked as intended. But in practice, successful rotation events can be valuable for audit trails, inventory updates, or triggering dependent service refreshes that should happen after new credentials are available.

A `RotationFailed` event, by contrast, indicates that something went wrong during the rotation process. This could mean the Lambda rotation function encountered an error, the rotation configuration was invalid, or the secret's associated database or service became unreachable mid-rotation. Unlike a successful rotation, a failure demands immediate attention and automated response.

The event itself contains useful context: the ARN of the secret, a unique rotation ID, and details about what failed. This information becomes your starting point for intelligent remediation. You're not just getting a notification that something broke; you're getting the specific secret involved, which allows you to take targeted action.

### The EventBridge Rule: Capturing Rotation Events

EventBridge is AWS's central event routing service. Any AWS service that emits events sends them to an event bus, and EventBridge rules determine where those events go next. For Secrets Manager rotation events, you'll create rules on the default event bus (unless your organization requires a custom event bus for compliance reasons).

Creating an EventBridge rule for rotation events requires two key components: a pattern that matches the events you care about, and targets that specify what happens when a match occurs.

Here's the pattern structure you'll use to match Secrets Manager rotation events:

```json
{
  "source": ["aws.secretsmanager"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["secretsmanager.amazonaws.com"],
    "eventName": ["RotationSucceeded", "RotationFailed"]
  }
}
```

This pattern tells EventBridge: "Listen for events from Secrets Manager, and specifically capture events where the eventName is either RotationSucceeded or RotationFailed." Note that we're filtering on CloudTrail API calls, which is how Secrets Manager reports these events.

However, if you want more granular control, you can split these into separate rules—one for successes and one for failures. This allows you to route them to different targets or apply different logic.

```json
{
  "source": ["aws.secretsmanager"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["secretsmanager.amazonaws.com"],
    "eventName": ["RotationFailed"]
  }
}
```

This failure-specific rule can then route to more aggressive remediation workflows, while a success rule might quietly update an audit log.

When you use the AWS Management Console or AWS CLI to create these rules, EventBridge validates that the pattern makes sense before saving it. If you're working with infrastructure-as-code tools like CloudFormation or Terraform, the same validation happens at deployment time, preventing invalid rules from accidentally slipping into production.

### Routing to SNS for Immediate Notifications

When a secret rotation fails, your ops team needs to know about it fast. SNS (Simple Notification Service) is the natural choice for broadcasting failure notifications to the right people.

To add an SNS target to your EventBridge rule, you first create an SNS topic:

```bash
aws sns create-topic --name secret-rotation-failures
```

This gives you a topic ARN, which you then reference when creating the EventBridge rule target. You can do this via the CLI:

```bash
aws events put-targets \
  --rule rotation-failure-rule \
  --targets "Id"="1","Arn"="arn:aws:sns:us-east-1:123456789012:secret-rotation-failures"
```

Now, whenever a RotationFailed event reaches this rule, EventBridge automatically sends a message to your SNS topic. Any subscribers—email addresses, Slack webhooks, or PagerDuty integrations—receive the notification in real time.

The SNS message itself contains the entire EventBridge event as JSON. This means your ops team sees not just "a secret rotation failed" but the actual secret ARN, the rotation ID, and any error details captured by the Lambda rotation function. They can immediately identify which service is affected and start investigating.

In practice, you might subscribe multiple endpoints to this topic. A team might have an email subscription for record-keeping, a Lambda function that opens a ticket in their incident management system, and a webhook integration with their chat platform for immediate visibility. SNS handles the fan-out automatically.

### Lambda-Based Remediation Workflows

SNS notifications are reactive—someone sees the message and decides what to do next. But with Lambda, you can automate the remediation entirely, turning a failure into an automated recovery attempt.

Imagine a scenario where your database password rotation fails. Instead of waiting for an engineer to manually retry the rotation or restore the previous password, a Lambda function can immediately attempt to restore the system to a known good state. This function becomes a target of your failure-triggered EventBridge rule.

Here's a practical example of a Lambda function designed to handle rotation failures:

```python
import boto3
import json

secrets_client = boto3.client('secretsmanager')
sns_client = boto3.client('sns')

def lambda_handler(event, context):
    # Extract the secret ARN from the rotation failure event
    secret_arn = event['detail']['requestParameters']['secretId']
    
    try:
        # Attempt to retrieve the current secret version
        response = secrets_client.describe_secret(SecretId=secret_arn)
        
        # Check if there's a previous version we can fall back to
        version_ids = response.get('VersionIdsToStages', {})
        
        # Find the AWSCURRENT version (in-use) and AWSPREVIOUS version (previous)
        current_version = None
        previous_version = None
        
        for version_id, stages in version_ids.items():
            if 'AWSCURRENT' in stages:
                current_version = version_id
            elif 'AWSPREVIOUS' in stages:
                previous_version = version_id
        
        # If rotation just failed, AWSCURRENT still has the old password
        # We'll attempt a manual retry of the rotation process
        # Or, we could restore to AWSPREVIOUS if needed
        
        if previous_version:
            print(f"Falling back to previous version: {previous_version}")
            
            # Promote previous version back to current
            secrets_client.put_secret_value(
                SecretId=secret_arn,
                ClientRequestToken=previous_version
            )
            
            # Notify ops team of the fallback
            sns_client.publish(
                TopicArn='arn:aws:sns:us-east-1:123456789012:rotation-remediation',
                Subject='Automatic Fallback Applied to Secret',
                Message=f'Secret {secret_arn} has fallen back to previous version. Manual rotation required.'
            )
        
        return {
            'statusCode': 200,
            'body': json.dumps('Remediation completed')
        }
    
    except Exception as e:
        print(f"Remediation failed: {str(e)}")
        
        # If remediation itself fails, notify ops immediately
        sns_client.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:rotation-remediation',
            Subject='Critical: Rotation Remediation Failed',
            Message=f'Failed to remediate rotation failure for {secret_arn}: {str(e)}'
        )
        
        raise
```

This function does several important things. It extracts the secret ARN from the event, examines the version history to find the previous successful version, and can attempt to restore it if the rotation went sideways. Critically, it also notifies the ops team of what it did, so there's a record of the automatic action taken.

In a real-world setup, you might enhance this further. Rather than immediately falling back, you could attempt to retry the rotation a few times with exponential backoff. You could check whether dependent services are still functioning with the old credentials before deciding to fall back. You could even integrate with your infrastructure-as-code system to trigger a full secret regeneration.

The key insight is this: your code now has the opportunity to respond intelligently to failure, not as a manual afterthought but as an automated part of the rotation workflow.

### Audit Logging with SQS

While SNS handles immediate notifications and Lambda handles remediation, you also need to maintain a durable audit trail of rotation events for compliance and debugging. SQS (Simple Queue Service) is perfect for this, as it decouples the event source from the audit consumer and guarantees that no event is lost.

When you add an SQS queue as a target for your EventBridge rule, every rotation event—successful or failed—is durably placed on the queue. A separate consumer process can read from this queue at its own pace, validate the event structure, and persist it to your audit database or logging system.

Here's how you'd set this up. First, create an SQS queue:

```bash
aws sqs create-queue --queue-name secret-rotation-audit
```

Then add it as a target to your EventBridge rule:

```bash
aws events put-targets \
  --rule rotation-event-rule \
  --targets "Id"="2","Arn"="arn:aws:sqs:us-east-1:123456789012:secret-rotation-audit"
```

EventBridge now sends a copy of every matching event to this queue. The queue acts as a buffer, allowing the audit system to fall behind during peak times without losing data. If your audit consumer crashes, messages remain on the queue until it comes back online.

A simple consumer might look like this:

```python
import boto3
import json
from datetime import datetime

sqs_client = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')

table = dynamodb.Table('RotationAuditLog')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/secret-rotation-audit'

def process_audit_events():
    while True:
        response = sqs_client.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=20
        )
        
        messages = response.get('Messages', [])
        
        for message in messages:
            body = json.loads(message['Body'])
            
            # Extract relevant details
            event_name = body['detail']['eventName']
            secret_arn = body['detail']['requestParameters']['secretId']
            timestamp = body['detail']['eventTime']
            
            # Write to audit log
            table.put_item(
                Item={
                    'secret_arn': secret_arn,
                    'event_type': event_name,
                    'timestamp': timestamp,
                    'full_event': json.dumps(body),
                    'recorded_at': datetime.utcnow().isoformat()
                }
            )
            
            # Delete from queue only after successful processing
            sqs_client.delete_message(
                QueueUrl=queue_url,
                ReceiptHandle=message['ReceiptHandle']
            )

# Run this as a long-lived container or Lambda (periodic invocation)
process_audit_events()
```

This consumer is simple but robust. It reads messages in batches, writes each event to a DynamoDB table for long-term storage and querying, and only deletes the message after successful processing. If the consumer crashes mid-write, the message remains on the queue and will be processed again. This guarantees no audit events are lost.

Over time, this audit table becomes an invaluable resource for debugging mysterious credential issues, proving compliance to auditors, and understanding patterns in rotation failures.

### A Complete Example: The Automated Remediation Workflow

Let's tie everything together with a concrete end-to-end scenario. Suppose your application uses an RDS database with automatically rotated credentials. Your requirements are: detect rotation failures immediately, attempt automatic remediation, and maintain an audit trail.

Your EventBridge infrastructure looks like this:

First rule: capture all rotation failures and route them through a multi-target approach.

```json
{
  "Name": "rds-rotation-failure-handler",
  "EventPattern": {
    "source": ["aws.secretsmanager"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "eventSource": ["secretsmanager.amazonaws.com"],
      "eventName": ["RotationFailed"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:rotation-remediation-handler",
      "Id": "1",
      "RoleArn": "arn:aws:iam::123456789012:role/eventbridge-invoke-lambda-role"
    },
    {
      "Arn": "arn:aws:sns:us-east-1:123456789012:rotation-failures",
      "Id": "2"
    },
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:rotation-audit",
      "Id": "3"
    }
  ]
}
```

When a rotation failure occurs, EventBridge simultaneously:

1. Invokes the Lambda remediation handler, which attempts to restore the previous credentials and restart dependent services
2. Publishes to SNS, notifying ops that something has happened (either the remediation worked or it needs manual attention)
3. Places a message on the audit SQS queue for logging

The Lambda function does the heavy lifting. It checks whether the application is still running with the old credentials, and if so, it restarts the service containers or instances so they pick up the restored password. Here's a more complete version:

```python
import boto3
import json
import time

secrets_client = boto3.client('secretsmanager')
sns_client = boto3.client('sns')
ssm_client = boto3.client('ssm')

def lambda_handler(event, context):
    secret_arn = event['detail']['requestParameters']['secretId']
    rotation_id = event['detail']['requestParameters']['rotationId']
    
    print(f"Handling rotation failure for {secret_arn}, rotation ID: {rotation_id}")
    
    try:
        # Retrieve secret details
        secret_response = secrets_client.describe_secret(SecretId=secret_arn)
        
        # Find the previous version
        version_ids = secret_response['VersionIdsToStages']
        previous_version = None
        current_version = None
        
        for version_id, stages in version_ids.items():
            if 'AWSCURRENT' in stages:
                current_version = version_id
            elif 'AWSPREVIOUS' in stages:
                previous_version = version_id
        
        print(f"Current version: {current_version}, Previous version: {previous_version}")
        
        # Attempt to restore the previous version
        if previous_version:
            secrets_client.put_secret_value(
                SecretId=secret_arn,
                ClientRequestToken=previous_version
            )
            print(f"Restored previous version: {previous_version}")
        
        # Restart dependent services via SSM Document
        # This assumes you have an SSM document that restarts your app
        try:
            ssm_client.start_automation_execution(
                DocumentName='RestartApplicationWithRotatedCredentials',
                Parameters={
                    'SecretArn': [secret_arn],
                    'RestartMode': ['graceful']
                }
            )
            remediation_status = "SUCCESS: Services restarted with restored credentials"
        except Exception as e:
            remediation_status = f"PARTIAL: Credentials restored but service restart failed: {str(e)}"
        
        # Notify ops
        sns_client.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:rotation-remediation',
            Subject='Secret Rotation Remediation Completed',
            Message=f"""
Secret: {secret_arn}
Rotation ID: {rotation_id}
Status: {remediation_status}

Automatic remediation has been applied. Please verify that your application is functioning normally.
If issues persist, consult the rotation audit logs for further details.
            """
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'status': 'remediation_attempted',
                'secret_arn': secret_arn,
                'details': remediation_status
            })
        }
    
    except Exception as e:
        print(f"Critical error during remediation: {str(e)}")
        
        # If we can't remediate, escalate
        sns_client.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:rotation-critical',
            Subject='CRITICAL: Secret Rotation Remediation Failed',
            Message=f"""
Automatic remediation failed for secret: {secret_arn}
Rotation ID: {rotation_id}

Error: {str(e)}

MANUAL INTERVENTION REQUIRED. Immediate action by ops team is necessary.
            """
        )
        
        raise

```

Separately, you might also have a second rule that captures successful rotations for audit purposes:

```json
{
  "Name": "rds-rotation-success-handler",
  "EventPattern": {
    "source": ["aws.secretsmanager"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "eventSource": ["secretsmanager.amazonaws.com"],
      "eventName": ["RotationSucceeded"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:rotation-audit",
      "Id": "1"
    }
  ]
}
```

Successful rotations don't need immediate remediation, but they absolutely belong in the audit trail. This rule ensures they're logged.

Now, when a rotation fails, here's what happens in real time:

1. **Immediate notification**: SNS fires and emails/Slacks the ops team that something happened
2. **Automatic mitigation**: Lambda springs into action, checking the secret version history and potentially restoring the previous version
3. **Service recovery**: If credentials were restored, the application restarts gracefully and picks up the old working credentials
4. **Audit trail**: The entire event is captured in SQS and eventually written to the audit database
5. **Follow-up notification**: The ops team receives a follow-up message indicating whether remediation was successful or if manual action is needed

All of this happens in the span of a few seconds. The ops team goes from zero visibility to full situation awareness, and the system has already attempted self-healing.

### Key Considerations for Production Deployments

While the patterns above are solid, real-world deployments require careful thought about a few additional concerns.

First, consider IAM permissions carefully. Your EventBridge rule needs permission to invoke Lambda functions, publish to SNS, and write to SQS. Your Lambda function needs permission to read from Secrets Manager, invoke SSM, and write back to SNS. These permissions should follow the principle of least privilege—grant only what's necessary, not blanket access. CloudFormation and Terraform can help you define these precisely.

Second, think about idempotency. If EventBridge retries a failed Lambda invocation, your function might run twice. If you're restarting services or updating secrets, make sure multiple invocations don't cause unexpected behavior. Using unique identifiers (like the rotation ID) to track operations can help.

Third, set appropriate SQS message retention and visibility timeouts. By default, messages stay on an SQS queue for 4 days, which is usually fine for audit events. But if your audit consumer goes down for a week, you'll lose events. Consider a longer retention period for critical audit trails.

Fourth, implement DLQ (dead letter queue) handling. If a message consistently fails to process (malformed JSON, service unavailable), you don't want it blocking the rest of the queue. SQS supports DLQs, which catch problematic messages and let you investigate them separately.

Finally, test your failure scenarios. Create a test secret, deliberately break its rotation function, and verify that your entire pipeline works end-to-end. Does the Lambda actually run? Does SNS deliver notifications? Does SQS capture events? It's far better to find gaps in your incident response during a controlled test than during an actual production incident.

### The Bigger Picture: Event-Driven Security

What we've built here is more than just a notification system—it's an event-driven security and operational workflow. By treating secret rotation events as first-class citizens in your architecture, you're creating a system that's observable, automated, and resilient.

This pattern extends beyond secret rotation. EventBridge rules can respond to EC2 state changes, RDS failovers, Lambda errors, or any other AWS event. The same principles apply: capture the event, route it to appropriate targets, and trigger automated responses. Over time, you build a self-healing infrastructure where common failure modes are detected and remediated before they affect users.

The key is recognizing that events are data, and data enables action. By instrumenting your systems to emit events and building rules to respond to them, you're moving from a reactive, manual operational model to a proactive, automated one.

### Conclusion

Secret rotation is a critical security practice, but it only works if you can detect and respond to failures. AWS Secrets Manager publishes rotation events, and EventBridge makes it trivial to build sophisticated responses to those events. A few carefully crafted rules can connect rotation failures to SNS notifications, Lambda remediation, and SQS audit logging, creating a system where failures trigger automatic recovery attempts before ops teams even need to get involved.

The architecture is elegant because each piece has a single responsibility. Secrets Manager manages credentials. EventBridge routes events. Lambda orchestrates recovery. SNS notifies humans. SQS preserves audit history. By combining these services through event-driven patterns, you build a rotation system that's transparent, resilient, and aligned with how modern applications should operate.

Start by implementing the basics: EventBridge rules to capture rotation failures, an SNS topic for notifications, and an SQS queue for auditing. From there, layer in Lambda-based remediation to handle your specific failure scenarios. Test thoroughly, monitor the whole pipeline, and over time you'll develop a system you can trust to keep your secrets fresh and your applications running.
