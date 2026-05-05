---
title: "Triggering ECS, Step Functions, and Lambda from EventBridge: Required IAM Roles"
---

## Triggering ECS, Step Functions, and Lambda from EventBridge: Required IAM Roles

EventBridge has become the nervous system of modern AWS architectures, routing events from virtually any source to virtually any target. But getting those integrations working requires understanding a critical detail that trips up many developers: the IAM permissions that allow EventBridge itself to invoke your downstream services. Whether you're launching ECS tasks, starting Step Functions executions, or invoking Lambda functions, EventBridge needs the right role with the right permissions. This guide walks you through the exact IAM configurations you need, complete with working examples and troubleshooting strategies.

### Why EventBridge Needs IAM Roles

Before diving into the specifics, it's important to understand the fundamental principle at play. EventBridge is an AWS service that acts on your behalf. When an event matches a rule and EventBridge decides to send that event to a target, it needs explicit permission to perform that action. Think of it like delegating work to a colleague—they need authorization to do what you're asking them to do.

This is where IAM roles come in. You create a role with specific permissions, set that role's trust policy to allow the EventBridge service to assume it, and attach it to your EventBridge rule. When an event triggers, EventBridge assumes this role and uses its permissions to invoke your target. The exact permissions and role structure vary depending on the target type, but the principle remains constant across all integrations.

### The Trust Policy: Allowing EventBridge to Assume Your Role

Every IAM role that EventBridge will use must have a trust policy (also called an assume role policy) that explicitly allows the EventBridge service principal to assume it. This is non-negotiable and applies regardless of whether you're targeting ECS, Step Functions, Lambda, or any other service.

The trust policy is straightforward:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The key element here is the service principal `events.amazonaws.com`. This tells IAM that the EventBridge service (which lives in the `events` namespace) is allowed to assume the role. Without this trust relationship, EventBridge will receive an access denied error even if all other permissions are in place.

### Invoking ECS Tasks with RunTask

When you want EventBridge to launch ECS tasks, you're asking EventBridge to call the `ecs:RunTask` API on your behalf. This requires a dedicated IAM role with specific permissions that match the exact task and cluster you're targeting.

Here's a complete example of an IAM policy that allows EventBridge to run tasks in ECS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecs:RunTask",
      "Resource": "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
        "arn:aws:iam::123456789012:role/ecsTaskRole"
      ]
    }
  ]
}
```

Notice two important elements here. First, the `ecs:RunTask` action is restricted to a specific task definition ARN. This follows the principle of least privilege—you're only granting permission to run this specific task, not all tasks in your cluster. Second, and critically, there's an `iam:PassRole` permission. This is often overlooked but absolutely necessary. When EventBridge invokes `RunTask`, it needs to pass the task execution role and task role to ECS. Without the `iam:PassRole` permission for those roles, the API call will fail with an access denied error even though you've granted `ecs:RunTask`.

The resource ARN in the `ecs:RunTask` action should point to the task definition you want EventBridge to launch. If you have multiple task definitions, you can use a wildcard pattern like `arn:aws:ecs:us-east-1:123456789012:task-definition/*` to grant broader access, though this sacrifices some security precision.

When you set up the EventBridge rule, you'll also need to specify additional details like the launch type (Fargate or EC2), the cluster name, and the network configuration (for Fargate). These details are configured in the rule target itself, not in the IAM policy—the policy just grants the broad permission to attempt the action.

### Starting Step Functions Executions

Triggering Step Functions executions from EventBridge requires a similarly straightforward but specific permission structure. The key action you're granting is `states:StartExecution`.

Here's the policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "states:StartExecution",
      "Resource": "arn:aws:states:us-east-1:123456789012:stateMachine:myStateMachine"
    }
  ]
}
```

This policy grants EventBridge permission to start executions on a specific state machine. The resource ARN should point to the exact state machine you want EventBridge to invoke. If you want EventBridge to trigger multiple state machines, you can either create multiple policies or use wildcards, but the latter again trades precision for convenience.

Step Functions is notably simpler than the ECS integration in one respect: you don't need to pass any additional roles. The state machine itself defines what permissions it has, and EventBridge just needs permission to call the API. This makes the policy cleaner and easier to reason about.

One practical tip: when you send an event to Step Functions through EventBridge, you can include data from the event in the execution input. This data is passed directly to the state machine, so ensure your state machine's initial state and subsequent states are designed to handle the event structure you'll be sending.

### Invoking Lambda Functions

Here's where things diverge significantly from ECS and Step Functions. **Lambda doesn't use IAM role-based authorization when invoked by EventBridge.** Instead, Lambda uses resource-based policies. This is a crucial distinction that catches many developers off guard.

When you want EventBridge to invoke a Lambda function, you don't create an IAM role for EventBridge. Instead, you add a resource-based permission directly to the Lambda function that allows the EventBridge service to invoke it. This is typically done through the AWS CLI or console, and the permission looks like this:

```bash
aws lambda add-permission \
  --function-name my-function \
  --statement-id AllowEventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:123456789012:rule/my-rule
```

This command adds a resource-based policy to the Lambda function that grants the EventBridge service permission to invoke it. The permission is scoped to a specific EventBridge rule (via the source ARN), which provides good security isolation.

The permission translates to a policy document on the Lambda function that looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:my-function",
      "Condition": {
        "ArnLike": {
          "AWS:SourceArn": "arn:aws:events:us-east-1:123456789012:rule/my-rule"
        }
      }
    }
  ]
}
```

If you want to broaden this to allow any EventBridge rule to invoke the function, you can use a wildcard for the source ARN, but in most production scenarios, you'll want to restrict it to specific rules. This prevents unauthorized or accidental rule triggers from invoking your function.

### Same-Account vs. Cross-Account Targets

The configurations described above work seamlessly when EventBridge and your target service live in the same AWS account. But when you need to trigger services in a different account, the trust policy changes subtly but importantly.

For a same-account integration, the trust policy allows the EventBridge service principal directly:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

For a cross-account integration, the target account's role must trust the role in the EventBridge account. The trust policy looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/EventBridgeRole"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Here, `111111111111` is the account where EventBridge lives, and `EventBridgeRole` is the role you created in that account with the appropriate permissions (ecs:RunTask, states:StartExecution, etc.). The target account's role then trusts this cross-account role, creating a chain of trust that allows EventBridge to assume the role in the target account and invoke the service.

Additionally, the EventBridge role in the source account needs an extra statement granting it permission to assume the cross-account role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::222222222222:role/CrossAccountECSRole"
    }
  ]
}
```

Here, `222222222222` is the target account. This creates a complete chain where EventBridge can assume its local role, which can then assume the remote role, which has permission to invoke the actual service.

### Practical Troubleshooting: AccessDenied Errors

Despite careful configuration, AccessDenied errors are common when working with EventBridge integrations. Here's how to systematically diagnose and fix them.

First, check the EventBridge rule itself in the console or via the CLI. Run:

```bash
aws events describe-rule --name my-rule
```

Verify that the rule exists and is enabled. Then, describe the targets:

```bash
aws events list-targets-by-rule --rule my-rule
```

Check that the target is configured with the correct role ARN. The role ARN should be the EventBridge role you created, not your task execution role or any other role.

Next, verify the trust policy on the EventBridge role:

```bash
aws iam get-role --role-name EventBridgeRole
```

The trust policy must include `events.amazonaws.com` as the principal. If this is missing or incorrect, EventBridge cannot assume the role at all.

Then, check the permissions policy attached to the role. If you're targeting ECS, verify that `ecs:RunTask` is allowed for the correct task definition ARN, and that `iam:PassRole` is allowed for the task execution and task roles. If you're targeting Step Functions, verify that `states:StartExecution` is allowed for the correct state machine ARN.

For Lambda integrations, remember that you're not troubleshooting a role—you're checking the function's resource-based policy. Run:

```bash
aws lambda get-policy --function-name my-function
```

Verify that the policy allows `lambda:InvokeFunction` for the `events.amazonaws.com` principal.

Enable CloudTrail logging to see the exact API calls EventBridge is making and any error details. Look for the `AssumeRole` call first—if that's failing, the trust policy is wrong. If `AssumeRole` succeeds but the actual API call (RunTask, StartExecution, etc.) fails, the permissions policy is missing or incorrect.

A common mistake is forgetting the account ID in ARNs. Every ARN in your policies must be fully qualified with your account ID. An ARN like `arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:*` is correct; `arn:aws:ecs:us-east-1::task-definition/my-task:*` (missing account ID) will fail silently.

### Real-World Example: Building a Complete Integration

Let's walk through a realistic scenario to tie everything together. Suppose you want EventBridge to trigger an ECS task whenever a message appears on an SNS topic.

First, you'd create the IAM role for EventBridge in your AWS account:

```bash
aws iam create-role \
  --role-name EventBridgeECSRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "events.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'
```

Next, you'd attach the policy that grants the actual permissions:

```bash
aws iam put-role-policy \
  --role-name EventBridgeECSRole \
  --policy-name ECSRunTaskPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "ecs:RunTask",
        "Resource": "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:*"
      },
      {
        "Effect": "Allow",
        "Action": "iam:PassRole",
        "Resource": [
          "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
          "arn:aws:iam::123456789012:role/ecsTaskRole"
        ]
      }
    ]
  }'
```

Then, you'd create an EventBridge rule that matches SNS messages:

```bash
aws events put-rule \
  --name SNStoECSRule \
  --event-pattern '{
    "source": ["aws.sns"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "eventSource": ["sns.amazonaws.com"],
      "eventName": ["Publish"]
    }
  }'
```

Finally, you'd add the ECS target to the rule:

```bash
aws events put-targets \
  --rule SNStoECSRule \
  --targets "Id"="1","Arn"="arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeECSRole","EcsParameters"={"LaunchType"="FARGATE","NetworkConfiguration"={"awsvpcConfiguration"={"Subnets"=["subnet-12345"],"AssignPublicIp"="ENABLED"}},"TaskDefinitionArn"="arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1"}"
```

At this point, when SNS publishes a message, EventBridge would match the rule, assume the `EventBridgeECSRole`, and call `ecs:RunTask` to launch your task. If anything goes wrong, you'd follow the troubleshooting steps outlined earlier to identify whether the issue is with the trust policy, the permissions policy, or the rule configuration itself.

### Key Takeaways

Understanding IAM roles and policies for EventBridge integrations is essential for building reliable event-driven architectures. The pattern is consistent: EventBridge needs a role with a trust policy that allows `events.amazonaws.com` to assume it, and that role needs permissions for the specific API actions you're invoking. For ECS, that's `ecs:RunTask` plus `iam:PassRole`. For Step Functions, it's `states:StartExecution`. For Lambda, you bypass roles entirely and use resource-based permissions instead. Cross-account integrations follow the same principles but require an additional layer of trust relationships between accounts. When troubleshooting, always verify the trust policy first, then the permissions policy, then check CloudTrail for the actual error details. With these concepts and patterns in your toolkit, you'll be able to confidently build EventBridge integrations that work the first time.
