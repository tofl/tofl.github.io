---
title: "ECS Capacity Providers Explained: FARGATE, FARGATE_SPOT, and EC2 Auto Scaling"
---

## ECS Capacity Providers Explained: FARGATE, FARGATE_SPOT, and EC2 Auto Scaling

Imagine you're running containerized workloads on Amazon ECS and you face a fundamental question: should you buy compute capacity upfront, use serverless Fargate, or blend both approaches? More importantly, how do you make that choice dynamically based on your actual workload demands and budget constraints? This is where ECS capacity providers come in—a powerful abstraction that decouples task placement decisions from the underlying infrastructure, letting you focus on running your applications rather than managing servers.

Capacity providers are one of the most misunderstood features in ECS, yet they're essential for building scalable, cost-efficient container platforms. Whether you're optimizing costs, maximizing availability, or implementing a hybrid compute strategy, understanding how capacity providers work will transform how you approach ECS infrastructure.

### Understanding Capacity Providers: The Abstraction Layer

At its core, a capacity provider is a bridge between the logical world of ECS tasks and the physical world of compute infrastructure. Without capacity providers, you'd need to manually decide where each task lands—whether on EC2 instances, Fargate, or Fargate Spot—and manage the scaling of that infrastructure independently. Capacity providers automate these decisions and coordinate scaling across your infrastructure layer.

Think of it this way: instead of telling ECS "launch this task on that specific EC2 instance," you tell it "launch this task using the spot-optimized capacity provider." The capacity provider then handles the mechanics of finding available capacity, scaling infrastructure if needed, and even substituting infrastructure types if your preferred option is temporarily unavailable.

This abstraction is powerful because it creates a single point of control. You can change your infrastructure strategy—say, shifting from purely on-demand to mostly spot instances—without modifying a single task definition or service configuration. You just adjust the capacity provider strategy.

### The Built-in Capacity Providers: FARGATE and FARGATE_SPOT

AWS provides two capacity providers out of the box: FARGATE and FARGATE_SPOT. These don't require any configuration—they're available immediately when you create a cluster—and they represent the serverless end of the ECS spectrum.

**FARGATE** is the traditional AWS Fargate offering. You define your task's CPU and memory requirements in your task definition, and AWS provisions exact compute capacity to run your task. You pay per vCPU and GB of memory per hour, with no servers to manage. It's ideal when you want simplicity, isolation, and predictable costs for variable workloads.

**FARGATE_SPOT** is Fargate's cost-optimized sibling. It uses spare AWS capacity, typically offering 70% discounts compared to on-demand Fargate pricing. The tradeoff is availability: AWS can interrupt your tasks with two minutes' notice if they need the capacity back. Spot is perfect for stateless, fault-tolerant workloads like batch jobs, background processing, or development environments.

Here's what makes these built-in providers special: they require zero infrastructure management. No EC2 instances to patch, no Auto Scaling Groups to configure, no security group rules for internal networking. You simply create a service and specify which capacity provider to use.

```
aws ecs create-service \
  --cluster production \
  --service-name my-api \
  --task-definition my-api:1 \
  --desired-count 3 \
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

This command creates an ECS service that will always run your tasks on Fargate. Simple, clean, and immediately scalable.

### Creating Custom Capacity Providers with EC2 Auto Scaling

Built-in capacity providers are convenient, but they don't give you the granular control that EC2 offers. You might need specific instance types, custom AMIs, direct access to the underlying infrastructure, or pricing advantages of reserved instances. This is where custom capacity providers backed by EC2 Auto Scaling Groups come in.

Creating a custom capacity provider is a two-step process: first, set up an Auto Scaling Group with your desired EC2 configuration, then create the capacity provider to manage it.

Let's walk through a practical example. Suppose you want a capacity provider for general-purpose workloads using t3.large instances:

```
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name ecsOptimizedASG \
  --launch-template LaunchTemplateName=ecsOptimized,Version=\$Latest \
  --min-size 1 \
  --max-size 10 \
  --desired-capacity 2 \
  --vpc-zone-identifier subnet-12345678,subnet-87654321 \
  --tags "Key=Name,Value=ECS-Node,PropagateAtLaunch=true"
```

Once your Auto Scaling Group is running, create the capacity provider that references it:

```
aws ecs create-capacity-provider \
  --name ec2-general-purpose \
  --auto-scaling-group-provider autoScalingGroupArn=arn:aws:autoscaling:region:account:autoScalingGroup:uuid:autoScalingGroupName/ecsOptimizedASG,managedScaling=ENABLED,managedTerminationProtection=ENABLED,targetCapacity=100
```

The `targetCapacity` parameter is crucial here—it's the target utilization percentage for your capacity. Setting it to 100 means ECS will scale your Auto Scaling Group to maintain 100% utilization of reserved capacity, which maximizes efficiency. A lower value like 80 leaves headroom for burst traffic and graceful handling of instance terminations.

The `managedTerminationProtection=ENABLED` flag is a safety feature. It prevents EC2 instances from being terminated while they're running ECS tasks, avoiding sudden workload disruptions.

After creating the capacity provider, associate it with your ECS cluster:

```
aws ecs put-cluster-capacity-providers \
  --cluster production \
  --capacity-providers ec2-general-purpose FARGATE \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

Now your cluster knows about this capacity provider and can route tasks to it.

### Capacity Provider Strategies: Mixing On-Demand and Spot

Here's where the real power emerges. Capacity provider strategies let you define a weighted mix of capacity providers for your services, enabling sophisticated cost optimization without application-level complexity.

When you launch a service, instead of picking a single capacity provider, you can specify multiple capacity providers with weights and base values:

```
aws ecs create-service \
  --cluster production \
  --service-name batch-processor \
  --task-definition batch-processor:1 \
  --desired-count 10 \
  --capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=70,base=2 \
    capacityProvider=FARGATE,weight=30,base=1 \
    capacityProvider=ec2-general-purpose,weight=0,base=1
```

Let's unpack what this strategy does. You've specified three capacity providers with different roles:

The **base** value is a floor—the minimum number of tasks that must run on that capacity provider, regardless of weights. In this example, at least 2 tasks must run on Fargate Spot, 1 on regular Fargate, and 1 on your EC2 cluster. If your desired count is 10, that's 4 tasks accounted for by base values, leaving 6 tasks to be distributed by weights.

The **weight** determines how remaining capacity is distributed among providers. With weights of 70, 30, and 0, those 6 remaining tasks are split: 70% (4-5 tasks) to Spot, 30% (1-2 tasks) to on-demand Fargate, and 0 tasks to EC2 (since weight is 0). The EC2 provider is included just to ensure at least 1 task runs there thanks to its base value.

This strategy is economically brilliant. You're guaranteeing minimum reliability with base values—at least some capacity on more stable providers—while aggressively pursuing cost savings with Spot. If Fargate Spot capacity becomes constrained, tasks will spill over to your weighted on-demand options automatically.

The order of capacity providers in your strategy matters. ECS attempts to place tasks in the order you specify, so list them from most to least preferred. If Spot availability drops, tasks won't immediately scatter across all providers; instead, ECS will gradually shift capacity as instances become available.

### ECS Cluster Auto Scaling and Managed Scaling

Custom capacity providers unlock another critical feature: managed cluster auto scaling. When you enable managed scaling on a custom capacity provider, ECS doesn't just run tasks on existing capacity—it actively scales your Auto Scaling Group up or down based on demand.

The magic happens through CloudWatch metrics. ECS monitors the `CapacityProviderReservation` metric, which represents what percentage of your Auto Scaling Group's capacity is actively reserved by running tasks. If reservation exceeds your target capacity (which we set to 100% in our earlier example), ECS scales up the ASG. When reservation drops, ECS scales it back down.

Here's the practical impact: imagine you have an 8-task service running on a capacity provider with 10 available slots across your EC2 instances. When you scale the service to 15 tasks, ECS detects that capacity is insufficient and automatically triggers your Auto Scaling Group to add more instances. Within minutes, those new instances are registered with your cluster and tasks are placed on them.

Conversely, if you scale down to 2 tasks, ECS recognizes that you have excess capacity and initiates a scale-down of your Auto Scaling Group, terminating unused instances to reduce costs. The managed termination protection we enabled earlier ensures that scaling down won't violently interrupt running tasks.

This is where capacity providers shine for cost optimization. You're not manually managing infrastructure; you're defining policy, and AWS handles the mechanics.

### Real-World Cost Optimization Scenarios

Understanding capacity providers in isolation is useful, but their power emerges in realistic scenarios. Let me walk you through a practical cost optimization strategy.

Suppose you're running a microservices platform with a mix of workload characteristics. Your API services need guaranteed availability and low-latency response times. Your background job processors are fault-tolerant and can tolerate interruptions. Your analytics pipeline is flexible about timing.

You'd create capacity providers that match these requirements:

- An **on-demand EC2 capacity provider** for your critical API services, ensuring stable performance and no interruptions
- A **spot-heavy capacity provider strategy** for batch jobs, favoring Fargate Spot heavily with just enough on-demand capacity for reliability
- A **Fargate Spot-only capacity provider** for non-critical work that can disappear entirely without user impact

By assigning services to capacity providers that match their fault-tolerance profiles, you're simultaneously optimizing costs and ensuring reliability. Your API remains responsive, your batch jobs run affordably (mostly on Spot), and you spend nothing on compute for work that isn't running.

Another common scenario: you're uncertain about your long-term infrastructure strategy. Maybe you want to migrate from EC2 to Fargate eventually, but you're not ready to commit fully. Capacity provider strategies let you gradually shift traffic. Start with 80% on EC2 and 20% on Fargate, monitor costs and performance, then gradually rebalance. There's no binary migration moment—you drift toward your target state gracefully.

### Monitoring and Troubleshooting Capacity Provider Behavior

Once you've set up capacity providers, monitoring them is essential. The AWS Management Console shows capacity provider metrics in the ECS cluster view, but you can also query metrics directly through CloudWatch.

The `CapacityProviderReservation` metric tells you utilization. If it's consistently at 100%, you're running hot and may need to increase your Auto Scaling Group's maximum size or shift to a different capacity provider strategy. If it's consistently low (say, 20%), you have excess capacity that could be scaled down or redirected to other services.

The `RunningCount` metric for a service shows how many tasks are actually running. If desired count is 10 but running count is 8, you have a provisioning issue—likely insufficient capacity. Check the service events in the console to see why tasks couldn't be placed.

One subtle but important detail: when ECS places a task, it reserves capacity on the target capacity provider. That reservation persists for the task's lifetime. If you have a long-running task that's consuming capacity but shouldn't be, terminating it immediately frees capacity for scaling algorithms to rebalance.

### Practical Considerations and Common Pitfalls

When implementing capacity providers, a few practices help avoid trouble. First, ensure your Auto Scaling Group's launch template includes the ECS agent and the necessary IAM role. Tasks can't be placed on EC2 instances that aren't properly registered with your cluster.

Second, be thoughtful about your target capacity percentage. The 100% target we mentioned earlier is aggressive—it leaves no room for safety. For production workloads, consider 80% or even 75% to allow graceful handling of node failures and unexpected traffic spikes.

Third, understand that capacity provider strategies distribute tasks at service creation time. If you change the strategy, existing tasks aren't immediately redistributed. You'd need to force a new deployment for the service to rebalance tasks across capacity providers. This is intentional—ECS doesn't want to disrupt running tasks—but it's worth knowing.

Fourth, when mixing spot and on-demand capacity, be aware of regional spot availability fluctuations. If you weight Spot too heavily and availability drops, all your weight goes to that provider, and you might hit limits. A balanced strategy with meaningful base values on on-demand providers provides resilience against spot availability gaps.

Finally, remember that capacity providers are a cluster-level construct, not a task-level one. When you specify a capacity provider strategy on a service, you're telling ECS where that service's tasks can run. Individual task definitions don't carry capacity provider information.

### When to Use Each Capacity Provider Type

Choosing the right capacity provider or strategy depends on your workload characteristics and constraints.

**Use FARGATE** when you want serverless simplicity, have variable workload patterns, or need the isolation and predictability that serverless provides. You pay for what you use with no infrastructure management overhead. It's ideal for development environments, small services with unpredictable traffic, or organizations that want to avoid infrastructure entirely.

**Use FARGATE_SPOT** when your workload is stateless and fault-tolerant, you're willing to handle task interruptions gracefully, and cost is a significant concern. Background jobs, batch processing, and development/testing workloads are ideal candidates. The 70% discount is compelling enough to justify the complexity of handling interruptions.

**Use custom EC2 capacity providers** when you need specific instance types, cost-effective long-running workloads where reserved instances make sense, or direct infrastructure control. If you're running compute-intensive workloads where the per-vCPU cost of Fargate exceeds your budget, EC2 capacity providers let you optimize that cost.

**Use capacity provider strategies** when you want the best of multiple worlds. Strategies let you optimize for both cost and reliability simultaneously, ensuring some tasks run on stable infrastructure while others run on cheaper spot capacity.

### Conclusion

ECS capacity providers transform infrastructure management from a manual, time-consuming process into a declarative, policy-driven approach. Instead of deciding where each task runs, you define policies about how tasks should be distributed across cost and reliability tiers, and AWS handles the execution.

The built-in FARGATE and FARGATE_SPOT providers offer instant serverless capability with zero infrastructure management. Custom capacity providers backed by Auto Scaling Groups let you extend that abstraction to EC2, bringing the same declarative control to self-managed compute. Capacity provider strategies let you blend multiple providers intelligently, optimizing for your specific cost and reliability requirements.

The real power emerges when you combine these pieces: using managed scaling to automatically right-size your infrastructure, implementing capacity provider strategies to intelligently distribute workloads, and monitoring utilization to continuously optimize costs. Master capacity providers, and you've mastered one of the most sophisticated tools AWS offers for cost-effective, scalable container orchestration.
