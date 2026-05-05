---
title: "Cross-Account and Cross-Region EventBridge: Configuring Resource-Based Policies"
---

## Cross-Account and Cross-Region EventBridge: Configuring Resource-Based Policies

Event-driven architectures are becoming standard practice in modern AWS deployments, and few things are more powerful—or more confusing—than routing events across account and region boundaries. Whether you're building a security monitoring hub that aggregates CloudTrail events from ten different accounts, or forwarding application events to a centralized logging region, you'll quickly discover that EventBridge's cross-account and cross-region capabilities require careful orchestration of policies and permissions.

The good news is that once you understand the pattern, it becomes repeatable and straightforward. This article walks you through the complete process of setting up cross-account and cross-region event routing with EventBridge, from configuring resource-based policies to debugging the inevitable access-denied errors you'll encounter along the way.

### Why Cross-Account Event Routing Matters

In multi-account AWS environments—which is where most organizations are heading—you often need to centralize visibility or responses. A single security account might need to receive security events from dozens of workload accounts. A central data lake might need to ingest events from applications running everywhere. Manually forwarding logs or pulling data on a schedule is error-prone and slow. EventBridge lets you push events in real time to wherever they need to go, with fine-grained permission controls that fit naturally into your organization's account structure.

The challenge, though, is understanding which permissions go where. Unlike simple cross-account IAM permissions, EventBridge cross-account routing involves three layers of policy: the resource-based policy on the destination event bus, the IAM role executing the rule in the source account, and the source event bus itself. Get any one of these wrong, and your events disappear silently—one of the more frustrating debugging experiences in AWS.

### Understanding the Three Layers of Permission

Before we build anything, let's map out the permission model. When you want EventBridge in account A to send events to an event bus in account B, three permissions checks happen in sequence.

First, the IAM role attached to the EventBridge rule in account A must have permission to perform the `events:PutEvents` action. This role's trust policy must also allow the EventBridge service to assume it. Second, the destination event bus in account B must have a resource-based policy that explicitly allows the source account (or role) to call `PutEvents`. Third, and often overlooked, the source event bus itself must allow the rule to target external accounts—this is typically enabled by default, but it's worth knowing it exists.

Think of it this way: the source account is like a shipping department preparing a package (the event) and asking a delivery service (EventBridge) to send it. The delivery service needs to be authorized (IAM role), and the recipient's mailbox (destination event bus resource policy) needs to accept packages from that sender. Without all three permissions in place, the event never arrives.

### Setting Up a Source Account Rule

Let's start with a concrete example. Imagine you have a security account (123456789012) that needs to receive CloudTrail events from a workload account (987654321098). Both accounts are in us-east-1.

In the workload account, you'll create an EventBridge rule that matches CloudTrail events and targets the security account's event bus. Here's the basic rule creation using the AWS CLI:

```bash
aws events put-rule \
  --name send-cloudtrail-to-security \
  --event-pattern '{"source":["aws.cloudtrail"],"detail-type":["AWS API Call via CloudTrail"]}' \
  --state ENABLED \
  --region us-east-1
```

This rule will match all CloudTrail events. Now comes the critical part: adding a target that points to the security account's event bus. Note that you need to specify the event bus ARN in the target account and create an IAM role that EventBridge will assume when executing the rule.

First, create the IAM role in the workload account that EventBridge will use:

```bash
cat > trust-policy.json <<EOF
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
EOF

aws iam create-role \
  --role-name eventbridge-cross-account-role \
  --assume-role-policy-document file://trust-policy.json \
  --region us-east-1
```

Now attach a policy that allows this role to put events to the target account's event bus:

```bash
cat > policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/default"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name eventbridge-cross-account-role \
  --policy-name allow-cross-account-put-events \
  --policy-document file://policy.json
```

Now add the target to your rule, specifying the security account's event bus and the role you just created:

```bash
aws events put-targets \
  --rule send-cloudtrail-to-security \
  --targets "Id"="1","Arn"="arn:aws:events:us-east-1:123456789012:event-bus/default","RoleArn"="arn:aws:iam::987654321098:role/eventbridge-cross-account-role" \
  --region us-east-1
```

### Configuring the Resource-Based Policy on the Destination Bus

Now you're in the security account. You need to create a resource-based policy on your event bus that explicitly allows the workload account to send events. This is the gatekeeper for cross-account event delivery.

```bash
cat > event-bus-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::987654321098:root"
      },
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/default"
    }
  ]
}
EOF

aws events put-permission \
  --event-bus-name default \
  --action events:PutEvents \
  --principal 987654321098 \
  --statement-id AllowWorkloadAccountPutEvents \
  --region us-east-1
```

The AWS CLI actually provides a convenience command for this. The `put-permission` command is simpler and does the same thing:

```bash
aws events put-permission \
  --event-bus-name default \
  --action events:PutEvents \
  --principal 987654321098 \
  --statement-id AllowWorkloadAccountPutEvents \
  --region us-east-1
```

You can verify the policy is in place by describing the event bus:

```bash
aws events describe-event-bus \
  --name default \
  --region us-east-1
```

Look for the `Policy` field in the response. You should see the resource-based policy allowing the workload account's root principal to call `PutEvents`.

### Creating a Rule in the Destination Account

Once events are arriving at the security account's event bus, you typically want to do something with them—forward them to a Lambda function, send them to an SQS queue, write them to S3, and so on. Create a rule in the security account that matches the events and targets wherever you want them to go:

```bash
aws events put-rule \
  --name process-cloudtrail-events \
  --event-pattern '{"source":["aws.cloudtrail"]}' \
  --state ENABLED \
  --region us-east-1

aws events put-targets \
  --rule process-cloudtrail-events \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:123456789012:function:analyze-security-events" \
  --region us-east-1
```

Note that this rule targets a Lambda function in the same account, so no cross-account permissions are needed here. But if you wanted to forward these events to yet another account, you'd repeat the entire pattern again.

### Extending to Cross-Region Scenarios

Cross-region routing follows the same pattern, with one key difference: you're targeting an event bus in a different region but potentially the same account. Let's say you want to aggregate events to us-west-2 from us-east-1.

In the source region (us-east-1), create your rule and target the destination region's event bus:

```bash
aws events put-targets \
  --rule send-cloudtrail-to-security \
  --targets "Id"="1","Arn"="arn:aws:events:us-west-2:123456789012:event-bus/default","RoleArn"="arn:aws:iam::123456789012:role/eventbridge-cross-region-role" \
  --region us-east-1
```

The IAM role only needs permission to put events (no cross-account trust issues if it's in the same account), and the destination event bus doesn't need a resource-based policy allowing itself—it's already in the same account. So the setup is simpler.

However, if you're doing cross-account *and* cross-region, you combine both approaches: create a role in the source account, attach permissions to put events, configure the destination account's resource-based policy, and specify the full ARN of the destination bus.

### Real-World Example: Security Event Aggregation

Let's build out a more realistic scenario. You're operating a multi-account AWS environment with three workload accounts (prod, staging, and development) and one security account. You want all CloudTrail events from the workload accounts to flow into the security account where you'll analyze them for compliance and incident response.

In each workload account, you set up an identical rule and role. Here's the pattern for the prod account (987654321098):

```bash
# In prod workload account (987654321098)
aws events put-rule \
  --name central-cloudtrail-forwarding \
  --event-pattern '{"source":["aws.cloudtrail"]}' \
  --state ENABLED

aws events put-targets \
  --rule central-cloudtrail-forwarding \
  --targets "Id"="1","Arn"="arn:aws:events:us-east-1:111111111111:event-bus/security-bus","RoleArn"="arn:aws:iam::987654321098:role/send-to-security-account"
```

Repeat this for staging and development accounts with their respective AWS account IDs.

In the security account (111111111111), you grant each workload account permission:

```bash
# In security account (111111111111)
aws events put-permission \
  --event-bus-name security-bus \
  --action events:PutEvents \
  --principal 987654321098 \
  --statement-id AllowProdPutEvents

aws events put-permission \
  --event-bus-name security-bus \
  --action events:PutEvents \
  --principal 111111111110 \
  --statement-id AllowStagingPutEvents

aws events put-permission \
  --event-bus-name security-bus \
  --action events:PutEvents \
  --principal 111111111109 \
  --statement-id AllowDevPutEvents
```

Then create a rule in the security account that processes all incoming CloudTrail events:

```bash
# In security account
aws events put-rule \
  --name analyze-all-cloudtrail \
  --event-pattern '{"source":["aws.cloudtrail"]}' \
  --state ENABLED \
  --event-bus-name security-bus

aws events put-targets \
  --rule analyze-all-cloudtrail \
  --event-bus-name security-bus \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:111111111111:function:security-analyzer"
```

Now, whenever any CloudTrail event occurs in any workload account, it automatically flows to the security account's Lambda function for analysis. You could enhance this further by filtering for specific event types, enriching events with account context, or routing different event types to different targets.

### Common Permission Errors and Troubleshooting

Even when you follow the pattern correctly, things can go wrong. Let's walk through the most common errors and how to diagnose them.

**Events silently disappear without reaching the target.** This is usually a permissions issue. First, verify your rule is actually matching events by checking CloudWatch Metrics for the rule in the source account. Look for `Invocations` and `FailedInvocations`. If invocations are zero, your rule pattern isn't matching. If invocations are high but nothing appears in the destination, check the IAM role's permissions. The role must explicitly allow `events:PutEvents` on the destination event bus ARN.

**You get an explicit access-denied error in CloudWatch Logs.** This typically means either the IAM role is missing, the resource-based policy on the destination bus is misconfigured, or you're using the wrong principal in the policy. Double-check that the principal in the resource-based policy exactly matches the AWS account ID (or role ARN if you're being more restrictive). Common mistake: using the role ARN in the principal instead of the account ID or role ARN—the policy should allow the *account* that contains the role, not just the role itself.

**Events are reaching the destination account's bus, but your rule in the destination account isn't matching them.** Check that your event pattern in the destination rule is correct. Remember that when events arrive at a different event bus, they retain their original structure. If you're using the `put-permission` command with a custom event bus name (not `default`), make sure you're specifying `--event-bus-name` correctly.

**The target in the source account rule keeps retrying with exponential backoff.** This usually indicates a permissions issue on the destination bus's resource-based policy. EventBridge will retry for up to 24 hours (with exponential backoff) before giving up. Check the resource-based policy to ensure it explicitly allows the source account.

To debug effectively, enable CloudTrail in the destination account and look for `PutEvents` API calls. You'll see whether the call succeeded or failed, and if it failed, you'll get detailed error messages. You can also look at EventBridge's rule metrics in CloudWatch for invocation counts and failures.

```bash
# View rule metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=your-rule-name \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Best Practices for Production Deployments

When you're setting this up in production, a few practices will save you headaches.

Keep your resource-based policies scoped appropriately. Rather than allowing an entire AWS account, consider being more restrictive by allowing specific roles or by using source account and organization conditions in your policy. This limits the blast radius if a role is compromised.

Use custom event buses instead of the default bus when you're doing cross-account routing. This makes it crystal clear which events are local and which are being forwarded, and it allows you to apply different retention policies and permissions to different event flows.

Document your cross-account event routing in your architecture diagrams and runbooks. Future you (and your on-call rotation) will appreciate knowing which accounts are sending events where and why.

Test your setup by sending a test event from the source account and verifying it appears in the destination account. The EventBridge console's `Send custom events` feature is perfect for this:

```bash
aws events put-events \
  --entries '[{"Source":"test","DetailType":"Test Event","Detail":"{\"test\":true}"}]' \
  --region us-east-1
```

Monitor your cross-account event deliveries just like any other critical integration. Set up alarms for high `FailedInvocations` metrics and unusual latency patterns.

### Conclusion

Cross-account and cross-region event routing with EventBridge is a powerful capability that unlocks sophisticated event-driven architectures at scale. The pattern is straightforward once you understand the three layers of permission: the IAM role in the source account, the resource-based policy on the destination bus, and the target configuration in your rule.

By starting with a clear mental model—the source sends, the destination permits—you can confidently build event aggregation patterns that centralize visibility without sacrificing security. Whether you're building a security monitoring hub, a centralized data lake, or just forwarding application events across organizational boundaries, these same principles apply. And when things go wrong, you now know where to look and how to debug.

The investment in understanding this pattern pays dividends in every multi-account environment. With proper resource-based policies and IAM roles in place, you can build event-driven systems that are both flexible and secure.
