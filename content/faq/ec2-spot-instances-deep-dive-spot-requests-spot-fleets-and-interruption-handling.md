---
title: "EC2 Spot Instances Deep Dive: Spot Requests, Spot Fleets, and Interruption Handling"
---

## EC2 Spot Instances Deep Dive: Spot Requests, Spot Fleets, and Interruption Handling

Imagine you're running a machine learning training job on AWS, and you realize you're spending far more than necessary on compute resources. Your workload is fault-tolerant and can be interrupted without catastrophic consequences—it'll just resume later. This is exactly where EC2 Spot Instances shine. They're one of AWS's most powerful cost-optimization tools, often delivering compute at 70-90% discounts compared to On-Demand pricing. Yet many developers treat them as a mysterious box of tricks, resorting to Spot only when budgets get tight. The truth is far richer: understanding Spot Instances deeply transforms how you architect for cost without sacrificing reliability.

In this article, we'll move well beyond the surface-level overview. We'll explore how Spot pricing actually works today (hint: no more bidding wars), examine the different ways to request Spot capacity, build fault-tolerant systems around interruption, and discover practical architectural patterns that make Spot a cornerstone of efficient AWS workloads.

### Understanding the Modern Spot Pricing Model

The biggest misconception about Spot Instances is that they work like an auction. Years ago, that was true—you'd bid on unused EC2 capacity, competing with other customers. If someone outbid you or capacity was needed for On-Demand customers, your instance would terminate. But AWS simplified this model significantly. Today, Spot pricing is deterministic and transparent, tied directly to the current market price for each instance type and Availability Zone combination.

Here's how it works now: AWS sets a Spot price for each instance type in each Availability Zone, and that price fluctuates based on available spare capacity and customer demand. You don't bid anymore. Instead, you specify a maximum price you're willing to pay (your bid), and as long as the current Spot price stays below your bid, your instance runs. If the Spot price exceeds your bid, the instance is interrupted. This shift removes the old auction stress and makes Spot instances far more predictable for planning.

The key insight is that your maximum bid typically doesn't affect cost. If you bid $0.50 per hour for an instance and the current Spot price is $0.12, you pay $0.12, not $0.50. Your bid is simply your ceiling, your "I won't pay more than this" threshold. This design encourages you to bid reasonably high—perhaps up to the On-Demand price—without worrying that you'll incur massive charges.

### One-Time vs. Persistent Spot Requests

When you launch a Spot Instance, you need to decide: is this a one-time request or persistent?

A **one-time Spot request** is exactly what it sounds like. You request capacity, and if you get it, great. If your instance is interrupted, the request stops. You don't get a new instance automatically. This approach suits temporary, ad-hoc workloads. You might use a one-time request to quickly spin up a build server for a CI/CD pipeline or test a new service without commitment.

A **persistent Spot request**, by contrast, doesn't give up when your instance is interrupted. Instead, it automatically attempts to launch a replacement instance, respecting your desired instance type, Availability Zone, and subnet preferences. Persistent requests keep your fleet at the desired capacity level, making them ideal for workloads that require continuous operation despite interruptions.

Consider this scenario: you're running a batch data processing job that ingests logs, transforms them, and uploads results to S3. The job doesn't care which instance it runs on—it just needs compute resources. If an instance is interrupted, the job can be paused, and a new instance can pick up where it left off. A persistent Spot request is perfect here because you want to maintain continuous processing capacity.

In contrast, if you're using Spot instances to run a temporary simulation or render video frames for a one-off project, a one-time request makes sense. You launch instances, let them work, and don't care if they're interrupted mid-way through. You'll simply launch a few extra instances to account for expected interruptions.

### Spot Fleets and EC2 Fleets: Diversification at Scale

Managing individual Spot requests becomes unwieldy once you need dozens or hundreds of instances. This is where Spot Fleets and EC2 Fleets enter the picture.

A **Spot Fleet** is a collection of Spot Instances and, optionally, On-Demand Instances that work together to meet a desired capacity goal. You define your Spot Fleet with a launch configuration (instance types, AMI, security groups, etc.) and specify how many instances you want. The fleet automatically distributes these instances across multiple instance types, Availability Zones, and subnets to maximize your chances of getting and maintaining the requested capacity.

The magic of a Spot Fleet lies in diversification. Instead of requesting 20 instances of type `m5.large` in a single Availability Zone, you might configure a Spot Fleet to request a mix of instance types—`m5.large`, `m5.xlarge`, `m6i.large`, `m6i.xlarge`—across three Availability Zones. When the Spot price for `m5.large` spikes, the fleet seamlessly launches replacements using different instance types. This flexibility dramatically improves your success rate in acquiring capacity.

A **Spot Fleet request** includes several parameters. You specify the desired target capacity (measured in instance units or vCPU count). You provide multiple launch specifications—each defining an instance type, subnet, and other configuration details. You set an allocation strategy that determines how the fleet distributes instances across these launch specifications.

The allocation strategy is particularly important. The `lowestPrice` strategy launches instances from whichever launch specification offers the cheapest Spot price at that moment. It's aggressive on cost but can result in frequent instance type changes. The `capacityOptimized` strategy launches instances from pools that have the most available Spot capacity, reducing interruption rates. The `priceCapacityOptimized` strategy balances cost and availability. For most production workloads, `capacityOptimized` is the right choice because it dramatically reduces interruption frequency, and the cost difference is often negligible.

**EC2 Fleets** are the newer, more flexible successor to Spot Fleets. They offer the same core functionality but with enhanced features. EC2 Fleets allow you to mix Spot, On-Demand, and Reserved Instances in a single fleet, making them ideal when you want a baseline of On-Demand capacity with Spot overflow. You can also use EC2 Fleets to optimize across different instance families and purchasing options in a single, unified configuration.

Here's a practical example. Suppose you're building a CI/CD system that needs 50 vCPUs of capacity. You might use an EC2 Fleet with 20 vCPUs of On-Demand instances (ensuring core builds always run) and 30 vCPUs of Spot instances (for additional parallelism). The fleet ensures that at least 20 vCPUs are always available via On-Demand, but it opportunistically adds Spot capacity to accelerate builds. If Spot instances are interrupted, you maintain the On-Demand baseline while the fleet works to replenish Spot capacity.

### The Interruption Notice: Understanding the 2-Minute Window

The most critical aspect of using Spot Instances safely is handling interruptions gracefully. AWS provides a 2-minute warning before terminating a Spot Instance due to capacity reclamation (though the instance may remain running briefly during this window). This is your golden opportunity to drain work, save state, and prepare for termination.

When AWS decides to reclaim a Spot Instance, it sends an interruption notice through two primary channels: **instance metadata** and **EventBridge**.

The **instance metadata service** is the traditional approach. Your application can periodically poll a special metadata endpoint to check for interruption notices. On Linux, you can query this endpoint:

```bash
curl -s http://169.254.169.254/latest/meta-data/spot/instance-action
```

If an interruption is scheduled, this endpoint returns JSON containing the action (terminate or stop) and the time the action will occur. If no interruption is scheduled, the endpoint returns a 404. Your application can check this endpoint every 5-10 seconds and initiate graceful shutdown when a notice arrives.

The challenge with polling is that it requires your application to have this awareness baked in. Not all applications are designed to handle graceful shutdown signals. This is where **EventBridge** comes in.

EventBridge is an event-driven service that captures AWS events and routes them to targets. AWS generates an event when a Spot Instance is about to be interrupted. You can configure an EventBridge rule to match this event and trigger an action—invoking a Lambda function, sending an SNS notification, posting to an SQS queue, or triggering an autoscaling action.

For example, you might use EventBridge to automatically remove an instance from a load balancer's target group when an interruption notice arrives. This prevents new requests from being routed to the soon-to-be-terminated instance, allowing existing connections to drain gracefully. You could combine this with a Lambda function that monitors connection counts and terminates the instance once all requests complete.

The 2-minute window is typically enough time for most well-designed applications. Long-running batch jobs should save checkpoints regularly (every 1-5 minutes) so that if interrupted, they can resume from a recent checkpoint rather than restarting from scratch. Web services should respond to interruption notices by ceasing to accept new work, allowing load balancers to redirect traffic.

### The Rebalance Recommendation Signal

Beyond the immediate interruption notice, AWS provides a softer signal called the **rebalance recommendation**. This indicates that your Spot Instance may be at elevated risk of interruption soon, even though termination isn't imminent. Think of it as a yellow flag that says "prepare for the possibility of termination."

The rebalance recommendation appears in instance metadata at a different endpoint:

```bash
curl -s http://169.254.169.254/latest/meta-data/spot/instance-rebalance-recommendation
```

If rebalancing is recommended, this endpoint returns a value. If not, it returns a 404.

The rebalance recommendation gives you time to proactively migrate work to a fresher Spot Instance before urgent interruption becomes necessary. This is especially valuable for long-running workloads. When you detect a rebalance recommendation, you might:

Launch a new Spot Instance of the same type to act as your replacement. Gradually shift traffic or work queues to the new instance. Once new instance is fully loaded, terminate the original instance.

This approach is far more graceful than waiting for the 2-minute interruption notice and can reduce the impact on your workload.

### Architectural Patterns for Fault-Tolerant Spot Workloads

Understanding Spot's mechanics is one thing. Actually building systems that thrive on Spot is another. Let's explore a few proven patterns.

#### CI/CD and Build Pipelines

CI/CD pipelines are natural candidates for Spot. Build jobs are typically stateless, parallelizable, and fault-tolerant. If a build machine is interrupted, the build system simply reschedules the job on another agent.

A typical approach uses an EC2 Fleet or Spot Fleet to maintain a pool of build agents. Each agent runs a lightweight agent software that polls a central CI/CD system (Jenkins, GitLab CI, GitHub Actions, etc.) for work. When an agent receives a job, it executes the build steps, uploads artifacts, and reports results. If the agent is interrupted mid-build, the CI/CD system simply requeues the job.

To optimize this further, you might configure the fleet with multiple instance types that support the same architecture. Maybe your build pipeline runs equally well on `t3.large`, `t3a.large`, and `m6i.large`. By requesting all three types in your fleet, you increase your chances of getting and maintaining capacity when any single type experiences high demand.

You might also combine Spot and On-Demand in your fleet. Reserve a small baseline of On-Demand capacity (say, 10% of your desired capacity) to ensure critical builds always have resources. Use Spot for the remaining capacity to maintain cost-effectiveness.

#### Batch Processing and Data Analytics

Batch jobs—data transformations, log analysis, ETL workflows—are ideal Spot workloads because they're often non-time-sensitive and can tolerate interruptions.

A robust pattern uses a combination of SQS queues and Spot instances. Your application enqueues work items (batches of data to process) into an SQS queue. Spot instances poll this queue, retrieve work items, process them, and write results to a data store (S3, DynamoDB, etc.).

The Spot instances record their progress for each work item. If an instance is interrupted, the SQS queue still contains that work item (or it reappears in the queue after the visibility timeout expires). A new Spot instance picks up the work item and resumes processing.

To handle partial progress, each work item should be idempotent—processing it multiple times produces the same result. If instance A processes part of a data batch before being interrupted, and instance B later processes the same batch, the results are consistent because each processing operation is independent.

You might use an EC2 Fleet or autoscaling group with Spot to manage the worker pool. As SQS queue depth increases, the fleet automatically launches additional instances. As queue depth decreases, instances gracefully drain their work items and terminate.

#### Machine Learning Training

ML training jobs are compute-intensive and often time-resilient—a job that trains for 10 hours instead of 15 hours due to interruptions is still valuable. Spot can reduce training costs dramatically, especially when combined with interruptible, checkpointing techniques.

A robust approach uses frameworks and tools that support checkpointing. PyTorch, TensorFlow, and other modern ML frameworks allow you to save model state and resume training from a checkpoint. Your training job periodically saves checkpoints to S3 (every 5-10 minutes for typical workloads).

When an interruption notice arrives, your training script saves the current state as a checkpoint and terminates. The next Spot instance you launch loads the most recent checkpoint and resumes training. You've effectively paused training during the interruption and resumed on a different instance—a seamless experience to the job itself.

For jobs where interruption is a possibility, you might also use multiple Spot instances to train different models or different configurations in parallel. If one instance is interrupted, you lose the progress for that specific model, but the others continue. When the interrupted instance is replaced, it trains a different model.

Some teams combine Spot with Reserved Instances or On-Demand for ML training. They use Spot for exploratory work—testing hyperparameters, architecture ideas—where some interruptions are tolerable. Once they've found a promising configuration, they reserve a On-Demand instance or Reserved Instance for the final production training run.

### Cost Optimization Strategies with Spot

Beyond just using Spot instances, there are several strategies to maximize cost savings while maintaining reliability.

**Right-sizing with Spot** is the first principle. Before committing to a Spot fleet, spend time understanding your actual resource requirements. Use CloudWatch metrics to understand CPU and memory utilization. Don't oversell—running three `r5.4xlarge` instances when you could use two `r5.2xlarge` instances wastes money. Spot magnifies the impact of inefficiency because you're operating at high volume to maintain desired capacity despite interruptions.

**Spot interruption patterns** vary by region and instance type. Some instance types in certain Availability Zones experience interruptions several times per day. Others experience interruptions once weekly. Use CloudWatch and Spot Instance Interruption Notices to track patterns in your environment. If you see that `m5.large` in `us-east-1a` is interrupted frequently, configure your fleet to prefer other instance types or Availability Zones.

**Combining Spot purchasing options** is powerful. Perhaps 20% of your workload requires continuous availability. Use On-Demand or Reserved Instances for that portion. Use Spot for the remaining 80%. This hybrid approach lets you take advantage of Spot's savings while guaranteeing baseline capacity.

**Spot pricing history** is available in the AWS Management Console and via the AWS CLI. Before you finalize a Spot fleet configuration, examine the historical pricing for your chosen instance types and regions. If you see a instance type that's usually $0.08 per hour but occasionally spikes to $0.25, you might want to include alternative instance types in your fleet to avoid those spikes.

### Monitoring and Observability

Running Spot workloads requires visibility into interruption rates and fleet health.

CloudWatch metrics for EC2 Fleets and Spot Fleets include the number of running instances, the number of fulfilled capacity units, and the number of instances being launched or terminated. Create dashboards that show fleet capacity and interruption frequency over time.

EventBridge rules for Spot Instance Interruption Notices should log events to CloudWatch Logs. This creates a permanent record of when instances were interrupted. Over time, you can calculate interruption rates by instance type and Availability Zone, informing fleet configuration decisions.

Some teams use custom metrics to track workload-specific interruption impact. For example, a data processing pipeline might emit a metric counting the number of jobs restarted due to instance interruption. This helps quantify the real-world impact of interruptions on your business logic.

CloudTrail logging captures API calls related to Spot instance launches and terminations, providing an audit trail for cost analysis and debugging.

### Common Pitfalls and How to Avoid Them

Even with understanding, Spot implementations can stumble. Here are common mistakes and remedies.

**Not handling interruptions** is the most critical error. Some teams launch Spot instances but don't implement graceful shutdown. When interruptions happen, work is lost, data becomes inconsistent, and trust in Spot erodes. Always implement interruption handling from day one.

**Insufficient diversification** in fleet configurations leads to frequent interruptions. If your fleet requests only `m5.large` in `us-east-1a`, you're vulnerable to spikes in demand for that exact configuration. Include multiple instance types and Availability Zones in your fleet strategy.

**Overly aggressive bids** are rare but wasteful. If you bid at the On-Demand price and the Spot price climbs to match, you're effectively paying full price without Spot's savings. Keep bids reasonable—perhaps at the On-Demand price as a ceiling, but monitor actual Spot pricing and adjust over time.

**Not testing interruption handling** is dangerous. Run fire drills where you manually terminate Spot instances and verify that your application handles it correctly. Don't assume that your code works until it's been tested under real interruption conditions.

**Ignoring rebalance recommendations** wastes the 2-minute window. If your workload detects rebalance recommendations but does nothing, you're forgoing the opportunity to gracefully migrate work before urgent interruption.

### Conclusion

EC2 Spot Instances represent one of AWS's most powerful cost optimization tools, capable of reducing compute expenses by 70-90% when used appropriately. They're no longer an exotic bidding mechanism but a mature, predictable pricing model backed by clear interruption signals and fleet management tools.

The key to successful Spot adoption is twofold. First, understand the mechanics: modern pricing, request types, Spot Fleets and EC2 Fleets, and the interruption notice channels. Second, architect your workloads to tolerate interruptions through graceful shutdown, state checkpointing, queue-based work distribution, and diversified fleet configurations.

When you combine this understanding with fault-tolerant architecture patterns—CI/CD pipelines, batch processing, ML training—Spot transforms from a risky cost-cutting measure into a reliable, integral part of your infrastructure. The 2-minute interruption notice isn't a threat; it's an opportunity to demonstrate your system's resilience. Start with non-critical workloads, implement interruption handling thoroughly, and gradually expand Spot usage as your confidence grows. Done right, Spot instances become indispensable to building cost-efficient AWS systems.
