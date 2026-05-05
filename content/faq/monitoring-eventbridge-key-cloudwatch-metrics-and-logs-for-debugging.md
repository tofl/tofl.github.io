---
title: "Monitoring EventBridge: Key CloudWatch Metrics and Logs for Debugging"
---

## Monitoring EventBridge: Key CloudWatch Metrics and Logs for Debugging

EventBridge feels magical when it works—events flow seamlessly from source to target, automating your workflows with barely a configuration file in sight. But when something goes wrong, that magic evaporates fast. An event disappears into the void. A Lambda function never fires. A critical workflow stalls silently. Without proper observability, tracking down what happened becomes a frustrating guessing game.

The difference between debugging EventBridge in the dark and debugging it confidently comes down to one thing: knowing what to monitor and where to look. CloudWatch metrics tell you *what* happened at scale. Logs tell you *why* it happened. X-Ray traces connect the dots. Together, they transform EventBridge from a black box into a transparent, debuggable service you can reason about and troubleshoot systematically.

This article walks you through the observability landscape for EventBridge. We'll explore the critical CloudWatch metrics that matter, learn how to enable and interpret logs, uncover the sneakiest failure modes, and build a practical troubleshooting toolkit you can lean on when things inevitably go sideways in production.

### Understanding EventBridge Metrics in CloudWatch

EventBridge publishes metrics to CloudWatch automatically—no configuration required. These metrics arrive in the `AWS/Events` namespace and are grouped by event bus and rule, giving you visibility into how your event-driven architecture is performing.

The foundational metric is **Invocations**. This counts every successful invocation attempt sent to a target. If you're routing events to three targets and all three fire successfully, that's three invocations. In a well-functioning system, this metric shows you the throughput of your event processing pipeline. A sudden drop in invocations might indicate that events aren't matching any rules, or that something upstream stopped producing events.

**FailedInvocations** tells you how many times EventBridge attempted to invoke a target but the attempt failed. A failed invocation means EventBridge sent the request, but the target returned an error or didn't respond. For Lambda targets, a failed invocation typically indicates your function threw an unhandled exception or timed out. For SNS or SQS targets, it might mean the target service wasn't available or rejected the message. The critical insight here is that EventBridge *tried* but didn't succeed. This is different from an event never matching a rule in the first place.

**MatchedEvents** counts the number of events that matched at least one rule. This metric is deceptively important because it answers a question that trips up many developers: did my event even match a rule? An event arrives on the event bus, EventBridge evaluates it against every rule's pattern, and if any rule matches, MatchedEvents increments. If MatchedEvents stays at zero while your source is sending events, you know the problem isn't with targets or permissions—it's with your event pattern. Maybe the event schema doesn't match. Maybe the source name or detail-type doesn't match your pattern. This metric narrows the debugging scope dramatically.

**ThrottledRules** appears when EventBridge applies rate limiting to a rule. EventBridge has soft limits on how many events per second a rule can process, and if a rule exceeds this, EventBridge throttles subsequent invocations. You won't lose the events permanently—EventBridge retries them—but this metric signals you're hitting scale constraints. If you see consistent throttling on a rule, you've found a real bottleneck.

**DeadLetterInvocations** tracks events that EventBridge sent to a dead-letter queue (DLQ). If you've configured a DLQ on a rule (which you should for production workloads), and an invocation fails after all retries, EventBridge sends it there. This metric is your early warning system for systemic failures. A spike in dead-letter invocations often precedes a complete outage if you don't investigate and remediate.

**InvocationAttempts** counts the total number of times EventBridge *tried* to invoke a target, including retries. By comparing this to Invocations, you can infer how many retries occurred. If InvocationAttempts is significantly higher than Invocations, your targets are failing frequently and EventBridge is working hard to retry them. This ratio is a useful health check.

All these metrics are dimensioned by EventBusName and RuleName, so you can drill down to specific rules. You can also filter by TargetArn if you need to understand the behavior of a particular target. CloudWatch retains these metrics for 15 months, giving you a long historical view of your system's behavior.

### Enabling and Interpreting Target Invocation Logs

Metrics tell you the summary—events matched, invocations succeeded, failures occurred. But they don't tell you *what* was in the event or *why* a target failed. That's where target invocation logging comes in. EventBridge can send detailed logs about every invocation attempt to CloudWatch, and turning this on is one of the highest-ROI observability investments you can make.

Enabling logging is straightforward. Navigate to your EventBridge rule in the console, go to the Edit page, and expand the "Logging and tracing" section. You'll see options to log failed invocations, successful invocations, or both. Point the logs to a CloudWatch log group. For production, log both successful and failed invocations—the disk space is cheap compared to the debugging headaches you'll avoid.

When you enable logging, EventBridge sends structured JSON logs to CloudWatch. A successful invocation log looks like this:

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "detail-type": "myDetailType",
  "source": "mySource",
  "account": "123456789012",
  "time": "2023-05-22T12:34:56Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "key1": "value1",
    "key2": "value2"
  },
  "target": "Lambda",
  "targetArn": "arn:aws:lambda:us-east-1:123456789012:function:MyFunction",
  "httpParameters": {},
  "roleArn": "arn:aws:iam::123456789012:role/MyEventBridgeRole",
  "result": "SUCCESS"
}
```

The crucial field here is `result`. When it's `SUCCESS`, the target accepted the invocation. For failed invocations, the log includes an error code and message:

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "detail-type": "myDetailType",
  "source": "mySource",
  "account": "123456789012",
  "time": "2023-05-22T12:34:56Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "key1": "value1"
  },
  "target": "Lambda",
  "targetArn": "arn:aws:lambda:us-east-1:123456789012:function:MyFunction",
  "httpParameters": {},
  "roleArn": "arn:aws:iam::123456789012:role/MyEventBridgeRole",
  "result": "FAILED",
  "errorCode": "InvalidLambdaFunction",
  "errorMessage": "Invalid Lambda function: function does not exist"
}
```

The `errorCode` and `errorMessage` fields are invaluable. Common error codes include `InvalidLambdaFunction` (the target doesn't exist), `AccessDenied` (permissions problem), `RequestTimeout` (the target took too long), and `RateLimited` (you've hit a service limit). By filtering your CloudWatch logs by error code, you can quickly identify patterns—maybe all your Lambda invocations are timing out, suggesting you need to increase the timeout setting.

In the CloudWatch console, use CloudWatch Insights to query these logs efficiently. A query like:

```
fields @timestamp, target, errorCode, errorMessage
| filter result = "FAILED"
| stats count() by errorCode
```

This groups failures by error code and shows you the distribution. If 95% of your failures are `AccessDenied`, you've found your problem immediately—go check the IAM role permissions. If failures are spread across timeouts and rate limits, you know the issue is target-side capacity or performance.

### Debugging Silent Failures: The Event That Never Fired

One of the most maddening EventBridge scenarios is when an event arrives on your event bus, but nothing happens, and there's no obvious error. The event vanishes silently. Your Lambda never fires. No error log appears. This is what I call a "silent failure," and it falls into a few distinct categories.

**No Rule Matched the Event**

The first suspect is always the event pattern. EventBridge evaluates every incoming event against every rule's pattern. If no pattern matches, the event is discarded (assuming you're not forwarding unmatched events somewhere). The MatchedEvents metric is your diagnostic here. If your event source is actively sending events but MatchedEvents stays at zero, you're not matching any rules.

The common culprit is a mismatch between your event's actual structure and what your pattern specifies. Event patterns in EventBridge use a JSON-based syntax that's strict about structure. If your event has a source of `myapp` but your pattern specifies `source: ["myapp.orders"]`, no match. If your event's detail object has a field called `orderId` but your pattern looks for `order_id`, no match.

To debug this, enable CloudWatch Logs Insights on your event bus and inspect a raw event. EventBridge doesn't log unmatched events by default, but you can create a catch-all rule—a rule with an empty pattern `{}` that matches everything—and send those events to CloudWatch Logs. This lets you see the actual structure of events arriving on the bus. Once you see the real event, you can update your patterns to match correctly. The catch-all rule approach is also useful during development; once you've debugged and deployed correctly, you can remove it.

**Target Exists but Permissions Are Wrong**

The second culprit is IAM permissions. EventBridge invokes targets on your behalf using an IAM role. If that role doesn't have permission to invoke the target, the invocation fails silently from the user's perspective. You don't see an error in your Lambda logs because the invocation never reached your function—it failed at the EventBridge layer.

The target invocation logs reveal this immediately. An `AccessDenied` error code means EventBridge tried to invoke the target but the IAM role lacked permission. The fix is to ensure the EventBridge rule's IAM role has the appropriate permission for the target service. For a Lambda target, that's `lambda:InvokeFunction`. For SNS, it's `sns:Publish`. For SQS, it's `sqs:SendMessage`.

A best practice is to use least-privilege IAM policies. Instead of granting wildcard permissions, grant permission to specific targets. For example, instead of:

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "*"
}
```

Use:

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function/MyFunction"
}
```

This way, the role can invoke only the Lambda functions you explicitly authorize.

**Throttling Silently Drops Events**

A third failure mode is throttling, though calling it "silent" is slightly misleading—it shows up in the ThrottledRules metric, but many developers miss this metric entirely. EventBridge has soft limits on how many events per second a rule can process. The default is 2,400 invocations per second per rule, but if you've requested higher limits, you might have a different ceiling.

When throttling occurs, EventBridge doesn't drop events entirely. Instead, it queues them and retries based on your rule's retry policy. However, if the queue fills up or retry attempts exceed your configured maximum, events do eventually get discarded. The ThrottledRules metric is the canary in the coal mine—if you see consistent throttling, you need to increase your limits or investigate why a single rule is receiving so much traffic.

To request higher limits for a specific rule, contact AWS Support and provide your event bus name and rule name. AWS can adjust your limits, but be prepared to justify the increase with traffic data.

### Correlating Events Through X-Ray

Metrics and logs show you what happened, but they don't always show you the full journey of a single event. In a distributed system, an event might trigger one Lambda, which invokes another service, which writes to a database. If something fails in this chain, you need to trace the event end-to-end.

X-Ray provides exactly this capability. When you enable X-Ray tracing on an EventBridge rule, EventBridge includes trace headers in invocations to targets, and targets can propagate these headers downstream. This creates a connected view of the entire flow.

Enabling X-Ray on a rule is a checkbox in the EventBridge console under "Logging and tracing." Once enabled, EventBridge generates a trace for every invocation and stores it in X-Ray. The trace shows the event's journey from EventBridge to targets to downstream services.

In the X-Ray service map, you'll see nodes for EventBridge, your Lambda functions, databases, and other services, with lines connecting them. If a Lambda function is calling DynamoDB, you'll see that relationship. If a Lambda is calling another Lambda, you'll see that too. Most importantly, if a call fails, the trace shows you where the failure occurred and often provides error details.

To use X-Ray effectively from your Lambda function, you need to instrument it with the X-Ray SDK. For Python, that's the `aws-xray-sdk` package. A minimal instrumentation looks like:

```python
from aws_xray_sdk.core import xray_recorder

@xray_recorder.capture('process_order')
def process_order(event, context):
    # Your function logic here
    return {"statusCode": 200}
```

The `@capture` decorator automatically records timing and errors. Any unhandled exception in the decorated function appears in the X-Ray trace with the full stack trace.

X-Ray is especially valuable when debugging asynchronous workflows. In a synchronous request-response flow, errors bubble up immediately. In an event-driven system, errors might surface minutes or hours later in a DLQ or a stuck database transaction. X-Ray's end-to-end tracing helps you connect cause and effect.

### Setting Up Alarms on Service Level Indicators

Metrics in CloudWatch are only useful if you actively monitor them. The best way to stay ahead of problems is to set up CloudWatch alarms that alert you when key metrics cross thresholds. Rather than watching dashboards constantly, let alarms pull you in when something matters.

The most important alarms to set up are on FailedInvocations and DeadLetterInvocations. A spike in either often precedes a total outage, and catching it early lets you respond before customers are affected.

For **FailedInvocations**, consider an alarm that triggers if the count exceeds a threshold in a five-minute window. What's a "threshold"? That depends on your traffic and tolerance for errors. A rule that normally has zero failed invocations should probably alarm if it sees even one or two failures. A high-traffic rule might tolerate a few failures per minute but should alarm if it sees a sustained spike.

Here's the basic structure using the AWS CLI:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name EventBridge-FailedInvocations-Alert \
  --alarm-description "Alert when EventBridge rules have failed invocations" \
  --metric-name FailedInvocations \
  --namespace AWS/Events \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:AlertTopic
```

This alarm triggers if the sum of FailedInvocations in a five-minute window exceeds 10. The alarm sends a notification to an SNS topic, which you can route to your on-call team via email or SMS.

For **DeadLetterInvocations**, set an alarm that triggers immediately on any value. If events are being sent to your DLQ, something is seriously wrong, and you want to know about it right away.

You might also set up alarms on **ThrottledRules** to alert you to capacity constraints. A threshold of zero (trigger on any throttling) is reasonable for production systems—it signals you need to either reduce traffic to the rule or request higher limits.

Finally, consider an alarm on the **ratio of InvocationAttempts to Invocations**. A high ratio indicates your targets are failing frequently and EventBridge is retrying them. While retries are a feature, a sustained high ratio suggests an underlying problem. You might compute this ratio in CloudWatch using a metric math alarm:

```
(m2 - m1) / m1
```

Where m1 is Invocations and m2 is InvocationAttempts. If this ratio exceeds 1.5 (meaning 50% more attempts than successful invocations), something is wrong.

Pair these alarms with a good alerting strategy. Send critical alerts to your on-call team. Send informational alerts to a central observability platform where you can trend them over time. The goal is to be reactive when you need to be, but also to detect patterns that suggest systemic issues.

### Common Troubleshooting Scenarios: A Practical Checklist

When a Lambda function isn't being triggered by an EventBridge event, debugging can feel like whack-a-mole if you don't have a systematic approach. Here's a checklist that covers the most common failure modes. Work through them in order—they're ordered by frequency in my experience.

**Check that the event is actually arriving on the event bus.** Create a test event matching your source and detail-type in the EventBridge console, and manually put it on the event bus using the "Send custom event" feature. If your rule matches this test event, the rule pattern itself is probably fine. If the rule doesn't match the test event, your pattern is wrong. If the rule matches the test event but doesn't match real events from your source, the real events have a different structure than you think. Enable catch-all logging (a rule with `{}` pattern) to see actual event structures.

**Verify the rule is enabled.** In the EventBridge console, click on the rule and check the "State" field. A disabled rule will never match anything. This sounds obvious, but it's a surprisingly common mistake—someone disables a rule for testing and forgets to re-enable it.

**Check event pattern syntax.** EventBridge event patterns use a specific JSON format. Common mistakes include forgetting to use arrays (patterns should specify `"source": ["myapp"]`, not `"source": "myapp"`), using incorrect operators, or specifying exact values when you meant to use wildcard patterns. The EventBridge console has a "Test pattern" feature that lets you validate your pattern against sample events before deploying.

**Verify IAM permissions.** Check the IAM role attached to the rule. Does it have permission to invoke the target? Use the CloudWatch Logs for target invocations to check for `AccessDenied` errors. If you see these errors, the fix is straightforward—grant the role the necessary permission.

**Check target configuration.** Is the target correctly specified? For Lambda targets, does the Lambda function exist in the same region as the rule? EventBridge can only invoke targets in the same region (though you can use cross-region event buses). For SNS/SQS targets, verify the topic/queue ARN is correct and the resource exists.

**Look at retry and dead-letter policies.** If the rule has a dead-letter queue configured, are events ending up there? Check the DLQ to see if your events are being discarded. If they are, that's your smoking gun—the target is failing after retries. Move up to target invocation logs to see why.

**Check Lambda timeout.** If your Lambda function takes longer than the timeout configured in EventBridge, the invocation will fail. The default timeout is 60 seconds. If your function legitimately needs more time, increase the timeout on the EventBridge rule's Lambda target. You can see timeouts in target invocation logs as `RequestTimeout` error codes.

**Verify target rate limits.** Some targets have their own rate limits. SQS queues have throughput limits. Lambda has concurrent execution limits. If you're hitting these limits, events might be rejected or queued. Check CloudWatch metrics for the target service (Lambda duration, SQS queue depth, etc.) to see if targets are saturated.

**Check region mismatches.** EventBridge rules exist in specific regions. If your event source and rule are in different regions, you need an explicit event bus configuration or a cross-region setup. By default, events stay in the region where they're published.

**Inspect the actual event payload.** Enable target invocation logging and look at the actual event being sent to your target. Is the event structure what you expect? Sometimes upstream systems send events with unexpected fields or missing fields, and your function fails to parse them. Inspect the `detail` field in the invocation logs—that's the actual event payload your target receives.

This checklist covers about 95% of "why isn't my Lambda being triggered" questions. Work through each point methodically, and you'll identify the issue. The key is to gather data—don't guess. Use the CloudWatch metrics and logs to see what's actually happening, not what you think is happening.

### Building an Observability Dashboard

Once you understand the key metrics and logs, the next step is to bring them together into a unified dashboard. A good dashboard lets you see the health of your EventBridge infrastructure at a glance, without needing to navigate through multiple consoles.

In the CloudWatch console, create a new dashboard. Add widgets for the metrics that matter to your business. For each rule you care about, add line graphs showing:

- **Invocations** (the main throughput metric)
- **FailedInvocations** (absolute value and percentage)
- **MatchedEvents** (to verify events are matching rules)
- **ThrottledRules** (early warning for capacity issues)
- **DeadLetterInvocations** (early warning for systemic failures)

Add a logs widget that shows recent errors from your target invocation logs. You can set up a query that filters for failures and displays the error code distribution. This gives you a quick visual of where failures are concentrating.

Add a third-party integration for your alerting tool (if you have one). If you use PagerDuty, Slack, or another on-call service, configure CloudWatch to send alarms there directly. This way, alerts don't just sit in CloudWatch—they reach your team where they work.

Store your dashboard definition in version control. CloudWatch dashboards are defined as JSON, and you can export the JSON from the console. Storing it in version control means you can track changes over time and reconstruct the dashboard in another account if needed.

The goal of a dashboard isn't to be comprehensive—it's to answer the key questions quickly. Can you tell at a glance whether your EventBridge rules are healthy? Can you see when failure rates spike? Can you identify which rules or targets are having problems? If you can answer these questions in under a minute, your dashboard is well-designed.

### Conclusion

Observability transforms EventBridge from a mysterious service into a transparent, debuggable system. The combination of CloudWatch metrics, target invocation logs, and X-Ray traces gives you multiple angles to investigate problems. When something goes wrong—and something will go wrong eventually—these tools let you diagnose the issue systematically rather than blindly.

The key takeaway is this: don't wait until you have a production incident to explore these features. Set them up proactively. Enable target invocation logging, create a CloudWatch dashboard, set up alarms on the metrics that matter. When a problem occurs, you'll already have the data you need, and you'll be able to respond confidently and quickly.

Start with the foundational metrics—Invocations, FailedInvocations, and MatchedEvents. These three metrics will answer most of your questions. Layer in target invocation logs to see details. Add X-Ray when you need end-to-end tracing. Build your dashboard gradually, adding metrics and alerts as you understand what normal looks like for your system. Before long, you'll have built an observability practice that lets you operate EventBridge reliably in production.
