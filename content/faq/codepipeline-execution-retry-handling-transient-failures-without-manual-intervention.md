---
title: "CodePipeline Execution Retry: Handling Transient Failures Without Manual Intervention"
---

## CodePipeline Execution Retry: Handling Transient Failures Without Manual Intervention

Imagine you've deployed a robust CI/CD pipeline using AWS CodePipeline that handles your organization's deployment process flawlessly—most of the time. Then one day, a temporary network blip causes your deployment action to fail. Your pipeline stops cold. Someone has to manually investigate, confirm it was just a transient hiccup, and re-run the failed stage. Multiply this across dozens of teams and hundreds of deployments, and you've got a serious productivity drain.

This is where CodePipeline's retry capability becomes invaluable. Rather than treating every failure as a showstopper, you can configure your pipeline to automatically retry failed actions with a configurable number of attempts and delays between retries. This article explores how to harness retries effectively, understand the mechanics of how they work with your pipeline's state, and know when retries are the right tool versus when you need a different approach.

### Understanding CodePipeline Retries: The Fundamentals

CodePipeline's retry feature allows individual actions within a stage to automatically re-execute when they fail, without requiring manual intervention or re-running the entire stage from scratch. This is particularly powerful because it targets transient failures—the kind of temporary glitches that happen in distributed systems: a service briefly unavailable, a network timeout, rate limiting from an external API, or a resource temporarily in an unhealthy state.

Think of it as your pipeline's built-in resilience layer. Instead of failing loudly and stopping everything, the action tries again. And again, if needed, until either it succeeds or exhausts its retry budget.

The core configuration is straightforward: you define two parameters per action. The first is the number of retry attempts—how many times the action should try after the initial failure. The second is the failure retry delay, measured in seconds—how long to wait between each retry attempt. These settings give you granular control over how aggressively your pipeline pursues recovery from transient issues.

What makes this powerful is that retries happen automatically without code changes, without restarting the pipeline, and without losing the artifacts that have flowed through previous stages. The action simply picks up where it left off and tries again.

### Configuring Retry Settings on Actions

When you define an action in a CodePipeline stage, you'll find the retry configuration options in the action details. Let's walk through what these actually mean in practice.

The retry attempts parameter specifies how many times the action will re-execute after an initial failure. If you set this to 2, the action will fail once, retry, fail again if needed, and then retry one more time. So it attempts execution up to three times total: one initial try plus two retries. If all three attempts fail, the action fails permanently and the pipeline stops at that stage (unless you've configured a failure action, which we'll touch on later).

The failure retry delay parameter determines how many seconds CodePipeline waits before attempting the next retry. If you set this to 30, the pipeline will wait 30 seconds between each retry attempt. This delay serves multiple purposes: it gives the underlying service time to recover from whatever transient issue caused the failure, it prevents your pipeline from hammering a service that's already struggling, and it respects backoff patterns that many AWS services expect.

Consider a practical scenario: you have a deployment action that invokes an external API to provision resources. That API occasionally experiences brief outages lasting 10–20 seconds. You might configure that action with 3 retry attempts and a 30-second delay. The first attempt fails. The pipeline waits 30 seconds—during which the API recovers. The second attempt succeeds. The pipeline continues without anyone noticing the hiccup.

Different action types support retry configuration, though not all of them do. Deploy actions (CloudFormation, AppConfig, ServiceCatalog), Invoke actions (Lambda), Test actions, and Build actions (CodeBuild) all support retries. Source and artifact retrieval actions generally do not, as there's typically nothing transient about a code repository being unavailable or an artifact not existing. When you're setting up an action, the AWS Management Console will show you whether that particular action type supports retry configuration.

### How Retries Interact with Pipeline State and Artifacts

One of the most important aspects of retries to understand is how they preserve your pipeline's state and artifacts. This is not the same as re-running an entire stage or pipeline from the beginning.

When a retry occurs, the artifacts that were produced by earlier stages remain intact and available. If your Source stage checked out code, that code artifact is still there. If your Build stage compiled and packaged that code, the build artifact is still available. When the failed action retries, it consumes those same artifacts without any need to re-fetch source code or rebuild from scratch. This efficiency is crucial because it means retries are fast—you're not repeating work that already succeeded.

This has important implications for how you design your pipeline logic. Imagine you have a deployment action that provisions infrastructure and then configures an application. On the first attempt, infrastructure provisioning fails due to a transient API timeout. The action retries, infrastructure is successfully created, and the configuration step runs. From the pipeline's perspective, this looks exactly like a successful single execution—the action either succeeds or fails, and everything downstream depends on that outcome. There's no replay of just the infrastructure part or just the configuration part; the entire action executes again.

This is different from what some teams might expect. The retry happens at the action level, not at the logical operation level within the action. If your action is a CloudFormation stack update, it doesn't retry just the problematic resource creation; it retries the entire stack update. This is usually fine because CloudFormation is smart about idempotency—updating a stack again after it partially failed is generally safe. But it's something to be aware of, especially if your action has side effects.

The artifact handling is particularly important when you have multiple actions within a stage, or multiple stages in sequence. Because retries don't re-run earlier stages, they preserve the strict ordering of your pipeline. A later stage always operates on artifacts from a previously successful execution of earlier stages. This prevents the confusing situation where different parts of your pipeline are working with artifacts from different commits or builds.

### Action-Level Retry Behavior and Failure Handling

The retry mechanism operates at the action level, which gives you fine-grained control but requires understanding how retries interact with other failure handling options.

Each action in a CodePipeline stage can be configured with a failure action: either Abort (stop the entire pipeline) or Continue (proceed to the next action in the stage even if this one fails). Retries happen before these failure actions are evaluated. In other words, the pipeline will exhaust all retry attempts before deciding whether to abort or continue.

This creates a logical flow: an action executes, fails, and then CodePipeline checks whether it should retry. If retries remain, it waits the specified delay and tries again. If the action eventually succeeds after a retry, the failure action is never invoked—the action is considered successful. If the action fails after all retries are exhausted, then the failure action applies: either the entire pipeline stops, or that specific action's failure is ignored and the pipeline continues with other actions in the stage.

This logic is crucial to understand when configuring your pipeline. If you have an action with 2 retries and a Continue failure action, the pipeline will attempt that action up to 3 times. If all three fail, the pipeline ignores the failure and continues with the next action. If you have the same settings but with an Abort failure action, the pipeline will attempt up to 3 times, but if all fail, the entire pipeline stops. The difference is what happens after retries are exhausted.

### When to Use Retry vs. Abort and Manual Restart

Deciding whether to implement retry logic, or to let failures stop the pipeline and handle them manually, is a design decision that depends on the nature of your actions and the transient failures you're likely to encounter.

Retries shine when you're dealing with infrastructure service timeouts, rate limiting from external APIs, or temporary resource unavailability. These are problems that often resolve themselves within seconds or minutes. A build service briefly overloaded, a deployment service momentarily experiencing API throttling, or a network hiccup—these are ideal candidates for automatic retry. You configure retries to give the system time to recover, and most of the time, the pipeline continues without anyone lifting a finger.

There are scenarios, however, where retries are inappropriate or counterproductive. If your action is failing because of a code error—a deployment template with invalid syntax, a test suite with failing assertions, or malformed configuration—retries won't help. Trying the same thing three times when it's fundamentally broken is just wasting time. These are "hard failures" that require code changes and a new deployment.

Similarly, if your action is failing because of a resource constraint that won't resolve quickly—like insufficient capacity in a region, or hitting an account service quota—retries might consume your retry budget without any benefit. You need to address the underlying constraint.

Another consideration is external dependencies. If your action calls out to a third-party service that's down due to an incident, retries might not help unless you expect the service to be back online within the retry window. You might succeed in automatically recovering from a five-second blip, but not from a sustained hour-long outage. Think about your expected failure scenarios and whether they're truly transient.

The cost-benefit analysis also matters. Every retry attempt takes time. If you configure a 60-second delay between retries and set 3 retries, you're potentially adding 120 seconds to your pipeline execution in the worst case. For some teams, this is an acceptable trade-off to avoid a single manual restart. For others, especially if failures are rare, the added latency might outweigh the convenience.

A practical guideline: use retries for actions that are prone to transient failures and where the cost of a brief delay is acceptable. Typically this includes deployment actions, external service invocations, and infrastructure-provisioning steps. Be more conservative with test actions, since a failed test usually indicates a real problem worth investigating immediately rather than retrying.

### Configuring Retries Through the AWS Console and Infrastructure as Code

Setting up retries is straightforward through the AWS Management Console. When you create or edit an action in a pipeline, you'll find a "Retry settings" section (the exact location varies slightly depending on the action type). You specify the number of retry attempts (0–5) and the failure retry delay in seconds (typically 1–3600). Set your values based on what makes sense for that particular action.

If you're managing your pipeline through infrastructure as code, which is the recommended approach for production pipelines, you'll define retries in your pipeline definition. Using AWS CloudFormation, the configuration appears in the action properties:

```yaml
Actions:
  - Name: DeployAction
    ActionTypeId:
      Category: Deploy
      Owner: AWS
      Provider: CloudFormation
      Version: '1'
    Configuration:
      StackName: my-stack
      TemplatePath: build::template.yaml
      Capabilities: CAPABILITY_IAM
    RetryConfiguration:
      RetryAttempts: 2
      FailureRetryDelay: 30
```

If you're using the AWS CDK, the syntax is similarly clean:

```typescript
new codepipeline.Pipeline(this, 'MyPipeline', {
  stages: [
    {
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'DeployStack',
          stackName: 'my-stack',
          templatePath: sourceOutput.atPath('template.yaml'),
          retryAttempts: 2,
          retryDelay: cdk.Duration.seconds(30),
        }),
      ],
    },
  ],
});
```

The consistency across these approaches—console, CloudFormation, CDK—makes it easy to implement retries however you manage your infrastructure. The key is choosing settings that match your expectations about what failures you'll encounter and how long they'll last.

### Monitoring and Observing Retry Behavior

While retries happen automatically, it's important to monitor whether they're actually helping, or if your pipeline is experiencing so many failures that retries are becoming a band-aid on a deeper problem.

CloudWatch Events is the primary tool for observing CodePipeline behavior, including retries. CodePipeline emits events whenever an action changes state—when it starts, succeeds, fails, or is retried. By setting up CloudWatch Events rules and sending these events to CloudWatch Logs, SNS, or other destinations, you can track retry patterns across your pipelines.

A typical CloudWatch Events rule for CodePipeline looks like this: match events where the source is "aws.codepipeline" and the detail-type is "CodePipeline Action State Change". This captures every state transition for every action. You can filter further to specific pipelines, stages, or action names. By routing these events to CloudWatch Logs and querying them, you can build a picture of which actions are failing and retrying most frequently.

CloudWatch Logs Insights is particularly useful here. A query like:

```
fields @timestamp, detail.action, detail.state, detail.result
| filter detail.action = "DeployAction" and detail.state = "FAILED"
| stats count() by detail.action
```

will show you how many times your DeployAction failed over a time period. If you see high failure rates, it suggests either that your retry configuration is helping recover from transient issues, or that you have a persistent problem that retries can't solve.

You can also create CloudWatch alarms based on these patterns. For example, if an action fails more than 10 times in an hour, that's a signal that retries aren't helping and you should investigate the underlying cause. Setting up alarms ensures that persistent failures don't go unnoticed just because retries are silently handling transient blips.

The CodePipeline console also provides visibility into execution history. When you view a specific pipeline execution, you can see each action's status and, if an action was retried, the console will show the retry history. This is useful for post-mortem analysis—understanding whether a pipeline recovered automatically via retries, or whether it ultimately failed.

### Common Retry Patterns and Best Practices

Based on how teams typically use retries, several patterns have emerged as effective.

For deployment actions (CloudFormation, CodeDeploy, AppConfig), a common configuration is 2–3 retries with a 30–60 second delay. Deployments can fail for transient reasons like brief service unavailability or rate limiting, and waiting a minute often allows the service to recover. Three attempts provides a good balance between resilience and not wasting too much time.

For external API invocations (Lambda actions that call out to third-party services), consider 3–5 retries with a shorter delay, perhaps 10–15 seconds. These actions are more prone to transient network hiccups and rate limiting, and a shorter delay avoids excessive waiting while still giving the service time to recover.

For test actions (CodeBuild running unit tests), retries are generally unnecessary. Test failures almost always indicate real problems. However, if your tests depend on external services that occasionally flake (like a test database that briefly goes offline), you might configure 1–2 retries with a short delay to handle those rare cases.

For source actions, don't configure retries. If your repository is unavailable, retrying won't help. This is a configuration or connectivity problem that needs investigation, not automatic recovery.

A best practice across all retry configurations is to monitor the results and adjust based on what you observe. If you configure retries but never actually see them being used, you might be over-engineering your pipeline. If you see retries being used frequently, investigate whether the underlying issues are truly transient or if there's a persistent problem you should address.

Another best practice is to avoid retry configurations that create excessively long pipelines. A pipeline with many retries and long delays might eventually succeed, but it could take hours. For some workflows this is acceptable; for others, where you want rapid feedback, it defeats the purpose. Think about your stakeholders' expectations. If you're deploying to production and developers expect feedback within 15 minutes, a pipeline that might take 45 minutes due to retries might not be appropriate.

### Troubleshooting Retries That Aren't Working

Sometimes teams configure retries expecting them to help, but find that pipelines still fail without trying again. The most common reason is that the action type doesn't support retries. While many action types do, some don't. If you've configured retries on an unsupported action type, they'll be silently ignored.

Another possibility is that the action is failing with a type of error that CodePipeline doesn't consider retryable. Some failures are "permanent"—they indicate a configuration error or a missing resource—and CodePipeline won't retry them. The service makes intelligent decisions about which failures merit retry and which don't. For example, if a Lambda action fails because the Lambda function doesn't exist, retrying won't help; CodePipeline recognizes this and fails immediately without consuming retries.

You can check whether an action supports retries and whether retries are actually being used by examining the pipeline execution details in the console. Each action shows its state (whether it's being retried) and any relevant error messages. The execution history for an action will also show if retries occurred.

If you suspect retries aren't working as expected, start by confirming that your action type supports retries, that you've actually configured them in your pipeline definition, and that the action is failing with a transient error. Then monitor execution history to see if retries are being invoked.

### Retry Interactions with Other Pipeline Features

Retries don't exist in isolation; they interact with other CodePipeline features in ways worth understanding.

When you have a stage with multiple parallel actions, retries on one action don't affect the others. If Action A is retrying, Action B in the same stage will wait for Action A to complete (successfully or after exhausting retries) before proceeding to the next stage. This means your stage execution time is determined by the slowest action, including any retry delays.

If you have a failure action configured to Continue, and an action fails after exhausting retries, the Continue behavior applies—other actions in the stage proceed as normal. This is useful for stages where some actions are optional or where a failure in one area shouldn't block an entire deployment.

Retries also interact with manual approvals. If your pipeline has an approval action and the preceding action is retrying, the approval won't appear until the preceding action has succeeded or failed completely. This is important to remember if you have stages where manual approval is required—retries might delay approval requests.

When you manually stop a pipeline execution, any in-flight retries are cancelled. The pipeline doesn't continue retrying; it stops immediately. This is useful if you realize a failure is persistent and doesn't warrant automatic recovery.

### Deciding Between Retry Mechanisms

Beyond CodePipeline's action-level retries, you have other options for handling failures, and knowing when to use each is important.

Some action types (like Lambda) allow you to configure retries within the action itself. For example, a Lambda function can be invoked through an SDK with retry logic built into the function code. At first glance, this might seem redundant with CodePipeline retries. The distinction is important: CodePipeline retries are configured at the pipeline level and provide a safety net for action invocations that fail. Function-level retries are configured in your code and might apply to specific operations within the function. In general, use CodePipeline retries for transient action failures, and code-level retries for specific operations within your code that might have transient issues.

For AWS service integrations, many AWS services (like SQS, DynamoDB) have built-in retry logic. You don't need to configure retries in CodePipeline for these; the services themselves handle transient failures. Again, CodePipeline retries are a separate safety net at the action level.

Some teams implement custom retry logic using Lambda actions and state machines, giving them fine-grained control over retry behavior. This is appropriate when you need complex retry logic that CodePipeline's simple configuration doesn't support. But for most use cases, CodePipeline's built-in retries are sufficient and simpler to maintain.

### Conclusion

CodePipeline's retry capability transforms how you handle transient failures in your CI/CD workflows. Rather than designing pipelines that fail on every hiccup and require manual restart, you can configure automatic retry logic that gives services time to recover while preserving your pipeline's state and artifacts.

The key to using retries effectively is understanding which failures are truly transient and worth retrying, configuring appropriate delays and attempt counts for each action type, and monitoring your pipelines to confirm that retries are providing value rather than just hiding underlying problems.

By thoughtfully implementing retries alongside good monitoring and observability practices, you create pipelines that are resilient to the inevitable blips of distributed systems while remaining fast and feedback-rich for your development teams. This is the balance that mature, production-grade CI/CD automation achieves.
