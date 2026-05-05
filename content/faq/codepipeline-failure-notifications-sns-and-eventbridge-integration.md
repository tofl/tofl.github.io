---
title: "CodePipeline Failure Notifications: SNS and EventBridge Integration"
---

## CodePipeline Failure Notifications: SNS and EventBridge Integration

Imagine you're in the middle of a busy week when a critical production deployment fails silently. By the time your team discovers the problem hours later, customers have already noticed the issue. This scenario happens more often than we'd like to admit, and it usually points to one problem: your CI/CD pipeline isn't properly wired to alert you when things go wrong.

AWS CodePipeline orchestrates your entire deployment workflow, but it's only truly useful when failures reach the right people at the right time. This article explores how to build a robust notification and response system around CodePipeline events, ensuring that failures don't catch you off guard. We'll cover SNS notifications for straightforward alerting, EventBridge for sophisticated event-driven automation, and practical patterns for automated remediation and team coordination.

### Understanding CodePipeline Event Flow

CodePipeline emits events throughout the lifecycle of a pipeline execution. When a pipeline starts, when a stage succeeds or fails, when it requires manual approval—each of these moments generates an event that AWS can capture and act upon. These events flow through AWS's event infrastructure and can be consumed by various services depending on what action you want to take.

The challenge most teams face isn't understanding that these events exist—it's knowing how to capture them and route them appropriately. A failed deployment to production needs immediate attention from senior engineers. A failed test in a feature branch might just need a notification posted to a development Slack channel. The same event should potentially trigger multiple downstream actions: alerting humans, automatically rolling back to a previous version, and logging the incident for later analysis.

This is where SNS and EventBridge come into play. SNS provides simple, direct notifications via email, SMS, and other protocols. EventBridge gives you sophisticated routing rules that can fan out to multiple targets and even trigger complex workflows. Understanding when to use each service, and how they work together, separates teams that react to failures from teams that prevent their impact altogether.

### SNS Notifications on Pipeline State Changes

The simplest way to get alerted about CodePipeline events is through Amazon SNS. SNS acts as a notification hub, receiving messages and distributing them to subscribers. For CodePipeline, you can configure SNS to receive notifications whenever your pipeline state changes.

Start by creating an SNS topic dedicated to your pipeline notifications. This keeps things organized and makes permissions easier to manage:

```bash
aws sns create-topic --name codepipeline-notifications
```

Next, you need to give CodePipeline permission to publish to this topic. Create an IAM policy that allows the CodePipeline service to put messages on your SNS topic:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:codepipeline-notifications"
    }
  ]
}
```

Now, within your CodePipeline configuration, you specify SNS as a notification service. The pipeline will automatically publish state change notifications to your topic. Subscribe to the topic with email, Slack, PagerDuty, or other services depending on your team's workflow.

The beauty of SNS for CodePipeline notifications is its simplicity. Every state change—regardless of whether it's a success or failure—gets sent to subscribers. You can filter based on notification metadata, but SNS itself doesn't provide sophisticated routing. If you want different notifications to go to different people based on the pipeline stage or failure reason, you'll need to either maintain multiple SNS topics or layer in additional logic downstream.

SNS notifications work well for smaller teams or pipelines with consistent response patterns. They're also excellent as a baseline alert mechanism. However, most organizations eventually find themselves wanting more sophisticated behavior.

### EventBridge: Sophisticated Event Routing and Automation

EventBridge is AWS's event bus service, and it's where modern event-driven architectures come to life. Unlike SNS's simple publish-subscribe model, EventBridge lets you write rules that match event patterns and route them to multiple targets with conditional logic.

When CodePipeline emits an event, EventBridge receives it if you've configured the integration. The event arrives in JSON format with detailed information about what happened: the pipeline name, execution ID, stage, action, and success or failure status. You then write rules that match specific patterns in those events and specify what should happen when they match.

Setting up CodePipeline integration with EventBridge is straightforward. CodePipeline automatically sends events to the default EventBridge event bus in your AWS account. You don't need to configure anything on the CodePipeline side—the events just flow. Your job is to create rules that capture and act on those events.

Let's say you want to be notified whenever any pipeline fails. You'd create an EventBridge rule with a pattern that matches pipeline execution state changes where the state is "FAILED":

```json
{
  "source": ["aws.codepipeline"],
  "detail-type": ["CodePipeline Pipeline Execution State Change"],
  "detail": {
    "state": ["FAILED"]
  }
}
```

This pattern matches any CodePipeline failure across all pipelines in your account. You could make it more specific by adding the pipeline name:

```json
{
  "source": ["aws.codepipeline"],
  "detail-type": ["CodePipeline Pipeline Execution State Change"],
  "detail": {
    "pipeline": ["my-production-pipeline"],
    "state": ["FAILED"]
  }
}
```

Now, what should happen when this rule matches? You specify targets. A single rule can have multiple targets, and they all execute when the event matches. You might send the event to an SNS topic for email notification, trigger a Lambda function for automatic remediation, post to SQS for incident queue processing, or all three simultaneously.

### The JSON Event Structure from CodePipeline

Understanding the actual event structure is crucial because you'll reference these fields in your rules and in any downstream processing code. When CodePipeline sends an event to EventBridge, it looks roughly like this:

```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "detail-type": "CodePipeline Pipeline Execution State Change",
  "source": "aws.codepipeline",
  "account": "123456789012",
  "time": "2024-01-15T14:30:45Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "pipeline": "my-app-pipeline",
    "execution-id": "abcdef01-2345-6789-abcd-ef0123456789",
    "state": "FAILED",
    "version": 5
  }
}
```

When a stage fails, the event structure changes slightly to provide stage and action details:

```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "detail-type": "CodePipeline Stage Execution State Change",
  "source": "aws.codepipeline",
  "account": "123456789012",
  "time": "2024-01-15T14:30:45Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "pipeline": "my-app-pipeline",
    "execution-id": "abcdef01-2345-6789-abcd-ef0123456789",
    "stage": "Deploy",
    "state": "FAILED"
  }
}
```

These events tell you everything you need to know: which pipeline failed, when it failed, what stage failed, and a unique execution ID you can use to investigate further in the CodePipeline console. This structure is consistent and reliable, making it easy to pattern-match and build automation around.

### Triggering Lambda for Automatic Remediation

One of the most powerful patterns is using EventBridge to trigger a Lambda function when a pipeline fails. The Lambda function can then perform automatic remediation, investigation, or coordination tasks.

Imagine your deployment pipeline fails due to a temporary service availability issue. An intelligent Lambda function could automatically roll back to the previous version, run smoke tests, and notify the team. Or perhaps the failure is in your integration tests—the Lambda could run additional diagnostics, collect logs, and post a detailed incident report to Slack.

Here's a practical example. You configure an EventBridge rule that triggers a Lambda function on pipeline failures:

```json
{
  "Name": "codepipeline-failure-remediation",
  "EventPattern": {
    "source": ["aws.codepipeline"],
    "detail-type": ["CodePipeline Pipeline Execution State Change"],
    "detail": {
      "pipeline": ["my-production-pipeline"],
      "state": ["FAILED"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:handle-pipeline-failure",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeInvokeLambdaRole"
    }
  ]
}
```

Your Lambda function receives the event and can take action. Here's what that function might look like in Python:

```python
import json
import boto3
import logging

codepipeline = boto3.client('codepipeline')
sns = boto3.client('sns')

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    detail = event['detail']
    pipeline_name = detail['pipeline']
    execution_id = detail['execution-id']
    
    logger.info(f"Pipeline {pipeline_name} failed with execution {execution_id}")
    
    # Get pipeline execution details to understand why it failed
    try:
        response = codepipeline.get_pipeline_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id
        )
        
        execution = response['pipelineExecution']
        status = execution['status']
        
        logger.info(f"Execution status: {status}")
        
        # Attempt automatic remediation based on failure type
        # This could involve rolling back, restarting, or escalating
        
        # For now, notify the on-call engineer with detailed info
        message = f"""
        Pipeline Failure Alert
        
        Pipeline: {pipeline_name}
        Execution ID: {execution_id}
        Status: {status}
        Time: {execution['created']}
        
        Check the CodePipeline console for details:
        https://console.aws.amazon.com/codesuite/codepipeline/
        """
        
        sns.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:on-call-alerts',
            Subject=f'CodePipeline Failure: {pipeline_name}',
            Message=message
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps('Remediation initiated')
        }
        
    except Exception as e:
        logger.error(f"Error handling pipeline failure: {str(e)}")
        raise
```

This pattern gives you programmatic control over your response. You can call other AWS services, integrate with external systems, or implement complex decision logic. The key advantage over static SNS notifications is that you can make intelligent decisions based on the specific failure context.

### Slack Notifications for Team Coordination

Getting alerts via email works, but many teams prefer their notifications integrated into Slack where conversations about incidents naturally happen. EventBridge makes this straightforward by triggering an SNS topic that's subscribed by a Slack integration, or by invoking a Lambda function that directly posts to Slack.

The Lambda approach is more flexible. You can craft nicely formatted Slack messages with context, action buttons, and intelligent routing based on the failure type. Here's how you might structure this:

```python
import json
import boto3
import urllib3

slack_webhook = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
http = urllib3.PoolManager()

def lambda_handler(event, context):
    detail = event['detail']
    pipeline_name = detail['pipeline']
    execution_id = detail['execution-id']
    state = detail['state']
    
    if state == 'FAILED':
        color = 'danger'
        status_emoji = ':x:'
    elif state == 'SUCCEEDED':
        color = 'good'
        status_emoji = ':white_check_mark:'
    else:
        color = '#808080'
        status_emoji = ':hourglass:'
    
    slack_message = {
        'attachments': [
            {
                'color': color,
                'title': f'{status_emoji} {pipeline_name}',
                'text': f'Pipeline execution {state}',
                'fields': [
                    {
                        'title': 'Execution ID',
                        'value': execution_id,
                        'short': True
                    },
                    {
                        'title': 'Status',
                        'value': state,
                        'short': True
                    },
                    {
                        'title': 'Time',
                        'value': event['time'],
                        'short': False
                    }
                ],
                'actions': [
                    {
                        'type': 'button',
                        'text': 'View in Console',
                        'url': f'https://console.aws.amazon.com/codesuite/codepipeline/pipelines/{pipeline_name}/view'
                    }
                ]
            }
        ]
    }
    
    encoded_msg = json.dumps(slack_message).encode('utf-8')
    resp = http.request('POST', slack_webhook, body=encoded_msg)
    
    return {
        'statusCode': 200,
        'body': 'Message sent'
    }
```

By triggering this Lambda from EventBridge whenever a pipeline state changes, your Slack channel becomes an incident coordination hub. Team members see failures in context with production work and can immediately jump into investigation or response.

### SQS for Incident Response Queueing

Some organizations have formal incident response processes. When a critical pipeline fails, an incident should be created in your ticketing system, added to an incident queue, or logged for later analysis. EventBridge can route pipeline failure events to an SQS queue, where downstream processes consume them and take action.

Configure an EventBridge rule to send pipeline failures to an SQS queue:

```json
{
  "Name": "codepipeline-failure-to-sqs",
  "EventPattern": {
    "source": ["aws.codepipeline"],
    "detail-type": ["CodePipeline Pipeline Execution State Change"],
    "detail": {
      "state": ["FAILED"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:pipeline-failures",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeSendToSQSRole"
    }
  ]
}
```

Now pipeline failure events land in an SQS queue where a worker process picks them up. The worker might create a ticket in Jira, log the incident to a centralized system, or trigger your runbook automation platform. This decouples the immediate notification from the longer-term incident management process.

SQS also provides durability. If your incident response service is temporarily down, events queue up and get processed when the service comes back. SNS doesn't offer this guarantee—messages are delivered immediately or lost.

### Combining Multiple Targets for Layered Responses

The real power emerges when you combine these services in a layered response strategy. A single EventBridge rule can have multiple targets, each handling a different aspect of the response.

For a production pipeline failure, you might:

1. Send the event to Lambda for automatic remediation attempts
2. Send the event to an SNS topic for email to the ops team
3. Send the event to another Lambda that posts the failure to Slack
4. Send the event to SQS for incident tracking

This happens simultaneously. The moment a pipeline fails, all these channels activate in parallel. The on-call engineer gets a Slack message instantly, an incident gets queued for formal tracking, and automated recovery processes start running. All from a single CodePipeline event.

Here's what this looks like in practice when creating the rule:

```json
{
  "Name": "production-pipeline-failure",
  "EventPattern": {
    "source": ["aws.codepipeline"],
    "detail-type": ["CodePipeline Pipeline Execution State Change"],
    "detail": {
      "pipeline": ["production-app-pipeline"],
      "state": ["FAILED"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:remediate-pipeline-failure",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeInvokeLambdaRole"
    },
    {
      "Arn": "arn:aws:sns:us-east-1:123456789012:ops-alerts",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgePublishToSNSRole"
    },
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:post-to-slack",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeInvokeLambdaRole"
    },
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:incident-queue",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeSendToSQSRole"
    }
  ]
}
```

This creates a comprehensive safety net. No matter how an engineer is monitoring (email, Slack, ticket system), they'll see the failure. Automated recovery has a chance to fix it. And your incident tracking system has a record.

### Handling Stage-Level Failures for Better Granularity

CodePipeline emits events not just at the pipeline level but also at the stage and action levels. This gives you an opportunity to respond to failures at different levels of detail.

A stage failure event includes which stage failed, allowing you to route based on severity or type:

```json
{
  "source": ["aws.codepipeline"],
  "detail-type": ["CodePipeline Stage Execution State Change"],
  "detail": {
    "pipeline": ["my-production-pipeline"],
    "stage": ["Deploy-Production"],
    "state": ["FAILED"]
  }
}
```

You might have different response rules for different stages. A failure in testing gets logged and the developer is notified. A failure in production deployment triggers immediate escalation, rollback attempts, and customer communication. Same event infrastructure, but dramatically different responses based on context.

### Permission Patterns for Event-Driven Automation

As you build out this event-driven architecture, permissions become critical. Each service that participates needs appropriate IAM permissions. EventBridge needs permission to invoke Lambda, publish to SNS, and send to SQS. Lambda needs permission to call CodePipeline APIs to get execution details. Slack posting Lambda needs permission to make HTTP requests (or more precisely, doesn't need IAM permission since HTTP calls don't require AWS credentials).

A common pattern is creating a role per EventBridge target type. The "EventBridgeInvokeLambdaRole" role has permission only to invoke Lambda functions. The "EventBridgePublishToSNSRole" has permission only to publish to SNS topics. This follows the principle of least privilege and makes it easy to audit what each integration can do.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:handle-*"
    }
  ]
}
```

For Lambda functions that call CodePipeline APIs, they need explicit permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codepipeline:GetPipelineExecution",
        "codepipeline:GetPipeline",
        "codepipeline:PutJobSuccessResult",
        "codepipeline:PutJobFailureResult"
      ],
      "Resource": "*"
    }
  ]
}
```

### Testing Your Event-Driven Pipeline

Before relying on these notifications for production incidents, you should test them. The EventBridge console provides a "Send events" feature that lets you inject test events matching your rule patterns. This simulates what happens when a real pipeline fails without needing to break anything.

Alternatively, you can manually trigger a pipeline failure in a non-critical environment and watch your notification system respond. Does the Slack message appear? Did the remediation Lambda execute? Did the incident ticket get created? This validation is crucial before you depend on these systems for production.

### Best Practices for Pipeline Failure Automation

Structure your remediation carefully. Automatic rollback might seem good in theory but could hide underlying problems that need investigation. Consider making automated responses advisory rather than definitive: have Lambda automatically initiate a rollback but require manual confirmation. Or have it restore service from backup but trigger a post-incident review.

Keep notifications consistent in format so they're easy to scan. Include links directly to the CodePipeline console and execution details. Make it easy for the person receiving the alert to understand context without clicking through multiple systems.

Monitor your notification system itself. If your Lambda for posting to Slack fails, does anyone know? Set up CloudWatch alarms on Lambda error rates and EventBridge rule matches to ensure your safety net is actually working.

Rate-limit if necessary. If a pipeline fails repeatedly, you don't want to overwhelm your team with thousands of notifications. Consider batching notifications or implementing a circuit breaker that silences notifications after a certain threshold.

### Conclusion

CodePipeline failures are inevitable in any deployment system complex enough to matter. What separates teams that handle them gracefully from teams that scramble is having a deliberate notification and response architecture in place before something breaks.

SNS provides straightforward notification distribution to email, SMS, and webhooks. EventBridge enables sophisticated routing rules that can fan pipeline events to multiple targets simultaneously, each handling a different aspect of your response. Together, they form the backbone of a system where failures don't surprise you—they trigger coordinated, automated responses that inform the right people, attempt intelligent recovery, and maintain detailed records for later analysis.

By combining Lambda for remediation, Slack for team coordination, and SQS for incident management, you build a comprehensive failure response system. The JSON event structure CodePipeline provides gives you all the context you need to make intelligent routing decisions. Test these systems in non-production environments, start simple, and gradually layer in more sophisticated automation as you gain confidence.

The investment in wiring up these notifications and automations pays dividends every single time a deployment fails. And in any non-trivial system, they will fail. The question isn't whether your pipeline will break, but whether you'll know about it and be able to respond before customers do.
