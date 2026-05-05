---
title: "ASG Instance Refresh: Rolling Out New AMIs and Launch Template Versions"
---

## ASG Instance Refresh: Rolling Out New AMIs and Launch Template Versions

Deploying application updates across a fleet of EC2 instances is one of those tasks that sounds simple until you actually try to do it at scale. You need to get new code or configuration to running instances without causing downtime, and you want the process to be safe, observable, and reversible if something goes wrong. AWS Auto Scaling Groups offer a feature called Instance Refresh that elegantly solves this problem by automating the gradual replacement of instances with updated AMIs or launch template versions.

Whether you're containerizing your application into a new AMI, rolling out security patches, or deploying a major version upgrade, Instance Refresh lets you control the pace of change with safety rails built in. This article walks you through how Instance Refresh works, how to configure it effectively, and when to reach for it versus alternative strategies like blue-green deployments.

### Understanding Instance Refresh and Why It Matters

Instance Refresh is a mechanism within Auto Scaling Groups that allows you to gradually replace all running instances with new ones based on updated launch configuration or launch template details. Rather than manually terminating instances and waiting for the ASG to spin up replacements, you trigger an Instance Refresh operation that orchestrates the entire process according to rules you define.

The power of Instance Refresh lies in its simplicity and safety. Instead of managing a manual process where you might accidentally take too many instances down at once, or forget to drain connections properly, Instance Refresh enforces constraints like minimum healthy percentage and respects lifecycle hooks that your team may have configured for graceful shutdowns.

Consider a practical scenario: your engineering team has built a new version of your application and baked it into a fresh AMI. You have 20 instances running in your ASG, and you can't afford extended downtime. Instance Refresh lets you specify that at least 90% of your instances must remain healthy and in-service while the rollout happens. The ASG will then systematically terminate old instances and launch new ones, one or a few at a time, ensuring your capacity and health requirements are met throughout.

### How Instance Refresh Works Under the Hood

When you initiate an Instance Refresh, the ASG enters a coordinated replacement cycle. Here's the conceptual flow: the ASG identifies all instances that don't match the current launch template or launch configuration. These "out-of-date" instances become candidates for replacement. The service then selects instances to terminate based on the preferences you've set, terminates them, and allows the ASG's desired capacity rules to trigger the launch of new instances based on the updated template.

The key insight is that Instance Refresh doesn't change your ASG's desired capacity or min/max settings. It works within those constraints. If your ASG is configured with a desired capacity of 20 and a minimum of 10, Instance Refresh will ensure that at no point during the refresh cycle do you drop below that minimum healthy count.

The process is driven by two main parameters: the minimum healthy percentage and the instance warmup period. The minimum healthy percentage defines what fraction of your instances must remain healthy and in-service at all times during the refresh. An instance is considered healthy if it passes the ASG's health checks and is not in a state of being terminated. The instance warmup period is a grace period after a new instance launches during which the ASG doesn't consider it for termination, allowing it time to initialize, run startup scripts, and begin serving traffic.

### Configuring Instance Refresh Parameters

Getting Instance Refresh right means understanding and tuning its configuration options. Let's examine the most important ones.

The **minimum healthy percentage** is perhaps the most critical setting. If you set this to 100%, the ASG will never have fewer than the current desired capacity of healthy instances running. This means it will actually grow temporarily to accommodate new instances launching before old ones are terminated. If you set it to 75%, the ASG will allow the number of healthy instances to dip to 75% of the desired capacity during the refresh, which means the old instances can be terminated before new ones fully initialize. The trade-off is between safety (higher percentage means less disruption) and speed (lower percentage means faster rollout).

For most production workloads, a minimum healthy percentage between 85% and 95% strikes a good balance. You maintain nearly full capacity while still allowing the refresh to proceed at a reasonable pace. If you're running a less critical service or a non-production environment, you might go lower to speed things up.

The **instance warmup period** tells the ASG how long to wait after launching a new instance before considering it fully healthy and available for receiving traffic. This is distinct from the ASG health check grace period—it's specifically about the Instance Refresh process. During the warmup period, the instance is launching but not yet being counted toward your minimum healthy instance count for the purposes of terminating old instances. This gives your application time to start up, connect to databases, warm up caches, and reach a state where it can safely serve traffic.

If your application takes 5 minutes to fully initialize, set the instance warmup to something like 5-6 minutes. If you set it too low and terminating old instances begins while new ones are still booting, you could briefly lose capacity. If you set it too high, your refresh will be unnecessarily slow.

Another important option is the **instance warmup strategy**, which can be set to either use the ASG's default health check grace period or use a custom warmup period just for Instance Refresh. This flexibility is useful when your startup time varies or when you want different behavior during a refresh compared to normal scaling operations.

You can also specify **preferences** around which instances to replace first. By default, the ASG uses a "preference order" that generally terminates instances as they age, but you can customize this if needed.

### Using Instance Refresh with Lifecycle Hooks

Lifecycle hooks are a powerful AWS feature that lets you pause instances during termination or launch so that custom logic can run. When combined with Instance Refresh, lifecycle hooks ensure graceful application shutdowns, allowing in-flight requests to complete before an instance is fully terminated.

Imagine you're running a web service where requests might take several seconds to complete. If you simply terminate an instance mid-request, you'll lose work. Instead, you can configure a termination lifecycle hook that sends a signal to your application: "I'm about to shut down, please stop accepting new connections and drain existing ones."

Here's how this works in practice with Instance Refresh:

1. Instance Refresh selects an instance for termination
2. The ASG places the instance in the `Terminating:Wait` state and invokes your termination lifecycle hook
3. Your application receives a notification (via EC2 user data script, custom agent, or SNS message) to begin graceful shutdown
4. Your application stops accepting new requests, finishes existing ones, and signals completion
5. The lifecycle hook timeout expires or your signal completes, moving the instance to `Terminating:Proceed`
6. The instance is fully terminated

The beauty of this integration is that Instance Refresh respects the entire lifecycle hook process. The ASG won't consider the instance "replaced" until the hook completes. This means your minimum healthy percentage calculations account for the time instances spend draining.

A practical example: you might have a script that sends a signal to your application through an HTTP endpoint:

```bash
#!/bin/bash
# Called when instance receives termination notification
curl -X POST http://localhost:8080/shutdown

# Wait for graceful shutdown (with timeout)
timeout 30 bash -c 'while curl -s http://localhost:8080/health; do sleep 1; done'
```

Configure this as a termination lifecycle hook action, and your application will have up to 30 seconds to gracefully wind down during Instance Refresh operations. The ASG will wait for this process to complete before terminating the instance.

### Monitoring Instance Refresh Progress

Instance Refresh operations can take minutes to hours depending on your configuration and fleet size. Observing progress and understanding what's happening is critical for confidence in the deployment.

The AWS Console provides a straightforward view: navigate to your ASG, select the "Instance Refresh" tab, and you'll see the active refresh operation if one is running. The display shows the percentage of instances that have been replaced, how many are currently being replaced, and estimates for completion time.

For more programmatic monitoring, the AWS CLI and SDKs expose detailed information. You can describe an ASG's instance refresh status:

```bash
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name my-web-app-asg \
  --query 'InstanceRefreshes[0]'
```

This returns rich details including the start time, current percentage progress, instances that have been successfully replaced, the status (e.g., `Pending`, `InProgress`, `Successful`, `Failed`), and the preferences that are being applied.

CloudWatch also integrates with Instance Refresh. You can set up alarms on the number of instances that have been replaced or the remaining count. More importantly, you should be watching the actual application metrics during a refresh: request latency, error rates, and throughput. A well-executed Instance Refresh should be invisible to your users—error rates shouldn't spike, and latency should remain steady. If you see degradation, you need to know immediately.

### Handling Failures and Rollback Behavior

What happens when an instance replacement fails? The Instance Refresh operation has built-in safeguards to prevent a bad deployment from cascading across your entire fleet.

If a newly launched instance fails to pass health checks, the ASG won't mark the refresh as having successfully replaced an instance. Instead, it retries according to your retry policy. By default, if an instance fails health checks consistently, the refresh may be marked as `Failed` after exceeding retry attempts.

Here's the important part: Instance Refresh doesn't automatically roll back. If you've replaced 50% of your fleet and the refresh fails, those 50% are still running the new AMI. This is actually by design—it prevents cascading failures where a rollback would cause another wave of terminations and launches.

If you need to recover from a failed refresh, you have options:

**Option 1: Trigger a new refresh with the old launch template.** This works well if you've diagnosed a problem with the new AMI and want to revert. Update your ASG's launch template back to the previous version and initiate a new Instance Refresh. This will gradually replace the new instances with old ones.

**Option 2: Manually terminate instances.** If only a small number of instances have been replaced, you can manually terminate them. The ASG will launch new instances based on the current launch template, which effectively is a manual rollback.

**Option 3: Keep the new instances and debug.** If the refresh failed due to a health check misconfiguration rather than an actual problem with the new AMI, you can fix the health check and resume or restart the refresh.

The key takeaway is that Instance Refresh is conservative: it stops when something goes wrong rather than continuing to roll out bad instances. This makes it suitable for production environments where safety is paramount.

### Comparing Instance Refresh to Blue-Green Deployments

A common question is: when should I use Instance Refresh versus a blue-green deployment strategy using separate ASGs?

Instance Refresh is simpler and more cost-efficient for most cases. You maintain a single ASG and gradually replace instances. During the refresh, your total capacity might temporarily exceed desired capacity (depending on your minimum healthy percentage), but you're not running two full fleets in parallel.

Blue-green deployments with separate ASGs are powerful when you need:

**Complete separation between old and new.** With blue-green, your entire "green" environment is fully stood up and verified before any traffic is switched. This is valuable for major upgrades where you want extensive validation before switching.

**Instant rollback capability.** Blue-green deployments allow you to switch traffic back to the blue environment in seconds if issues are detected. With Instance Refresh, partially replaced instances mean rollback requires a separate refresh operation.

**Zero downtime for database schema changes.** If your new application version requires database schema changes that are incompatible with the old version, blue-green lets you migrate the schema and test with the new app before switching. Instance Refresh happens concurrently with running instances, so backward compatibility is necessary.

**A/B testing and gradual traffic shifts.** Some organizations use blue-green with load balancer rules or weighted routing to shift a percentage of traffic to green while blue is still receiving traffic. This enables canary deployments and feature flags at the infrastructure level.

In contrast, Instance Refresh excels when:

**You need simplicity.** No need to manage two ASGs, two security group configurations, or two sets of load balancer target groups.

**Your application is reasonably compatible.** If your new AMI can coexist with old instances for a brief period and handle rolling updates, Instance Refresh is ideal.

**Cost is a concern.** You're not doubling your infrastructure during the deployment.

**You're deploying frequently.** Instance Refresh is so lightweight that it's practical to use multiple times a day for routine deployments.

Many organizations use both strategies: Instance Refresh for routine updates and bug fixes, and blue-green for major releases or high-risk changes.

### Practical Example: Rolling Out a New Application Version

Let's walk through a realistic scenario to tie everything together.

You have an ASG called `production-api-asg` with a desired capacity of 10 instances, min of 8, max of 15. Your application is packaged in an AMI, and your team has just built a new version. You've baked it into a new AMI (`ami-newversion123`), and you've updated your launch template to reference this new AMI.

You want to roll this out safely with the following requirements:
- Never drop below 8 running instances (your minimum)
- Perform a gradual rollout so you can monitor application behavior
- Allow instances 5 minutes to initialize before assuming they're healthy
- Gracefully drain existing connections before terminating instances

First, you ensure your termination lifecycle hook is configured. Your application has a `/shutdown` endpoint that stops accepting requests and waits for in-flight requests to complete.

Then, you initiate the Instance Refresh:

```bash
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name production-api-asg \
  --preferences MinHealthyPercentage=90,InstanceWarmupSeconds=300
```

The ASG springs into action. With a minimum healthy percentage of 90% and desired capacity of 10, it must maintain at least 9 healthy instances at all times. Here's what happens:

1. A new instance launches with the new AMI. Total instances: 11 (10 running + 1 initializing)
2. The new instance initializes for 5 minutes (the warmup period)
3. After 5 minutes, the warmup expires and the instance is considered fully healthy
4. The ASG selects an old instance for termination. It triggers the termination lifecycle hook
5. The old instance receives the shutdown notification and gracefully drains connections
6. After the instance finishes draining (or after a timeout), it's terminated

Steps 1-6 repeat, gradually replacing instances. The operation status shows progress:

```bash
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name production-api-asg
```

Returns something like:

```json
{
  "InstanceRefreshes": [
    {
      "InstanceRefreshId": "08b91cf7-8fa8-48aaaa09-8e84-50dd8e80c526",
      "Status": "InProgress",
      "StartTime": "2024-01-15T14:23:00Z",
      "PercentageComplete": 40,
      "InstancesToUpdate": 6,
      "Preferences": {
        "MinHealthyPercentage": 90,
        "InstanceWarmupSeconds": 300
      }
    }
  ]
}
```

Throughout the refresh, you're monitoring your application's CloudWatch metrics. Request latency remains steady. Error rates stay flat. The update is proceeding invisibly to your users. After about 50 minutes (accounting for warmup time and graceful drain time for each instance), the refresh completes. All 10 instances are now running the new AMI.

If anything had gone wrong—say, the new version had a bug causing frequent crashes—you would have seen health check failures. After a few retries, the refresh would have stopped with a `Failed` status, having replaced only a portion of your fleet. You could then roll back by updating the launch template to point to the old AMI and starting a new refresh.

### Best Practices for Instance Refresh Deployments

Armed with understanding of how Instance Refresh works, here are practices that will serve you well in production:

**Test your AMI thoroughly before deployment.** Instance Refresh will roll out problems at scale quickly. Validate your new AMI in a non-production ASG first, or at minimum run it in a single instance and observe behavior for several minutes.

**Set instance warmup appropriately.** Err on the side of generosity. If your application takes 3 minutes to start, set warmup to 4-5 minutes. A slightly slower refresh is better than a refresh that terminates instances before new ones are ready.

**Use lifecycle hooks for graceful shutdown.** This is especially important for stateful applications or those with long-running requests. Even a 30-second drain window can prevent data loss and user-visible errors.

**Monitor during refresh operations.** Don't initiate a refresh and then ignore it. Watch your application metrics, especially error rates and latency. If something is wrong, you'll want to catch it early, potentially after just a few instances have been replaced.

**Start with lower minimum healthy percentages in non-production.** If you're unsure how your application handles Instance Refresh, test with a 70% minimum healthy percentage first. Once you've validated the process, increase it to 90% or higher for production.

**Document your refresh strategy.** Make sure your team knows whether you use Instance Refresh, blue-green deployments, or a hybrid approach. Include refresh preferences in your infrastructure documentation.

**Consider automated triggers.** Once you're confident in your process, you can automate Instance Refresh initiation based on pipeline events. This keeps deployments consistent and reduces manual work.

### Conclusion

Instance Refresh is a mature, production-tested feature that removes the operational burden from rolling out updates across your Auto Scaling Group. By orchestrating the replacement of instances according to configurable safety constraints, Instance Refresh enables safe, observable, and efficient deployments of new AMIs and launch template versions.

The key to using it effectively is understanding its parameters—minimum healthy percentage and instance warmup—and integrating it with your application's capabilities, particularly lifecycle hooks for graceful shutdown. Combined with proper monitoring and a clear understanding of when to use Instance Refresh versus alternative strategies like blue-green deployments, you have a powerful tool for managing immutable infrastructure at scale.

Whether you're deploying multiple times a day or orchestrating rare major upgrades, Instance Refresh lets you focus on the application rather than the mechanics of getting new code to production.
