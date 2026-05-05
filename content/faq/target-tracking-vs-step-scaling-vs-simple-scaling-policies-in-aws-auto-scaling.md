---
title: "Target Tracking vs Step Scaling vs Simple Scaling Policies in AWS Auto Scaling"
---

## Target Tracking vs Step Scaling vs Simple Scaling Policies in AWS Auto Scaling

Scaling your application infrastructure manually is impractical. You need policies that respond intelligently to demand, adjusting capacity without human intervention. AWS Auto Scaling provides three distinct reactive scaling policy types, each with its own strengths, weaknesses, and best-fit scenarios. Understanding the differences between target tracking, step scaling, and simple scaling is crucial for building responsive, cost-efficient applications on AWS.

The stakes are real. A poorly chosen scaling policy can leave your application starved for resources during traffic spikes or hemorrhaging money during quiet periods. Conversely, the right policy choice creates a self-healing infrastructure that grows and shrinks with your actual demand. Let's explore each approach in depth and build a mental model for selecting the right one for your workload.

### Understanding the Foundation: How Scaling Policies Work

Before diving into the three policy types, let's establish a common understanding. All scaling policies operate reactively—they monitor CloudWatch metrics and trigger scaling actions when those metrics breach defined thresholds. When a policy decides to scale, it sends an instruction to your Auto Scaling group to launch or terminate instances.

The critical difference between the three policy types lies in *how* they interpret metrics and *how* they handle consecutive breaches. Simple scaling is the oldest approach and the most literal. Step scaling introduces sophistication by understanding the *magnitude* of a metric breach. Target tracking, the newest and AWS-recommended approach, inverts the problem entirely—you specify a desired metric value, and the policy figures out the scaling math for you.

Each policy type integrates with CloudWatch alarms, but the relationship varies significantly. Let's examine each one.

### Simple Scaling: The Original, Straightforward Approach

Simple scaling is the granddaddy of AWS Auto Scaling policies. It operates on a straightforward principle: when a metric exceeds your threshold, scale up by a fixed number of instances; when it falls below another threshold, scale down. If you've worked with Auto Scaling for any length of time, you've likely encountered it.

Here's how simple scaling works in practice. You create two CloudWatch alarms: one that triggers when your metric goes high (say, CPU utilization above 70%), and another that triggers when it goes low (say, CPU utilization below 30%). Each alarm is linked to a scaling action—the high alarm might add two instances, while the low alarm might remove one.

The defining characteristic of simple scaling is the **cooldown period**. This is a waiting period, measured in seconds, that prevents the same policy from triggering again immediately after a scaling action completes. The cooldown exists to avoid thrashing—where rapid successive scaling actions destabilize your infrastructure and waste resources.

Consider this scenario: your application experiences a traffic spike. CPU shoots up to 85%, triggering your scale-up alarm. Simple scaling adds two instances. But before those instances are fully initialized and begin handling traffic, the cooldown period kicks in. Even if CPU remains at 85%, no additional scaling actions will occur until the cooldown expires (typically 300 seconds by default). This prevents a cascade of duplicate scaling actions.

Here's a basic JSON configuration for a simple scaling policy:

```json
{
  "AdjustmentType": "ChangeInCapacity",
  "MetricAggregationType": "Average",
  "Cooldown": 300,
  "StepAdjustments": [
    {
      "MetricIntervalLowerBound": 0,
      "ScalingAdjustment": 2
    }
  ]
}
```

The `Cooldown` parameter is the key differentiator here. It applies to the entire Auto Scaling group after any scaling activity triggered by this policy. While the cooldown is active, no other simple scaling policies on the group will execute, regardless of metric values. This blunt-force approach is effective for preventing runaway scaling but can slow response time during sustained high demand.

Simple scaling shines in predictable, stable workloads where demand changes gradually. If your traffic grows slowly and steadily, the cooldown prevents unnecessary churn. However, in bursty, unpredictable workloads, simple scaling's rigidity becomes a liability. You're forced to choose between a cooldown so short that it risks instability or so long that it causes delayed responses to demand changes.

### Step Scaling: Intelligent, Graduated Responses

Step scaling represents a significant leap in sophistication. Instead of a single scaling action triggered by a threshold breach, step scaling defines *multiple* scaling steps based on the *magnitude* of the breach. The farther the metric deviates from your threshold, the more aggressively you scale.

This is where the concept of *steps* becomes literal. You define bands of metric values, and each band maps to a different scaling adjustment. When the metric breaches into a particular band, that band's scaling action executes.

Imagine your CPU threshold is set at 70%. With step scaling, you might define:
- CPU between 70% and 80%: add 1 instance
- CPU between 80% and 90%: add 3 instances
- CPU above 90%: add 5 instances

This graduated response means your infrastructure reacts proportionally to how "hot" things really are. A modest surge triggers a modest adjustment; a severe surge triggers aggressive scaling.

Here's a concrete JSON configuration for step scaling:

```json
{
  "AdjustmentType": "ChangeInCapacity",
  "MetricAggregationType": "Average",
  "StepAdjustments": [
    {
      "MetricIntervalLowerBound": 0,
      "MetricIntervalUpperBound": 10,
      "ScalingAdjustment": 1
    },
    {
      "MetricIntervalLowerBound": 10,
      "MetricIntervalUpperBound": 20,
      "ScalingAdjustment": 3
    },
    {
      "MetricIntervalLowerBound": 20,
      "ScalingAdjustment": 5
    }
  ]
}
```

In this example, `MetricIntervalLowerBound` and `MetricIntervalUpperBound` define the deviation from your alarm threshold in percentage points. If your target is 70% CPU and actual CPU is 75%, the deviation is 5 percentage points—which falls in the first step, triggering a scale-up by 1 instance.

A crucial advantage of step scaling over simple scaling is its handling of consecutive alarm breaches. While simple scaling enforces a cooldown period that prevents *any* scaling action from the same policy during the cooldown window, step scaling does not have a mandatory cooldown. Instead, it can respond to new alarms even while the previous scaling action is in progress. This means if your metric continues climbing during a scale-up operation, step scaling can immediately trigger a more aggressive adjustment without waiting.

To prevent completely unbounded scaling, step scaling still supports cooldown, but it's optional and typically much shorter (or absent entirely). The metric-driven logic provides the natural governor instead of a crude time-based lockout.

Step scaling excels in scenarios with variable, spikey demand. If your application experiences unpredictable bursts, step scaling's graduated response prevents both under-scaling (responding too timidly to severe load) and over-scaling (throwing excessive capacity at small load increases). It's particularly valuable when the cost of over-provisioning is high, because it lets you match capacity more precisely to actual demand.

However, step scaling requires more upfront configuration. You must define your steps, which means understanding your workload's response curve. How many additional instances do you need when CPU jumps 10 percentage points versus 20? This demands analysis and tuning.

### Target Tracking: The Modern, Hands-Off Approach

Target tracking represents a paradigm shift. Instead of you defining thresholds and scaling steps, you specify a *desired metric value*—the target—and let AWS handle the math. It's like telling your infrastructure "keep my CPU at 50%" and letting the system figure out how many instances that requires.

AWS actually implements target tracking by creating two CloudWatch alarms behind the scenes: one for scale-up and one for scale-down. But you never see or manage them directly. You simply set your target and specify how aggressively to scale (via scaling parameters).

Here's what a target tracking policy looks like in JSON:

```json
{
  "TargetValue": 50.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ASGAverageCPUUtilization"
  },
  "ScaleOutCooldown": 0,
  "ScaleInCooldown": 300
}
```

This says "maintain an average CPU utilization of 50% across all instances in the group." The `ScaleOutCooldown` (scaling up) is 0, meaning aggressive scale-up when demand spikes. The `ScaleInCooldown` (scaling down) is 300 seconds, preventing rapid thrashing when load temporarily dips.

Notice that target tracking separates cooldowns into *scale-out* and *scale-in*, whereas simple scaling applies a single cooldown to all actions. This is more nuanced. You typically want to scale out quickly (adding capacity) but scale in cautiously (removing capacity), so you can afford different cooldown strategies.

You can use AWS-provided metrics like CPU utilization and network throughput, or you can specify custom CloudWatch metrics. This flexibility is powerful. Maybe your application's health depends more on queue depth than CPU usage. Target tracking lets you say "keep my SQS queue depth at 10 messages per instance" and the policy scales to maintain that.

Here's an example using a custom metric:

```json
{
  "TargetValue": 100.0,
  "CustomizedMetricSpecification": {
    "MetricName": "MyAppQueueDepth",
    "Namespace": "MyApplication",
    "Statistic": "Average",
    "Unit": "Count"
  },
  "ScaleOutCooldown": 60,
  "ScaleInCooldown": 300
}
```

The power of target tracking lies in its simplicity and its algorithmic sophistication. AWS uses a formula that considers the gap between your target and current metric value, then calculates the desired capacity needed to close that gap. The algorithm is conservative by default—it won't suddenly double your capacity—but it will respond dynamically as conditions change.

Target tracking also handles situations where your policy needs to scale beyond simple linear adjustments. If your target is 50% CPU and you're currently running at 80%, the policy calculates that you need roughly 1.6x your current capacity. It then scales intelligently, often in multiple steps, to reach that goal while avoiding resource shock.

AWS recommends target tracking for most workloads, and for good reason. It requires less operational knowledge to configure correctly. You don't need to think about cooldown periods or design step bands. You just pick a metric that reflects your application's health and set a reasonable target. The policy handles the rest.

### Comparing the Three Approaches: A Practical Framework

Each policy type has trade-offs. Let's examine them systematically.

**Configuration Complexity:** Simple scaling is the simplest to understand but the most tedious to get right. Step scaling requires more upfront thought but scales more intelligently. Target tracking is the easiest to set up but can feel like a black box if you're unfamiliar with how it calculates desired capacity.

**Response Speed:** Simple scaling responds as fast as its cooldown period allows. Step scaling can respond faster to consecutive breaches because it lacks mandatory cooldown. Target tracking responds dynamically without thinking about cooldown—it adjusts as needed, whenever needed.

**Metric Flexibility:** All three can use standard CloudWatch metrics. Both step and target tracking support custom metrics. Simple scaling is less commonly used with custom metrics, though it's technically possible.

**Operational Overhead:** Simple scaling requires you to monitor and tune cooldown periods and thresholds. Step scaling requires you to define and maintain step bands. Target tracking requires minimal tuning once deployed—it adapts automatically.

**Cost Efficiency:** Step and target scaling tend to be more cost-efficient because they avoid unnecessary scaling. Simple scaling often overshoots, resulting in excess capacity. However, if you configure simple scaling conservatively (small adjustments, short cooldowns), it can be nearly as efficient.

**Predictability:** Simple scaling is the most predictable—you know exactly how many instances will be added or removed. Target tracking is less predictable in the moment but more predictable over time—you know your metric will stabilize around the target.

### Choosing the Right Policy for Your Workload

To select the right scaling policy, ask yourself these questions:

**Is your traffic pattern predictable or bursty?** For steady, gradual traffic changes, simple scaling works fine. For unpredictable spikes, target tracking or step scaling handle it better. Target tracking is especially good if you can't predict the relationship between load and resource needs.

**Do you have a clear scaling formula?** If you understand that "every 10% increase in CPU needs 2 more instances," step scaling lets you encode that. If you don't have a clear formula, target tracking is safer—the algorithm figures it out.

**What metric best reflects health?** If standard CPU or network metrics correlate well with user experience, target tracking is ideal. If you need to scale on queue depth, request latency, or custom application metrics, step or target tracking works well (simple scaling is harder to configure for these).

**What's your tolerance for excess capacity?** If cost is paramount and you can tolerate brief periods of underprovisioning, go with target tracking or step scaling. If you need headroom, simple scaling with conservative settings might be safer.

**How much operational overhead can you afford?** Target tracking requires the least ongoing tuning. Simple scaling requires regular monitoring of cooldown effectiveness. Step scaling requires periodic review of step bands.

### Decision Tree for Policy Selection

Start here: Can you clearly articulate the relationship between your load metric and required instance count? If yes, consider **step scaling**—it lets you encode that knowledge into graduated steps.

If no, you're better served by **target tracking**. Can you identify a metric that represents application health (CPU, network, queue depth, latency)? Pick one, set a reasonable target, and let the algorithm handle scaling math.

Does your workload have highly predictable, steady-state demand with no unexpected spikes? Simple scaling works here, but target tracking works too and requires less tuning.

Do you have legacy infrastructure or specific operational requirements around cooldown periods? Simple scaling may be necessary for compatibility, but it's worth revisiting whether modernization is possible.

In general, the decision tree points toward **target tracking as the default choice**. It handles most scenarios well, requires minimal tuning, and scales responsively without forcing you to think about cooldown or step bands. Reserve step scaling for scenarios where you have specific knowledge about your workload's scaling curve. Use simple scaling primarily for legacy systems or when you have unusual operational constraints.

### Real-World Configuration Examples

Let's walk through complete examples for each policy type, configured on an actual Auto Scaling group.

For **simple scaling**, you'd create a policy like this via the AWS CLI:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name scale-up-simple \
  --policy-type SimpleScaling \
  --adjustment-type ChangeInCapacity \
  --scaling-adjustment 2 \
  --cooldown 300
```

This adds 2 instances when triggered, with a 300-second cooldown. You'd create a corresponding scale-down policy with a negative adjustment.

For **step scaling**, the CLI is more complex because you're defining multiple steps:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name scale-up-step \
  --policy-type StepScaling \
  --adjustment-type ChangeInCapacity \
  --metric-aggregation-type Average \
  --step-adjustments \
    MetricIntervalLowerBound=0,MetricIntervalUpperBound=10,ScalingAdjustment=1 \
    MetricIntervalLowerBound=10,MetricIntervalUpperBound=20,ScalingAdjustment=3 \
    MetricIntervalLowerBound=20,ScalingAdjustment=5
```

For **target tracking**, the configuration is much simpler:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name target-tracking-cpu \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "TargetValue": 50.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "ScaleOutCooldown": 0,
    "ScaleInCooldown": 300
  }'
```

Notice how target tracking requires fewer parameters and clearer intent. You're not thinking about alarms or thresholds—just your desired CPU level.

### Common Misconceptions and Gotchas

**Misconception: Cooldown periods prevent scaling in all directions.** Not quite. Simple scaling's cooldown applies to any scaling action from that policy. But if you have multiple policies (one for scale-up, one for scale-down), they're independent. You could scale up, hit cooldown, and still scale down if the scale-down policy triggers. Step and target tracking handle this more gracefully by separating scale-out and scale-in cooldowns.

**Misconception: Target tracking always knows what it's doing.** Target tracking is sophisticated, but it's not magic. If you set an unrealistic target (say, 20% CPU on a web server that typically runs at 60%), the policy will continuously scale down and risk underprovisioning. Choose targets that reflect realistic, healthy operating points.

**Misconception: Simple scaling is good enough for everything.** Simple scaling works, but it's outdated. It's still widely used in legacy systems, but for new projects, target tracking offers superior responsiveness with less configuration burden.

**Gotcha: CloudWatch metric delays.** All three policy types rely on CloudWatch metrics, which have a 1-2 minute publication latency. Your scaling reaction time is at least this long—you won't achieve sub-minute scaling responses regardless of policy type. If you need faster responses, consider application-level load balancing or connection draining strategies instead of Auto Scaling.

**Gotcha: Target tracking scale-in conservatism.** By default, target tracking scales in slowly to avoid cascading removals. If your metric temporarily dips but load hasn't actually decreased, you'll temporarily over-provision. This is intentional conservative behavior, but it's worth understanding.

### Scaling Policy Best Practices

Regardless of which policy you choose, follow these practices:

Ensure your CloudWatch metrics are meaningful and stable. Noisy metrics lead to scaling thrashing. If CPU fluctuates wildly second-to-second, consider using a longer statistic period (average over 5 minutes instead of 1 minute) to smooth noise.

Test your policies before pushing to production. Use Load testing tools to simulate traffic patterns and verify that your policies respond appropriately. A policy that works for steady-state traffic might fail spectacularly under a DDoS-style attack.

Monitor scaling activity even after policies are deployed. CloudWatch provides an `GroupDesiredCapacity` metric that shows when your policy is scaling. Alert if scaling becomes too frequent—it often indicates misconfigured targets or thresholds.

Consider combining policies. Many organizations run both a target tracking policy (for steady-state optimization) and a step scaling policy (for bursty, aggressive spikes). When multiple policies exist, AWS executes the one that scales the most aggressively, giving you the best of both worlds.

Document your policy choices. Six months from now, you won't remember why you chose a 50% CPU target instead of 70%. Annotate your infrastructure code with rationale.

### Conclusion

AWS Auto Scaling offers three reactive policy types, each suited to different scenarios. Simple scaling is the oldest, most straightforward, but also the least sophisticated—it works for predictable workloads but requires careful cooldown tuning. Step scaling adds intelligence by responding proportionally to metric magnitude, making it ideal for workloads where you understand the scaling curve. Target tracking is the modern, recommended approach—it inverts the problem by letting you specify a desired metric value and letting AWS calculate required capacity, resulting in responsive, adaptive scaling with minimal configuration.

For most new projects, target tracking is the right default. It requires the least operational overhead, scales responsively without thinking about cooldown periods, and adapts automatically to changing conditions. Reserve step scaling for scenarios where you've analyzed your workload and identified specific scaling steps. Use simple scaling primarily for legacy systems or unusual operational constraints.

The key insight is this: choose the simplest policy that meets your requirements, not the most sophisticated. Operational simplicity often outweighs marginal performance gains. Start with target tracking, monitor its effectiveness, and only add complexity (like step scaling or multiple policies) if you identify specific gaps that simpler approaches can't address.
