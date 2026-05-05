---
title: "Lambda Versions and Aliases: Implementing Blue/Green and Canary Deployments"
---

## Lambda Versions and Aliases: Implementing Blue/Green and Canary Deployments

Deploying a new version of your Lambda function without risk is one of those challenges that separates confident developers from those who lose sleep over production incidents. Imagine pushing an update that unexpectedly increases cold start latency, causing your payment processing function to timeout during peak hours. Without a safe rollback strategy, you're looking at data loss or angry customers—or both.

This is where Lambda versions and aliases become your safety net. Together, they enable sophisticated deployment patterns like blue/green and canary releases that let you test new code with real traffic before committing to a full rollout. More importantly, when something goes wrong, you can roll back in seconds rather than hours.

In this guide, we'll explore how to harness Lambda versions and aliases to implement progressive deployment strategies that give you confidence in your updates. We'll look at the mechanics of how they work, walk through practical examples of traffic-shifting patterns, and integrate them with AWS CodeDeploy for fully automated, safe deployments with intelligent rollback.

### Understanding Lambda Versions: Immutable Snapshots of Your Code

Every Lambda function starts with a special version called `$LATEST`. This is a mutable version—every time you update your function code or configuration, you're modifying `$LATEST`. It's convenient for development and testing, but it has a critical limitation: there's no way to pin a specific execution to a known state of your code.

To solve this, Lambda lets you publish a version. When you publish a version, Lambda takes a snapshot of your code and configuration—environment variables, memory allocation, timeout, layers, everything—and assigns it an immutable version number: 1, 2, 3, and so on. These numbers increment automatically, and once published, the version cannot be changed. This immutability is crucial because it means when you invoke version 5, you know exactly what code and configuration will run, every single time.

Let's see this in action. Say you have a Lambda function that processes orders:

```bash
aws lambda publish-version \
  --function-name order-processor \
  --description "Version 1: Initial release"
```

This command returns something like:

```json
{
  "FunctionName": "order-processor",
  "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:order-processor:1",
  "Version": "1",
  "Description": "Version 1: Initial release",
  "LastModified": "2024-01-15T10:30:00.000+0000",
  "CodeSize": 5242880
}
```

Notice the ARN includes `:1` at the end, identifying the specific version. If you later make changes and publish again, you'll get version 2 with a different ARN. You can invoke either version independently:

```bash
# Invoke the latest development version
aws lambda invoke \
  --function-name order-processor \
  response.json

# Invoke version 1 specifically
aws lambda invoke \
  --function-name order-processor:1 \
  response.json

# Invoke version 2 specifically
aws lambda invoke \
  --function-name order-processor:2 \
  response.json
```

This immutability is powerful. You could run version 1 in production while developers iterate on version 2 in a staging environment. If something goes wrong, you're not wondering what code was running—you know exactly which version was executing.

However, hardcoding version numbers in your infrastructure has its own problems. If you want to roll back from version 3 to version 2, you'd need to update every reference to the function, every event source mapping, every environment variable that specifies the function ARN. This is error-prone and operational overhead you don't want.

This is where aliases come in.

### Aliases: Named Pointers to Versions

An alias is simply a named pointer to a Lambda version. Think of it like a bookmark or a DNS record—instead of referring directly to a version number, you reference an alias, and the alias resolves to whichever version you've configured it to point to. The beauty is that you can change which version the alias points to without changing a single line of infrastructure code.

Let's create an alias called `prod` that initially points to version 1:

```bash
aws lambda create-alias \
  --function-name order-processor \
  --name prod \
  --function-version 1 \
  --description "Production alias"
```

Now your production systems can reference the alias:

```bash
# Invoke production
aws lambda invoke \
  --function-name order-processor:prod \
  response.json
```

The ARN looks like: `arn:aws:lambda:us-east-1:123456789012:function:order-processor:prod`

Later, when you publish version 2 and want to promote it to production, you simply update the alias:

```bash
aws lambda update-alias \
  --function-name order-processor \
  --name prod \
  --function-version 2
```

No infrastructure changes. No redeployment of event sources. The alias now points to version 2, and all traffic automatically flows to the new code. If you need to roll back, one command reverts the alias back to version 1.

But here's where it gets really interesting: **aliases support traffic shifting weights**. Instead of moving all traffic instantly, you can have an alias split traffic between two versions using specified percentages.

### Traffic Shifting: Implementing Canary and Linear Deployments

The real power emerges when you configure an alias to split traffic between two versions. This enables canary deployments, where you route a small percentage of traffic to a new version while keeping the majority on the stable version. You watch the metrics of the new version—error rates, latency, custom business metrics—and if everything looks good, gradually increase the traffic. If something goes wrong, you can immediately roll back without impacting most of your users.

Let's say you're confident enough in version 2 to test it with real traffic, but you want to start small. You can update the `prod` alias to send 10% of traffic to version 2 and 90% to version 1:

```bash
aws lambda update-alias \
  --function-name order-processor \
  --name prod \
  --routing-config AdditionalVersionWeight=0.10,FunctionVersion=2 \
  --function-version 1
```

Here's what this means:
- The primary version (specified by `--function-version`) is version 1, which receives 90% of traffic (1.0 - 0.10 = 0.90)
- The additional version is version 2, which receives 10% of traffic (AdditionalVersionWeight=0.10)

From this point forward, when your API Gateway calls the `prod` alias, approximately 10% of invocations go to version 2 and 90% go to version 1. CloudWatch will show separate metrics for each version, so you can monitor whether version 2 is behaving as expected.

After observing metrics for a period and confirming version 2 is solid, you might increase the traffic split to 50/50:

```bash
aws lambda update-alias \
  --function-name order-processor \
  --name prod \
  --routing-config AdditionalVersionWeight=0.50,FunctionVersion=2 \
  --function-version 1
```

Finally, when you're confident, route all traffic to version 2 by removing the routing config:

```bash
aws lambda update-alias \
  --function-name order-processor \
  --name prod \
  --function-version 2
```

If at any point you detect errors spiking, latency increasing, or business metrics degrading, you immediately roll back:

```bash
aws lambda update-alias \
  --function-name order-processor \
  --name prod \
  --function-version 1
```

This is a manual canary deployment. It gives you control and visibility, but it requires you to monitor metrics and make the traffic-shifting decisions yourself. For teams wanting full automation, AWS CodeDeploy takes this pattern further.

### Automated Deployments with CodeDeploy

CodeDeploy is an AWS service that automates application deployments. When used with Lambda, it orchestrates version publishing, alias creation and updates, traffic shifting, and automatic rollback based on CloudWatch alarms. This removes the manual steps and ensures your deployment strategy is consistent and repeatable.

Here's how it works at a high level: you provide CodeDeploy with configuration specifying how you want to deploy (canary, linear, or all-at-once), and it handles the mechanics of publishing versions, updating aliases, and monitoring health.

Let's build a concrete example. First, you need an AppSpec file that describes your deployment. This is a YAML file (typically named `appspec.yaml`) that sits in your repository:

```yaml
version: 0.0
Resources:
  - id: order-processor
    Type: AWS::Lambda::Function
    Properties:
      Name: order-processor
      Alias: prod
      CurrentVersion: !Ref OrderProcessorVersion1
      TargetVersion: !Ref OrderProcessorVersion2
Hooks:
  - BeforeAllowTraffic: pre-traffic-hook
  - AfterAllowTraffic: post-traffic-hook
```

The AppSpec defines which Lambda function to deploy and which alias to update. The hooks are optional Lambda functions that CodeDeploy invokes at specific points—for example, `pre-traffic-hook` might run smoke tests against the new version before allowing traffic to it.

But the more practical way to configure CodeDeploy for Lambda is through the AWS SAM (Serverless Application Model) CLI or directly in your infrastructure-as-code tool. Here's an example using SAM:

```yaml
Transform: AWS::Serverless-2016-10-31
Description: Order Processor with CodeDeploy

Globals:
  Function:
    Runtime: python3.11
    Environment:
      Variables:
        ENVIRONMENT: production

Resources:
  OrderProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: order-processor
      CodeUri: src/
      Handler: index.lambda_handler
      AutoPublishAlias: prod
      DeploymentPreference:
        Type: Canary10Percent5Minutes
        Alarms:
          - !Ref CanaryErrorAlarm
        TriggerConfigurations:
          - DeploymentEventFilter:
              EventTriggerEvents:
                - DeploymentSuccess
                - DeploymentFailure

  CanaryErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: order-processor-canary-errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 2
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref OrderProcessorFunction
```

Let's unpack the key parts:

**AutoPublishAlias**: When you deploy this template, SAM automatically publishes a new version of the function and updates the `prod` alias to point to it.

**DeploymentPreference**: This is where you define your traffic-shifting strategy. `Canary10Percent5Minutes` means:
- Start by routing 10% of traffic to the new version
- Keep it at 10% for 5 minutes
- If no alarms trigger during that window, automatically shift all remaining traffic (90%) to the new version

Other deployment types include:
- `Canary10Percent30Minutes`: 10% for 30 minutes, then 100%
- `Linear10PercentEvery10Minutes`: Increase by 10% every 10 minutes until reaching 100%
- `AllAtOnce`: No gradual rollout, all traffic immediately to the new version
- `Manual`: CodeDeploy publishes the version and updates the alias to the new version, but traffic shifting is manual

**Alarms**: You specify CloudWatch alarms that CodeDeploy monitors during the deployment. If any alarm enters the `ALARM` state, the deployment automatically rolls back to the previous version. In this example, if error count exceeds 5 in a 60-second period during the canary phase, the deployment halts and rolls back.

When you deploy this template:

```bash
sam deploy --guided
```

SAM packages your code, publishes a new Lambda version, updates the `prod` alias to begin the canary deployment, and watches the specified alarms. If the alarm stays healthy for the duration of the canary period, traffic automatically shifts to 100% of the new version. If the alarm triggers, CodeDeploy immediately reverts the alias to the previous version.

This is powerful because it combines the safety of gradual traffic shifting with automated rollback based on objective metrics. You're not hoping things work out—you're measuring the behavior of the new version in production and making data-driven decisions.

### Aliases and Event Source Mappings

One important detail: when you use aliases with event sources like SQS, SNS, DynamoDB Streams, or Kinesis, the event source mapping points to the alias, not a specific version. This means as you update the alias during a deployment, the event source automatically invokes the new version without reconfiguration.

For example, if you have an SQS queue triggering your function:

```bash
aws lambda create-event-source-mapping \
  --event-source-arn arn:aws:sqs:us-east-1:123456789012:orders \
  --function-name order-processor:prod \
  --batch-size 10
```

The event source mapping points to the `prod` alias. When CodeDeploy updates `prod` during a canary deployment, the event source automatically begins invoking the new version as specified by the alias's routing configuration. This is elegant because it means your event infrastructure doesn't require any updates during deployments.

However, there's one caveat: event source mappings cannot use traffic shifting weights. The alias itself supports traffic shifting for direct invocations (like API Gateway), but event source mappings always invoke the primary version of an alias—they ignore the additional version and its weight. This means for event-driven workloads, you're choosing between all-or-nothing promotion or manual canary testing with separate aliases.

To work around this, some teams create separate aliases for canary testing:

```bash
# Current production alias
aws lambda create-alias \
  --function-name order-processor \
  --name prod \
  --function-version 1

# Canary testing alias (same event source configuration, pointing to new version)
aws lambda create-alias \
  --function-name order-processor \
  --name canary \
  --function-version 2
```

You'd then create a second event source mapping pointing to the `canary` alias, sending a portion of traffic to test the new version. Once validated, you update the `prod` alias and remove the `canary` mapping. This is more manual than traffic-weighted aliases but gives you fine-grained control.

### Practical Considerations and Best Practices

When implementing versioning and alias strategies, a few patterns have emerged as particularly effective:

**Use semantic naming for aliases**. Instead of just `prod`, consider `prod-stable` for the currently stable version and `prod-canary` for the version under test. This makes it explicit which version is experimental and which is stable. When everything checks out, promote `prod-canary` to `prod-stable` and repeat.

**Reserve $LATEST for development only**. Don't wire up event sources or production traffic to $LATEST. Always invoke specific versions or aliases. This prevents surprises where someone's local development change accidentally impacts production because both were calling the same $LATEST function.

**Combine aliases with Lambda layers for configuration management**. Use environment variables and configuration files in layers to parameterize behavior between versions. This way, you can test the same code path with different configurations, reducing the number of versions you need to publish.

**Set up CloudWatch alarms before deploying**. Your alarms should measure both technical metrics (error rate, duration, throttles) and business metrics (order processing success rate, payment conversion rate). The more comprehensive your monitoring, the safer your canary deployments. If you're deploying without alarms configured, you're not getting the full benefit of automated rollbacks.

**Keep version history tidy**. You can delete old versions if they're no longer needed, though immutability means you might keep versions around longer than you initially expect—they're useful for debugging. Set a retention policy: keep the last N versions or versions from the last M days.

**Test your rollback procedure**. Before relying on automated rollbacks, manually trigger a rollback during off-hours to confirm the process works as expected. Surprise failures during rollback are worse than the original deployment failure.

### Bringing It All Together

Let's walk through a complete scenario. You have a payment processing Lambda function in production, currently running version 5, pointed to by the `prod` alias. You've been optimizing the code path that calculates discounts, reducing latency by 20% according to your local tests. You want to deploy this to production safely.

First, you deploy your code changes:

```bash
# Update function code
zip function.zip index.py
aws lambda update-function-code \
  --function-name payment-processor \
  --zip-file fileb://function.zip
```

Then you publish a new version (version 6):

```bash
aws lambda publish-version \
  --function-name payment-processor \
  --description "Optimized discount calculation"
```

You confirm your CloudWatch alarms are in place and configured to alert on error spikes. Then, you initiate a canary deployment using CodeDeploy or manual alias update:

```bash
aws lambda update-alias \
  --function-name payment-processor \
  --name prod \
  --routing-config AdditionalVersionWeight=0.10,FunctionVersion=6 \
  --function-version 5
```

Traffic is now split: 90% goes to version 5 (the known-good version), 10% to version 6 (your optimized version). For the next hour, you monitor:

- Error rates: Are errors higher in version 6 than version 5?
- Latency: Is the p99 latency actually lower as expected?
- Business metrics: Are payments processing successfully? Is the conversion rate stable?
- CloudWatch logs: Are there any unexpected exceptions or warnings?

After an hour of clean metrics, you increase the canary to 50/50:

```bash
aws lambda update-alias \
  --function-name payment-processor \
  --name prod \
  --routing-config AdditionalVersionWeight=0.50,FunctionVersion=6 \
  --function-version 5
```

Another hour of monitoring passes without incident. You promote version 6 to 100%:

```bash
aws lambda update-alias \
  --function-name payment-processor \
  --name prod \
  --function-version 6
```

Your optimization is now live to all traffic. If something had gone wrong at any point—say, latency spiked unexpectedly—a single command reverts to version 5:

```bash
aws lambda update-alias \
  --function-name payment-processor \
  --name prod \
  --function-version 5
```

Because version 5 was handling the majority of traffic the entire time, the rollback affects only a small percentage of requests, minimizing impact.

This is the power of versions and aliases: they transform deployments from binary all-or-nothing events into measured, observable, easily-reversible processes.

### Conclusion

Lambda versions and aliases might seem like simple features on the surface—just immutable snapshots and named pointers. But when combined thoughtfully, they enable deployment strategies that give you confidence in production changes. Versions ensure you always know exactly what code is running. Aliases let you manage traffic flow without infrastructure changes. Traffic-weighted aliases enable canary deployments where new code proves itself with real traffic before taking over completely. And integration with CodeDeploy automates the entire process with intelligent rollback based on health metrics.

The result is a deployment experience where you're not afraid to ship frequently, because you know you can roll back instantly if something goes wrong. You're not deploying during off-hours and holding your breath. You're deploying during business hours, watching real metrics, and letting your new code earn the right to handle production traffic.

The next time you're preparing a Lambda deployment, resist the urge to update the function directly and point all traffic at once. Instead, publish a version, update an alias, configure a canary split, and watch your metrics. Your future self—and your on-call rotation—will thank you.
