---
title: "Handling Task Token Callbacks in Step Functions for Human Approval Workflows"
---

## Handling Task Token Callbacks in Step Functions for Human Approval Workflows

Building serverless workflows often means waiting for something outside your automation to happen—a manager approving a request, an external API responding to a webhook, or a human reviewing data before proceeding. AWS Step Functions offers an elegant solution through task tokens and callback patterns that lets your workflow pause indefinitely, pass control to an external actor, and resume when that actor signals completion. This mechanism is powerful, but it requires careful setup to avoid pitfalls like indefinite hangs or security gaps. Let's explore how to implement human approval workflows using task token callbacks.

### Understanding Task Tokens and the Callback Pattern

Step Functions normally orchestrate AWS services and Lambda functions synchronously—you invoke a service, wait for it to complete, and move on. But what if the next step requires a human decision or an external system that can't respond immediately? That's where task tokens come in.

A task token is a unique identifier that Step Functions generates and passes to an external actor. Rather than blocking forever, your workflow pauses at a callback state, holding the token in memory. The external actor—whether a person clicking an approval link, an API gateway endpoint, or a third-party service—uses that token to tell Step Functions whether the task succeeded or failed. When Step Functions receives the callback with the correct token, it resumes the workflow from that point.

Think of it like ordering food at a restaurant. You give the cashier your order (the token), receive a number, and go sit down (the workflow pauses). When your number is called (the callback arrives with your number and status), you collect your food and continue (the workflow resumes).

This pattern decouples your workflow from external processes. No polling, no timeout-driven retries, no guessing how long to wait. The workflow sleeps until explicitly awakened by the callback.

### Setting Up a Callback State in Step Functions

To enable the callback pattern, you'll use a `Task` state with the `Resource` set to a special callback ARN or service integration. Here's the foundational syntax using the `waitForTaskToken` integration pattern:

```json
{
  "ApprovalTask": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Parameters": {
      "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/approval-queue",
      "MessageBody": {
        "taskToken.$": "$$.Task.Token",
        "approvalRequest.$": "$.requestData",
        "approvalDeadline.$": "$$.State.EnteredTime"
      }
    },
    "Next": "ProcessApprovedRequest"
  }
}
```

Notice the critical parameter: `"taskToken.$": "$$.Task.Token"`. This context object path retrieves the unique token for this specific task execution. Step Functions generates it automatically and injects it into the execution context under the `$$.Task.Token` path. You extract it and pass it along to the external actor.

The `waitForTaskToken` suffix tells Step Functions not to mark this task complete until a callback arrives. Without it, the task would complete immediately and the workflow would move forward before any external action occurred.

### Generating and Passing Tokens to External Actors

Let's walk through a practical scenario: an e-commerce order requires manager approval before processing. Your workflow needs to send an approval request to a manager via email and wait for their decision.

First, your Step Functions state machine would look something like this:

```json
{
  "SendApprovalEmail": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
    "Parameters": {
      "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:SendApprovalEmail",
      "Payload": {
        "orderId.$": "$.orderId",
        "orderTotal.$": "$.orderTotal",
        "managerEmail.$": "$.managerEmail",
        "taskToken.$": "$$.Task.Token",
        "taskTokenExpiration.$": "$$.State.EnteredTime"
      }
    },
    "TimeoutSeconds": 86400,
    "Next": "CheckApprovalResult"
  }
}
```

The Lambda function that sends the email receives the token and includes it in the approval link. Here's a simplified version:

```python
import json
import boto3
import urllib.parse
from datetime import datetime, timedelta

ses_client = boto3.client('ses')

def lambda_handler(event, context):
    order_id = event['orderId']
    order_total = event['orderTotal']
    manager_email = event['managerEmail']
    task_token = event['taskToken']
    
    # Construct approval/rejection links
    approval_url = f"https://your-api-gateway.execute-api.us-east-1.amazonaws.com/approve?token={urllib.parse.quote(task_token)}&orderId={order_id}"
    rejection_url = f"https://your-api-gateway.execute-api.us-east-1.amazonaws.com/reject?token={urllib.parse.quote(task_token)}&orderId={order_id}"
    
    email_body = f"""
    New order requiring approval:
    Order ID: {order_id}
    Total: ${order_total}
    
    Approve: {approval_url}
    Reject: {rejection_url}
    
    Decision required within 24 hours.
    """
    
    try:
        ses_client.send_email(
            Source='noreply@company.com',
            Destination={'ToAddresses': [manager_email]},
            Message={
                'Subject': {'Data': f'Order Approval Required: {order_id}'},
                'Body': {'Html': {'Data': email_body}}
            }
        )
        return {'statusCode': 200, 'message': 'Email sent'}
    except Exception as e:
        return {'statusCode': 500, 'error': str(e)}
```

The token travels with the approval link. When the manager clicks approve or reject, their choice is submitted along with the token, which allows Step Functions to match the callback to the correct execution.

### Handling Callbacks with SendTaskSuccess and SendTaskFailure

When the external actor makes a decision, they invoke the Step Functions API with the token. This is typically handled by an API Gateway endpoint that triggers a Lambda function to call either `SendTaskSuccess` or `SendTaskFailure`.

Here's a Lambda function that processes the manager's approval decision:

```python
import json
import boto3

stepfunctions_client = boto3.client('stepfunctions')

def lambda_handler(event, context):
    # Token comes from query parameters or request body
    task_token = event.get('queryStringParameters', {}).get('token')
    decision = event.get('queryStringParameters', {}).get('decision')  # 'approve' or 'reject'
    order_id = event.get('queryStringParameters', {}).get('orderId')
    
    if not task_token:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Missing task token'})
        }
    
    try:
        if decision == 'approve':
            response = stepfunctions_client.send_task_success(
                taskToken=task_token,
                output=json.dumps({
                    'approved': True,
                    'orderId': order_id,
                    'approvalTimestamp': '2024-01-15T10:30:00Z'
                })
            )
            message = f"Order {order_id} approved successfully"
        else:
            response = stepfunctions_client.send_task_failure(
                taskToken=task_token,
                error='ApprovalDenied',
                cause=f'Manager rejected order {order_id}'
            )
            message = f"Order {order_id} rejected"
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': message})
        }
    
    except stepfunctions_client.exceptions.InvalidToken:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid or expired token'})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
```

When `SendTaskSuccess` is called with the correct token, Step Functions resumes the workflow and passes the output data into the next state. The output becomes the input to the downstream `CheckApprovalResult` state in your workflow definition.

If `SendTaskFailure` is called, the workflow transitions to an error handler or fallback state, depending on your state machine's error handling configuration. This allows you to elegantly handle rejections or timeouts.

### IAM Permissions for External Systems

Here's where security becomes crucial. The external system calling `SendTaskSuccess` or `SendTaskFailure` must have explicit IAM permissions. If you're using Lambda functions to handle callbacks, they need an execution role with the appropriate policy.

Here's a minimal IAM policy that grants only the necessary permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      "Resource": "arn:aws:states:us-east-1:123456789012:stateMachine:OrderApprovalWorkflow"
    }
  ]
}
```

This policy is deliberately narrow. It allows the principal to invoke `SendTaskSuccess` and `SendTaskFailure`, but only for a specific state machine. An even more restrictive approach would limit actions per resource type or execution, but Step Functions doesn't support fine-grained filtering on individual executions—the token itself serves as the execution-level authorization mechanism.

For human actors (like managers approving via email), you wouldn't grant them IAM permissions directly. Instead, your API Gateway and Lambda function hold the credentials and perform the `SendTaskSuccess` call on their behalf. The human's only responsibility is clicking the link and confirming their decision.

### Managing Timeouts and Heartbeats

One of the major pitfalls with callback patterns is indefinite hangs. If an external actor never sends a callback, the workflow will pause forever, consuming execution history and potentially incurring costs. To prevent this, always set a timeout.

The `TimeoutSeconds` parameter on your callback state specifies how long Step Functions will wait before terminating the task with a `States.TaskStateTimedOut` error:

```json
{
  "SendApprovalEmail": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
    "Parameters": {
      "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:SendApprovalEmail",
      "Payload": {
        "taskToken.$": "$$.Task.Token"
      }
    },
    "TimeoutSeconds": 86400,
    "Catch": [
      {
        "ErrorEquals": ["States.TaskStateTimedOut"],
        "Next": "ApprovalTimeout"
      }
    ],
    "Next": "CheckApprovalResult"
  }
}
```

In this example, if no callback arrives within 86400 seconds (24 hours), the task fails and transitions to the `ApprovalTimeout` state, where you might log the incident, notify administrators, or retry.

For longer-running workflows, you might implement a heartbeat mechanism. While Step Functions doesn't have built-in heartbeat support for callback tasks, you can simulate it by having the external actor periodically call `SendTaskHeartbeat` to signal that they're still working on the decision. However, this requires additional orchestration and isn't always necessary—a well-designed timeout is usually sufficient.

```python
import json
import boto3

stepfunctions_client = boto3.client('stepfunctions')

def send_heartbeat(task_token):
    """Optionally called periodically to keep the task alive during long processing"""
    try:
        stepfunctions_client.send_task_heartbeat(taskToken=task_token)
        print(f"Heartbeat sent for token")
    except Exception as e:
        print(f"Heartbeat failed: {e}")
```

### Handling Token Expiration and Security Concerns

Task tokens are long-lived unique identifiers, but they're not inherently secret. If a token is leaked or exposed, anyone with the token can call `SendTaskSuccess` or `SendTaskFailure` to manipulate the workflow. To mitigate this:

First, always transmit tokens over HTTPS. In the approval email example, the approval link should use HTTPS, ensuring the token isn't intercepted in transit.

Second, consider embedding the token in a signed URL or JWT that includes additional context like the manager's identity or order ID. This adds a layer of validation—the Lambda function can verify that the person clicking the link is the intended approver.

Third, implement request signing. API Gateway with AWS Signature V4 can authenticate requests from your internal systems, and you can add custom headers or checksums to detect tampering.

Here's an example using a signed token approach:

```python
import json
import hmac
import hashlib
import base64
from datetime import datetime, timedelta

def create_signed_token(task_token, manager_email, order_id, secret_key):
    """Create a tamper-proof token that includes context"""
    data = f"{task_token}:{manager_email}:{order_id}"
    signature = hmac.new(
        secret_key.encode(),
        data.encode(),
        hashlib.sha256
    ).digest()
    signed = base64.b64encode(signature).decode()
    return f"{data}:{signed}"

def verify_signed_token(signed_token, secret_key):
    """Verify the signature and extract components"""
    parts = signed_token.rsplit(':', 1)
    if len(parts) != 2:
        return None, None, None, False
    
    data, signature = parts
    expected_signature = base64.b64encode(
        hmac.new(secret_key.encode(), data.encode(), hashlib.sha256).digest()
    ).decode()
    
    if not hmac.compare_digest(signature, expected_signature):
        return None, None, None, False
    
    token_parts = data.split(':')
    if len(token_parts) != 3:
        return None, None, None, False
    
    return token_parts[0], token_parts[1], token_parts[2], True
```

### Integrating with Slack or Other Notification Channels

Beyond email, you might want to send approval requests to Slack, Microsoft Teams, or custom dashboards. The pattern remains the same: invoke the notification service, embed the token or a signed callback URL, and wait for the callback.

Here's a Lambda function that sends an interactive Slack message:

```python
import json
import boto3
import urllib.parse
from urllib.request import Request, urlopen

def lambda_handler(event, context):
    slack_webhook_url = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
    task_token = event['taskToken']
    order_id = event['orderId']
    order_total = event['orderTotal']
    
    # Construct callback URLs
    approval_url = f"https://your-api.example.com/approve?token={urllib.parse.quote(task_token)}"
    rejection_url = f"https://your-api.example.com/reject?token={urllib.parse.quote(task_token)}"
    
    slack_message = {
        "text": f"Order #{order_id} requires approval",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*New Order Approval Needed*\nOrder ID: {order_id}\nTotal: ${order_total}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Approve"},
                        "value": "approve",
                        "url": approval_url,
                        "style": "primary"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Reject"},
                        "value": "reject",
                        "url": rejection_url,
                        "style": "danger"
                    }
                ]
            }
        ]
    }
    
    try:
        req = Request(slack_webhook_url, data=json.dumps(slack_message).encode())
        req.add_header('Content-Type', 'application/json')
        urlopen(req)
        return {'statusCode': 200}
    except Exception as e:
        print(f"Error sending Slack message: {e}")
        return {'statusCode': 500, 'error': str(e)}
```

The Slack buttons in this example point to callback URLs that include the token. When clicked, they trigger the approval Lambda function, which calls `SendTaskSuccess` with the token.

### Common Pitfalls and How to Avoid Them

**Forgetting the timeout**: Without a timeout, failed actors leave your workflow suspended indefinitely. Always set `TimeoutSeconds` based on your business requirements—24 hours for manager approvals, a few minutes for automated systems.

**Losing the token**: Ensure the token is passed safely through all layers—from Step Functions to the notification system to the callback handler. If the token is lost or corrupted, the callback will fail. Log tokens securely (avoid logging full tokens in CloudWatch) and validate their format before using them.

**Insufficient permissions**: External systems must have IAM permissions to call `SendTaskSuccess` and `SendTaskFailure`. If permissions are missing, the callback will fail silently or with an access denied error. Test your permissions thoroughly in a development environment.

**Token leakage**: Treat tokens like secrets. Don't log them unnecessarily, don't pass them through untrusted channels, and use HTTPS everywhere. Consider short-lived signed tokens that include context for additional validation.

**No error handling for callbacks**: If the callback Lambda function itself fails (e.g., network error, invalid token), the workflow won't resume. Implement retry logic and error handling within your callback handler. Use try-catch blocks and CloudWatch alarms to monitor failures.

### Monitoring and Observability

Step Functions integrates with CloudWatch for monitoring. To track callback-based workflows effectively, enable execution history logging and set up CloudWatch alarms.

Check the execution history in the Step Functions console to see when tasks are waiting for callbacks and when callbacks arrive. The event details show the task token, the output passed by the callback, and the timestamp—invaluable for debugging.

Set up CloudWatch alarms for tasks that timeout repeatedly, which might indicate that your external actors aren't receiving notifications or aren't responding to them:

```python
cloudwatch_client = boto3.client('cloudwatch')

cloudwatch_client.put_metric_alarm(
    AlarmName='StepFunctions-ApprovalTimeout',
    MetricName='ExecutionsFailed',
    Namespace='AWS/States',
    Statistic='Sum',
    Period=3600,
    EvaluationPeriods=1,
    Threshold=5,
    ComparisonOperator='GreaterThanThreshold',
    Dimensions=[
        {'Name': 'StateMachineArn', 'Value': 'arn:aws:states:us-east-1:123456789012:stateMachine:OrderApprovalWorkflow'}
    ]
)
```

Additionally, instrument your callback handlers with custom metrics to track approval rates, callback response times, and error categories. This helps you understand workflow behavior and identify bottlenecks.

### Conclusion

Task token callbacks in Step Functions provide a clean, serverless-native way to build human approval workflows and integrate with external systems. By generating a unique token, passing it to an external actor, and resuming when a callback arrives, you decouple your workflow from synchronous dependencies and enable truly asynchronous orchestration.

The key to success is three-fold: secure token handling, proper timeout configuration to prevent indefinite hangs, and appropriate IAM permissions for external systems. When implemented carefully, callback patterns become a powerful tool for building flexible, resilient workflows that gracefully handle human decisions, external approvals, and long-running processes without blocking resources or compromising security.

Whether you're building order approval workflows, document review processes, or human-in-the-loop machine learning pipelines, mastering task tokens will expand your Step Functions capabilities and help you design workflows that truly work the way your business operates.
