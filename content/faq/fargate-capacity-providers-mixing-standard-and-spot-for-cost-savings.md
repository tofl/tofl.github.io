---
title: "Fargate Capacity Providers: Mixing Standard and Spot for Cost Savings"
---

## Fargate Capacity Providers: Mixing Standard and Spot for Cost Savings

Running containerized workloads on AWS doesn't have to mean choosing between reliability and cost. One of the most powerful—yet underutilized—strategies for optimizing ECS on Fargate is blending standard on-demand capacity with Spot instances through capacity providers. This approach lets you maintain a guaranteed baseline of always-available compute while letting your application burst onto cheaper Spot capacity when it's available, creating a cost-effective hybrid that works especially well for workloads with variable demand patterns.

In this guide, we'll explore how Fargate capacity providers work, how to configure them to balance cost and reliability, and how to gracefully handle the inevitable Spot interruptions that come with the territory. Whether you're running batch jobs, web services, or anything in between, understanding this capability will fundamentally change how you think about containerized infrastructure costs.

### Understanding Fargate Capacity Providers and Their Purpose

Before diving into configuration, it's important to understand what capacity providers actually do. In traditional ECS with EC2 launch types, you managed an Auto Scaling Group of instances and ECS would place tasks onto them. With Fargate, AWS abstracts away the instances entirely—you request compute, and AWS provisions the underlying infrastructure. Capacity providers extend this abstraction by letting you define *how* and *where* your tasks should run.

A capacity provider is essentially a template that tells ECS: "When I ask you to run a task, here's my preference—use this specific compute type, with these scaling rules." For Fargate, AWS provides two built-in capacity providers: `FARGATE` (standard on-demand pricing) and `FARGATE_SPOT` (deeply discounted but interruptible capacity).

The genius of combining these two providers is that you're not forced into an all-or-nothing decision. You don't have to choose between "reliable but expensive" or "cheap but risky." Instead, you define a base capacity that's always available on-demand, then spill excess demand into Spot. It's like having a guaranteed number of employees on staff, then hiring temporary workers during busy periods at a fraction of the cost.

### The Base + Weight Strategy Explained

The configuration that makes this hybrid approach possible centers on two key concepts: **base** and **weight**.

**Base** defines the minimum number of tasks that will *always* run on a given capacity provider. This is your safety net. If you set `FARGATE` with a base of 2, you're guaranteed to have 2 tasks running on standard on-demand capacity, regardless of how many total tasks you want running.

**Weight** determines the relative priority when ECS needs to scale up beyond the base. Think of weight as a voting system. If `FARGATE` has a weight of 1 and `FARGATE_SPOT` has a weight of 100, then for every 1 task placed on on-demand, 100 tasks will be placed on Spot (up to the Spot limit or until the spike subsides). Weights are relative, not absolute.

Here's a concrete scenario: Imagine you're running a web API service and want to maintain 3 always-on tasks for reliability. You anticipate traffic spikes that could demand up to 20 tasks, but you only want to pay on-demand prices for that baseline 3. You'd configure:

- `FARGATE` capacity provider: base = 3, weight = 1
- `FARGATE_SPOT` capacity provider: base = 0, weight 100

This setup guarantees 3 on-demand tasks always running. When traffic spikes and you need 20 total tasks, the remaining 17 tasks will launch on Spot. You're paying on-demand for 3 tasks and Spot prices (roughly 70% discount) for 17 tasks. Your monthly bill is dramatically lower than running all 20 on-demand, yet you have resilience built in—if Spot capacity is interrupted, your 3 base tasks keep the service alive.

### Configuring Capacity Providers in Your ECS Cluster

Setting up capacity providers involves two steps: first, you define which capacity providers are available to your cluster, then you create or update your ECS service to use them with specific base and weight values.

Let's walk through the console approach first, then show the CLI equivalent since both are important to understand.

In the AWS Management Console, navigate to your ECS cluster and go to the "Capacity Providers" tab. Here, you'll see the built-in `FARGATE` and `FARGATE_SPOT` providers available. When you associate them with your cluster, you're not creating anything new—you're simply activating AWS's managed capacity providers for that cluster. This is a quick, one-time operation.

Once capacity providers are associated with your cluster, the real configuration happens at the service level. When you create or update an ECS service, you specify:

1. Which capacity providers to use
2. The base capacity for each
3. The weight for each

The AWS Management Console makes this intuitive. Create a service, reach the "Deployment configuration" section, and under "Capacity provider strategy," you'll see options to add multiple capacity providers with their base and weight values.

For hands-on work, the CLI is often faster and more scriptable. Here's how you'd create a service with a hybrid capacity provider strategy:

```bash
aws ecs create-service \
  --cluster my-cluster \
  --service-name api-service \
  --task-definition api-task:1 \
  --desired-count 10 \
  --capacity-provider-strategy \
    capacityProvider=FARGATE,weight=1,base=3 \
    capacityProvider=FARGATE_SPOT,weight=100,base=0 \
  --region us-east-1
```

This command creates a service that will run 10 tasks total. The first 3 tasks (the base) always run on `FARGATE`. The remaining 7 tasks prefer `FARGATE_SPOT` due to the weight ratio. If you later increase `desired-count` to 50, you'd have 3 on-demand and 47 on Spot.

If you already have a service and want to update its capacity provider strategy, use `update-service`:

```bash
aws ecs update-service \
  --cluster my-cluster \
  --service my-service \
  --capacity-provider-strategy \
    capacityProvider=FARGATE,weight=1,base=2 \
    capacityProvider=FARGATE_SPOT,weight=50,base=0 \
  --force-new-deployment
```

The `--force-new-deployment` flag ensures new tasks are placed according to the new strategy immediately, rather than waiting for natural task churn.

One nuance worth noting: the base is *per capacity provider*, not per availability zone. If you have multiple AZs and a base of 3 for `FARGATE`, ECS distributes those 3 tasks across AZs for fault tolerance, but all 3 count toward your base. This is different from some other AWS services where you might see "base per AZ" configurations.

### How Task Placement and Distribution Works

Understanding how ECS actually places tasks when you have multiple capacity providers is essential for predicting your costs and ensuring your service behaves as expected.

When you request tasks with a capacity provider strategy, ECS follows this logic:

First, it satisfies the bases. If your `FARGATE` provider has a base of 3, ECS ensures 3 tasks are running on `FARGATE` before considering `FARGATE_SPOT`. These base tasks are "sticky"—they'll stay on that provider as long as possible.

Next, it applies the weights. For every additional task beyond the sum of all bases, the weights determine the ratio. If `FARGATE` has weight 1 and `FARGATE_SPOT` has weight 100, the ratio is 1:100. For every 101 additional tasks needed, 1 goes to `FARGATE` and 100 go to `FARGATE_SPOT`.

ECS also respects your task placement constraints. If you've specified that tasks must run in specific availability zones or on specific container instances (in EC2-based ECS), those constraints apply regardless of capacity provider strategy. The capacity provider strategy works *within* those constraints.

Here's a practical example: suppose you have a service configured with `desired-count=100`:

- `FARGATE` base=5, weight=10
- `FARGATE_SPOT` base=0, weight=90

After satisfying the 5-task base on `FARGATE`, you have 95 remaining tasks. The ratio of weights is 10:90 (or simplified, 1:9). So you'd expect roughly 10-11 additional tasks on `FARGATE` and 84-85 on `FARGATE_SPOT`. In practice, you'd see something like 16 total on `FARGATE` and 84 on `FARGATE_SPOT`.

Availability zone distribution comes into play here too. ECS spreads tasks across AZs for resilience. If your cluster spans 3 AZs, your 16 on-demand tasks might be distributed as 5, 5, and 6 across them. The capacity provider strategy and AZ spreading work together, not against each other.

### Cost Optimization Scenarios in Practice

Let's ground this in real business scenarios, because the abstract concept only matters when it saves you actual money.

**Scenario 1: Predictable Baseline with Volatile Spikes**

You run an internal dashboard service. During business hours, you always need 5 tasks to handle steady traffic. Around 9 AM, when everyone logs in, you spike to 30 tasks. By 5 PM, you're back to 5. By midnight, you only need 1.

With a pure on-demand strategy, you'd either run 30 tasks 24/7 (massively wasteful), or manually scale (operationally complex and error-prone). With capacity providers:

```bash
--capacity-provider-strategy \
  capacityProvider=FARGATE,weight=1,base=5 \
  capacityProvider=FARGATE_SPOT,weight=50,base=0
```

You pay for 5 on-demand tasks constantly (about $0.06/hour in us-east-1), plus Spot for the 25 spike tasks during busy hours (about $0.018/hour for the same resources). Over a month, you save roughly 40-50% on compute costs during peak hours, and even more during off-hours.

**Scenario 2: Batch Processing with Fault Tolerance Requirements**

You run a video transcoding service. Some jobs are SLA-critical (customer-facing), others are batch processing that can tolerate interruptions. You want all SLA-critical jobs to complete, but you're willing to let batch jobs restart if Spot capacity is interrupted.

You could run two services: one critical service with a higher base on `FARGATE`, one batch service that's mostly `FARGATE_SPOT`:

Critical service:
```bash
--capacity-provider-strategy \
  capacityProvider=FARGATE,weight=1,base=10 \
  capacityProvider=FARGATE_SPOT,weight=10,base=0
```

Batch service:
```bash
--capacity-provider-strategy \
  capacityProvider=FARGATE,weight=1,base=0 \
  capacityProvider=FARGATE_SPOT,weight=100,base=0
```

The critical service has a strong on-demand presence. The batch service is almost entirely Spot. If a Spot interruption happens, only the batch tasks are affected, and new ones start immediately. Meanwhile, your critical jobs continue uninterrupted on the on-demand base.

**Scenario 3: Maximizing Efficiency with Minimal Risk**

You want to squeeze maximum savings without risking availability. You set a conservative base that covers your 99th percentile non-spike demand:

```bash
--capacity-provider-strategy \
  capacityProvider=FARGATE,weight=2,base=8 \
  capacityProvider=FARGATE_SPOT,weight=100,base=0
```

With a 2:100 weight ratio, you're running about 98% on Spot for new capacity. You maintain 8 on-demand tasks always (your safety net), then go almost entirely Spot for everything else. For a service that needs 50 tasks during peak, you're paying on-demand for 8 and Spot for 42. That's about 80% savings on the variable portion.

The risk is manageable because those 8 on-demand tasks can handle critical requests while new Spot tasks spin up. Your application just needs to handle brief moments of reduced capacity gracefully (which we'll discuss in the next section).

### Handling Spot Interruptions Gracefully

The trade-off for Spot's cost savings is interruption risk. AWS will reclaim Spot capacity when they need it (roughly 2-5% of the time in real-world usage, though this varies by instance family and region). Understanding how to handle these interruptions is what separates a cost-effective system from a brittle one.

When AWS is about to reclaim a Fargate Spot task, it sends a 2-minute warning. This is your window to gracefully shut down the task, save state if necessary, and let ECS know the task is stopping. If you don't handle this gracefully, ECS simply kills the task at the 2-minute mark, and your application crashes.

The mechanism is the `stopTimeout` configuration on your task definition. When ECS receives a Spot interruption notice, it sends a `SIGTERM` signal to your container. Your application has `stopTimeout` seconds (you define this, default is 30 seconds) to perform a graceful shutdown. After that, ECS sends `SIGKILL`, which is instantaneous and unignorable.

Here's how you configure it in a task definition:

```json
{
  "family": "my-task",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "my-app:latest",
      "stopTimeout": 30,
      "environment": [
        {
          "name": "FARGATE_SPOT_MODE",
          "value": "true"
        }
      ]
    }
  ]
}
```

On the application side, your code needs to listen for `SIGTERM` and act accordingly. In Node.js, for example:

```javascript
const server = http.createServer(handler);

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  
  // Stop accepting new requests
  server.close();
  
  // Wait for existing requests to finish (up to stopTimeout)
  await new Promise(resolve => setTimeout(resolve, 25000));
  
  // Close database connections, cleanup, etc.
  await db.disconnect();
  
  process.exit(0);
});

server.listen(3000);
```

In Python with Flask or FastAPI, you'd use similar patterns with signal handlers. In Java, you might leverage Spring Boot's graceful shutdown features.

The key is: don't assume your application will run forever. Fargate Spot interruptions are a feature you should design for, not an edge case you hope never happens. When you do handle them gracefully, users barely notice—connections timeout and retry, load balancers route traffic to other tasks, and the system self-heals.

If you want to be extra defensive, you can monitor AWS's Spot Interruption Notices even before ECS delivers the `SIGTERM`. AWS publishes these to the EC2 Instance Metadata Service (IMDS). In a Fargate container, you can query `http://169.254.169.254/latest/meta-data/spot/instance-action` to check if an interruption is coming. Some applications poll this to preemptively drain connections and prepare for shutdown, giving them extra time before the hard deadline.

### Monitoring and Observing Capacity Provider Behavior

To truly understand what's happening with your capacity providers, you need visibility into task placement. CloudWatch is your primary tool here.

ECS publishes metrics to CloudWatch showing how many tasks are running on each capacity provider. Navigate to CloudWatch Metrics, search for "ECS," and look for `RunningCount` broken down by capacity provider. Over time, you'll see the pattern: a steady baseline on `FARGATE`, spikes of `FARGATE_SPOT` during peak hours.

You can create a CloudWatch dashboard to track:

- Total tasks running
- Tasks on `FARGATE` vs. `FARGATE_SPOT`
- Spot interruption events
- Task placement failures (if your cluster has insufficient capacity)

For deeper insight, enable ECS Container Insights. This collects more detailed metrics and logs, giving you a granular view of container-level resource usage. It costs extra (a few dollars per month for small clusters), but if you're running a complex system with multiple capacity providers, it's worthwhile.

In the ECS console under your service, the "Deployments" tab shows how many tasks are in each state (running, pending, etc.) and which capacity provider they're using. This is a quick sanity check: if you see pending tasks, it means your cluster can't satisfy them due to capacity issues or constraint mismatches.

For Spot interruptions specifically, you won't see a dedicated "interruption" metric, but you will see tasks transitioning to a `stopped` state. If you notice a sudden drop in running count on `FARGATE_SPOT` followed by a climb back up, that's likely a Spot interruption and automatic restart. ECS handles restarting these tasks automatically based on your service's desired count.

### Practical Troubleshooting and Common Pitfalls

Even with a solid understanding, a few gotchas can trip you up.

**Pitfall 1: Forgetting to Update Task Definition stopTimeout**

You set up a beautiful capacity provider strategy with mostly Spot, but you forgot to increase `stopTimeout` in your task definition beyond the default 30 seconds. When Spot interruptions happen, your application only gets 30 seconds to gracefully shut down. If your app handles a lot of open connections or has cleanup logic, 30 seconds might not be enough. Your containers get killed mid-request, causing errors and potential data corruption.

The fix is simple: review your app's shutdown logic, determine how long it reasonably needs, then set `stopTimeout` to that value (capped at your ECS execution timeout). A common safe value is 60-120 seconds for most applications.

**Pitfall 2: Not Accounting for Overprovisioning in Your Base**

You set `base=10` thinking "I want 10 on-demand tasks for safety." But you're running on a small cluster with only 2 availability zones. ECS tries to spread those 10 base tasks across AZs for fault tolerance, but it can't perfectly balance them if 10 isn't divisible by 2. You end up with uneven task distribution, or worse, tasks can't be placed at all because you've constrained them to specific AZs.

The solution: keep your base number reasonable relative to your AZ count. If you have 3 AZs, use bases like 3, 6, 9, or 12 so ECS can distribute evenly.

**Pitfall 3: Weighing Too Heavily Toward Spot**

You're excited about savings and set weights like `FARGATE=1, FARGATE_SPOT=1000`. Now 99.9% of your capacity is Spot. If a large Spot interruption happens (it can affect entire instance families), you lose almost everything at once. You've optimized cost at the expense of reliability.

A better approach: use the base to guarantee minimum capacity, then let weights be more reasonable. A 1:50 or 1:100 weight ratio gives you plenty of Spot benefits while maintaining proportional on-demand presence.

**Pitfall 4: Misconfiguring Capacity Provider Strategy with Task Placement Constraints**

You set up capacity providers perfectly, but you've also constrained tasks to run only in specific availability zones or on specific container instances (in EC2-based ECS). The capacity provider strategy tries to honor both constraints simultaneously, and if the constraints are incompatible with the capacity provider distribution, tasks get stuck in a pending state.

For example: you specify tasks must run in `us-east-1a`, but you've set weights that push 90% of capacity to `FARGATE_SPOT`, which might not be available in that AZ. Result: pending tasks that never launch.

The fix: review your placement constraints and ensure they're compatible with your capacity provider strategy. Most of the time, you want capacity providers to handle distribution, not manual placement constraints.

### Comparing Costs: On-Demand vs. Spot vs. Hybrid

Let's put actual numbers on this to make the value concrete. Assume you're running a 256 CPU, 512 GB memory task (roughly equivalent to a `t3.xlarge` instance):

- Fargate on-demand: $0.0564 per hour
- Fargate Spot: $0.0170 per hour (70% discount)

If you run 50 tasks 24/7 for a month (720 hours):

- Pure on-demand: 50 × $0.0564 × 720 = $2,030.40
- Pure Spot: 50 × $0.0170 × 720 = $612 (but risk of interruptions)
- Hybrid (base 10, rest Spot): (10 × $0.0564 + 40 × $0.0170) × 720 = $1,033.92

The hybrid saves $1,000/month compared to on-demand while maintaining a reliable baseline. Even if Spot gets interrupted occasionally and you lose some tasks temporarily, you're still way ahead. And your 10 on-demand base keeps critical functionality alive during interruptions.

For services with more variable demand, the savings are even more dramatic. If you're not running tasks 24/7, or if your peak demand is significantly higher than your baseline, a hybrid strategy can reduce costs by 50-70%.

### Integrating Capacity Providers with Auto Scaling

Capacity providers work seamlessly with ECS Service Auto Scaling. You can define scaling policies that adjust `desired-count` based on metrics like CPU utilization or custom CloudWatch metrics. ECS then respects your capacity provider strategy as it scales up or down.

For example, you might scale from 10 to 100 tasks as demand increases. Your capacity provider strategy ensures the first 10 (your base) are always on-demand, and the additional 90 follow your weight ratio. As demand drops and you scale back to 10, ECS prefers to terminate Spot tasks first (since they're less reliable anyway), keeping your base on-demand tasks stable.

This combination—capacity providers + auto scaling—is incredibly powerful. You're automatically adjusting both the number of tasks *and* their cost/reliability profile in response to real-world demand.

### Key Takeaways and Next Steps

Fargate capacity providers are one of the most underutilized cost optimization tools in AWS. By combining standard on-demand capacity with Spot through a thoughtful base + weight strategy, you can cut compute costs dramatically while maintaining the reliability your application needs.

The approach boils down to a few principles:

Set a base that covers your minimum acceptable capacity—the level below which service degradation is unacceptable. This is your safety net, and it costs you money, so be realistic about what you actually need.

Use weights to express your tolerance for Spot. Conservative weights (like 1:10) maintain a healthy mix of on-demand presence. Aggressive weights (1:100) push toward maximum savings and require excellent Spot interruption handling.

Configure `stopTimeout` appropriately and ensure your application handles `SIGTERM` gracefully. This turns Spot interruptions from failure events into normal operational occurrences.

Monitor and observe your actual task placement over time. Adjust bases and weights based on real patterns, not guesses. If you're almost never hitting your base, you can lower it. If you're seeing too many pending tasks, you might need to increase on-demand capacity or adjust constraints.

From here, consider exploring ECS Capacity Provider automation features like managed scaling, which can automatically adjust cluster capacity based on demand. You might also investigate how capacity providers interact with your specific application architecture—whether you're running stateless APIs, databases, batch jobs, or something else entirely will influence your ideal strategy.
