---
title: "CodePipeline Manual Approval Actions: Email Notifications and Approval Workflows"
---

## CodePipeline Manual Approval Actions: Email Notifications and Approval Workflows

Automated deployment pipelines are powerful, but not every step should run without human intervention. Deploying to production, making infrastructure changes, or handling compliance-sensitive workflows often require a human to review, validate, and explicitly approve the next step. AWS CodePipeline's approval actions let you build this human gate directly into your pipeline, and when combined with SNS notifications, you get a robust workflow where approvers receive emails and can make decisions from wherever they are.

In this article, we'll explore how to configure manual approval actions in CodePipeline, understand how notifications flow to approvers, see what happens when a pipeline pauses waiting for approval, and cover the common patterns that teams use in production environments.

### Why Manual Approval Matters in Your Pipeline

Think of a CodePipeline as a series of stages, each building on the previous one. Source → Build → Deploy to Staging → Deploy to Production. Without checkpoints, a single commit could race all the way to production in minutes. That's fine for development and staging, but for production, you usually want someone to say "yes, this is ready" before that code touches real customer data.

Manual approval actions solve this problem elegantly. They're not blockers that slow down your team indefinitely—they're intentional gates that pause the pipeline and wait for a specific person (or group of people) to review and decide. The key advantage is that this decision can happen asynchronously: the pipeline waits, approvers get notified, and they can approve from their email client, the AWS console, or even a mobile device. Once approved, the pipeline resumes automatically.

### Anatomy of an Approval Action

An approval action in CodePipeline is a special action type that doesn't run any code or deploy anything. Instead, it creates a decision point. You configure who can approve it, optionally add comments or instructions, and then the action sits in a "waiting for approval" state until someone takes action.

When you add an approval action to a stage in CodePipeline, you specify an SNS topic as the notification channel. CodePipeline publishes a message to that topic whenever the pipeline reaches the approval action, which triggers SNS to send emails to anyone subscribed to that topic. This is the mechanism that notifies approvers—they receive an email with a direct link to the approval decision in the AWS console.

Let's walk through a concrete setup. Imagine you have a pipeline with three stages: Source, Build, and Deploy. You want to add a manual approval gate before the Deploy stage that goes to production. You'd add an "Approval" action to the end of your Build stage (or create a new stage just for approvals, which is a common pattern). In that approval action, you specify:

- A name for the approval action (e.g., "ApproveProductionDeployment")
- An SNS topic ARN where notifications will be sent
- Optional custom data or instructions that approvers will see

### Setting Up an Approval Action: Configuration Walkthrough

Let's get practical. You can configure an approval action either through the AWS console or via infrastructure-as-code tools like CloudFormation or CDK. Here's what the configuration looks like in CDK, which many teams prefer for reproducibility:

```python
from aws_cdk import (
    aws_codepipeline as codepipeline,
    aws_codepipeline_actions as actions,
    aws_sns as sns,
    core,
)

class PipelineStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        
        # Create an SNS topic for approval notifications
        approval_topic = sns.Topic(
            self, "ApprovalTopic",
            display_name="Pipeline Approval Notifications",
        )
        
        # Create the pipeline
        pipeline = codepipeline.Pipeline(
            self, "MyPipeline",
            pipeline_name="production-pipeline",
        )
        
        # ... add source and build stages ...
        
        # Add an approval stage
        approval_stage = pipeline.add_stage(stage_name="Approval")
        
        approval_stage.add_action(
            actions.ManualApprovalAction(
                action_name="ApproveProductionDeployment",
                additional_information="Please review the build artifacts and staging test results before approving production deployment.",
                notify_email_list=["devops-team@company.com"],
                external_entity_link="https://example.com/approval-checklist",  # Optional link to approval criteria
            )
        )
        
        # Add production deployment stage after approval
        deploy_stage = pipeline.add_stage(stage_name="DeployProduction")
        # ... add deployment actions ...
```

When you use the AWS console, the process is similarly straightforward. You create or edit a stage, add an action, select "Manual approval" as the action provider, and then configure the SNS topic. The console also lets you add custom data that will be displayed to approvers.

One crucial detail: you need an SNS topic that's already set up and has subscribers. The email addresses you specify in the approval action configuration aren't automatically subscribed—they're passed to SNS as part of the notification request. However, best practice is to create a specific SNS topic, manage subscriptions explicitly (so you have control over who gets notified), and then reference that topic ARN in your approval action.

### How Approvers Receive and Respond to Notifications

When your pipeline reaches an approval action, CodePipeline immediately publishes a message to the SNS topic you specified. SNS takes that message and sends emails to all subscribed addresses. Here's what an approver might see in their inbox:

The email from AWS SNS includes a message from CodePipeline with details about the pipeline run, the stage, the action name, and any custom information you included. Importantly, the email contains a link directly to the AWS console where the approval decision can be made. This link takes the approver to the CodePipeline detail view, where they can see the pipeline, the stage that's waiting for approval, and a button to either "Approve" or "Reject" the pipeline execution.

The approver can click the approval link in the email and, if they're logged into AWS (or are prompted to log in), they're taken straight to the approval decision panel. They can view the custom data you provided—perhaps a link to the staging test results, or instructions about what to check—and then make their decision.

Alternatively, they can navigate to CodePipeline in the AWS console manually, find the pipeline, and approve from the console UI. Both workflows are equally valid.

### What Happens When the Pipeline Pauses

Here's the key insight: when a pipeline reaches an approval action, the entire pipeline execution pauses. Any downstream stages don't run. If your Deploy to Production stage is configured to start automatically after the Approval stage, it won't start until the approval is granted.

From the pipeline's perspective, the execution is in a "waiting for approval" state. You can see this in the CodePipeline console—the approval action shows a status of "Waiting for Approval" with a blue icon. The pipeline doesn't time out or fail automatically; it simply waits. Some teams set up optional SNS reminders or escalation mechanisms if an approval hasn't been granted within a certain time window (using EventBridge and Lambda), but CodePipeline itself doesn't enforce a timeout.

This pause behavior is important for understanding pipeline throughput. If you have multiple developers pushing commits during the time an approval is pending, the pipeline doesn't queue them up and run them sequentially after approval. Instead, the pipeline execution for that particular commit is paused. When approval is granted, that specific execution resumes. If other commits have arrived meanwhile, they'll have their own separate pipeline executions that will also pause at the same approval action, waiting for their own approvals.

### Approving and Rejecting Decisions

When an approver clicks the approval link or navigates to the pipeline in the console, they see the approval action details. They have two primary options: Approve or Reject.

**Approving** means the approver has reviewed the artifacts and conditions and is satisfied that the pipeline should proceed. They can optionally add a summary comment (e.g., "Reviewed staging tests. All green. Ready for production."). Once they click Approve, CodePipeline records the decision, the approval action completes successfully, and the pipeline automatically moves to the next stage. Any downstream actions begin executing according to their configuration.

**Rejecting** means the approver has identified a concern or issue that prevents the pipeline from proceeding. They can add a comment explaining why (e.g., "Performance test results show a 15% degradation. Please investigate and retry."). When rejected, the approval action fails, and the pipeline execution stops. The pipeline won't automatically retry; a developer would need to address the concern and push a new commit to trigger a fresh pipeline run.

It's worth noting that only users with appropriate IAM permissions can approve or reject. This brings us to an important topic: access control.

### IAM Permissions for Approval Actions

Not everyone should be able to approve pipeline executions. You want to restrict approval permissions to specific roles or users—typically senior developers, DevOps engineers, or engineering leads for production pipelines.

To approve or reject an approval action, a user needs the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codepipeline:GetPipelineState",
        "codepipeline:GetPipeline",
        "codepipeline:PutJobSuccessResult",
        "codepipeline:PutJobFailureResult"
      ],
      "Resource": "arn:aws:codepipeline:region:account-id:pipeline-name"
    }
  ]
}
```

More broadly, to view pipelines and see approval decisions, users need `codepipeline:GetPipelineState` and `codepipeline:GetPipeline`. To actually make an approval or rejection decision, they need `codepipeline:PutJobSuccessResult` (to approve) and `codepipeline:PutJobFailureResult` (to reject). You can scope these permissions to specific pipelines by using the pipeline ARN in the Resource field, or use a wildcard if you want broader access.

A common pattern is to create an IAM role (or group) for approvers, attach these permissions, and then grant membership to the team members who should have approval authority. For different approval gates (e.g., QA sign-off vs. production deployment), you might create separate roles with different scope, ensuring that QA can approve deployment to staging but only senior engineers can approve production.

If you're using AWS SSO or Okta for identity management, you can map your external identity provider groups to IAM roles, giving you fine-grained control over who can approve at each stage.

### Common Approval Workflow Patterns

Real-world pipelines use approval actions in several well-established patterns. Let's explore the most common ones.

**The Pre-Production Gate** is perhaps the most universal pattern. Your pipeline deploys to dev and staging automatically, but before it touches production, an approval action requires human sign-off. This is straightforward to implement: add a stage before your production deployment, insert an approval action, and configure it to notify your production engineering team. This pattern is so common because it balances automation with risk mitigation—developers enjoy fast feedback from automated deployments to staging, while operations teams retain control over production.

**The Compliance Checkpoint** is common in regulated industries. Imagine a pipeline that builds a financial application. Before deployment, a compliance officer or auditor needs to review the changes and approve them. You'd add an approval action with custom data pointing to the change log, security scan results, and relevant compliance documentation. The approver can review all this context and make an informed decision. Some teams add multiple approval actions in sequence—first a technical approval from engineering, then a compliance sign-off from legal or audit—ensuring multiple checkpoints.

**The Multi-Environment Approval Ladder** chains approval actions across multiple deployment stages. You might have: Deploy to Dev (automatic) → Approval Gate → Deploy to Staging (automatic) → Approval Gate → Deploy to Production (automatic). Each approval stage notifies different people. The dev approval might be automatic or require a quick code review sign-off, the staging approval might involve QA and product, and the production approval might require an engineering manager. This ladder approach ensures that each environment gets the appropriate level of scrutiny.

**The Conditional Approval** uses Lambda to determine whether an approval is needed at all. Some teams integrate a Lambda function before an approval action to analyze the pipeline execution history or the changes being deployed. If the Lambda determines that only minor changes are involved (e.g., a config tweak), it can automatically approve the action, skipping human review. If substantial code changes are detected, the Lambda approval fails, and a manual approval action takes over. This pattern requires some custom code but can significantly reduce approval bottlenecks for routine changes.

### Integrating Third-Party Approval Systems

CodePipeline's native approval actions are sufficient for many teams, but some organizations use dedicated approval platforms—Slack, PagerDuty, ServiceNow, Jira, or custom internal systems. You can integrate these with CodePipeline using Lambda functions and the CodePipeline job worker API.

The pattern works like this: instead of using CodePipeline's native ManualApprovalAction, you create a custom Lambda action that connects to your external system. When the pipeline reaches that action, the Lambda function is invoked. Inside the Lambda, you make an API call to your approval system, creating an approval request and storing the pipeline job ID. Your external system sends a notification (via Slack, email, or whatever mechanism it uses), and when an approver makes a decision, your external system calls a Lambda webhook or your code polls for the decision. Once the decision is retrieved, the Lambda calls the CodePipeline API to complete the job as a success (approval) or failure (rejection).

Here's a simplified example of a Lambda function that integrates with a hypothetical approval service:

```python
import json
import boto3
import requests
from datetime import datetime

codepipeline = boto3.client('codepipeline')

def lambda_handler(event, context):
    """
    Handle CodePipeline job and forward approval request to external system.
    """
    
    # Extract job details from CodePipeline
    job_id = event['CodePipeline.job']['id']
    job_data = event['CodePipeline.job']['data']
    
    # Extract custom data passed from the approval action
    user_parameters = job_data.get('actionConfiguration', {}).get('configuration', {}).get('CustomUserData', '{}')
    custom_data = json.loads(user_parameters)
    
    pipeline_name = job_data['pipelineMetadata']['pipelineName']
    stage_name = job_data['pipelineMetadata']['stageName']
    action_name = job_data['pipelineMetadata']['actionName']
    
    try:
        # Forward request to external approval system
        approval_request = {
            'pipeline': pipeline_name,
            'stage': stage_name,
            'action': action_name,
            'job_id': job_id,
            'timestamp': datetime.utcnow().isoformat(),
            'context': custom_data,
        }
        
        # Call your approval system (e.g., via webhook)
        external_approval_url = 'https://approval-system.company.com/api/approval'
        response = requests.post(external_approval_url, json=approval_request)
        response.raise_for_status()
        
        # Note: In a real implementation, you'd poll or subscribe to webhooks
        # to get the approval decision and then call PutJobSuccessResult or PutJobFailureResult
        # For now, we'll keep the job pending until the external system calls back
        
        return {
            'statusCode': 202,
            'body': json.dumps('Approval request forwarded to external system')
        }
        
    except Exception as e:
        # If anything fails, reject the approval
        codepipeline.put_job_failure_result(
            jobId=job_id,
            failureDetails={'message': str(e), 'type': 'JobFailed'}
        )
        raise
```

This approach gives you tremendous flexibility. You can route approvals through Slack channels, integrate with your incident management platform, or tie approval decisions to business logic in your own systems. The tradeoff is that you're responsible for implementing the job completion logic—your Lambda or external system must call the CodePipeline API to mark the job as succeeded or failed.

### Best Practices for Approval Workflows

As you design approval workflows, keep a few principles in mind. **First, be intentional about gates.** Don't add an approval action to every stage—that turns your pipeline into a chore. Use approvals for high-impact decisions: production deployments, infrastructure changes, and compliance-sensitive workflows. Conversely, don't skip approval for things that matter. The temptation to auto-approve everything to "move faster" often backfires.

**Second, minimize approval latency.** Make sure the right people get notified. If your approval SNS topic has a subscriber list that includes people who shouldn't be approving, you create noise. Conversely, if the people who should approve aren't subscribed, approvals get delayed. Periodically audit your SNS topic subscriptions.

**Third, provide context.** Use the custom data field in your approval action to include links to test results, change logs, or deployment checklists. If an approver has to hunt for context, approval becomes a bottleneck. Make their job easy by putting information at their fingertips.

**Fourth, establish clear SLAs.** Decide how quickly approvals should happen. Is it expected within 15 minutes? An hour? A business day? Communicate this to your team, and consider setting up automated reminders (via EventBridge and Lambda) if an approval hasn't been made within the SLA window.

**Fifth, log and audit approval decisions.** CodePipeline records who approved or rejected each execution, and you can view this history in the console. Consider exporting this data to CloudWatch Logs or a compliance system if you need it for audit purposes. Many regulations require proof that decisions were made by authorized personnel.

### Monitoring and Troubleshooting Approval Actions

CodePipeline integrates with CloudWatch, so you can monitor approval metrics. You can track the number of executions waiting for approval, the average time between approval request and decision, and rejection rates. These metrics help you identify bottlenecks—if approvals are consistently slow, it might mean your approval SLA is unrealistic or your approvers are overloaded.

If an approval action fails to send notifications, the issue is usually with the SNS topic. Verify that the topic exists, that subscribers are configured, and that the IAM role used by CodePipeline has permission to publish to that topic. CodePipeline's service role needs `sns:Publish` permission on the topic ARN.

If an approver can't see the approval decision button in the console, check IAM permissions. They need the permissions we discussed earlier. Also verify they're logged into the correct AWS account and region.

If a pipeline is stuck in "waiting for approval" indefinitely, it might be that no one has taken action yet, or there might be a technical issue. Check CloudWatch Logs for CodePipeline events, and review the pipeline execution history in the console to see when the approval action was reached.

### Combining Approval Actions with Pipeline Parameters

Modern CodePipeline setups often use pipeline parameters—runtime values that change how the pipeline behaves. You can pass parameters from one stage to another, and you can reference them in approval action custom data. For example, you might pass a deployment version number from the Build stage to the Approval stage, so approvers can see exactly what version is being reviewed. This requires a bit of setup, but it provides valuable context and reduces confusion.

### Wrapping Up

Manual approval actions are a foundational tool for building reliable, controlled deployment pipelines. They give you the best of both worlds: the speed and efficiency of automation for most of your workflow, coupled with human judgment and oversight at critical moments. By configuring approval actions with SNS notifications, establishing clear IAM permissions, and following best practices around context and SLAs, you create a workflow that your team will trust and rely on.

The key insights to remember: approval actions pause your pipeline and wait for human decision; SNS notifications keep approvers informed without requiring constant console polling; IAM permissions ensure only authorized personnel can approve; and there are many patterns—from simple pre-production gates to complex multi-stage approval ladders—that fit different organizational needs. Whether you're deploying to production, handling compliance checkpoints, or integrating with third-party approval systems, CodePipeline's approval actions give you the flexibility and control you need.
