---
title: "7. ASG"
type: docs
weight: 3
---

## Auto Scaling Groups (ASG)

An Auto Scaling Group is an EC2 fleet management service that automatically adjusts the number of running instances based on demand, health, or a schedule. The core problem it solves is twofold: you don't want to over-provision (wasting money on idle capacity), and you don't want to under-provision (degrading user experience under load). ASG handles both by adding instances when demand rises and terminating them when it drops — all without manual intervention. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)

### Launch Templates vs. Launch Configurations

Before ASG can launch an instance, it needs to know *what* to launch. This is defined in either a **launch template** or a **launch configuration**.

A **launch template** is the modern, recommended approach. It supports versioning, which means you can maintain multiple versions and specify which one the ASG should use (or always use the latest). Launch templates also unlock access to newer features like mixed instance types, Spot allocation strategies, and T3/T4 unlimited burst settings. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html)

A **launch configuration** is the older, legacy alternative. It's a flat, immutable object — once created, it cannot be modified, only replaced. No versioning, no mixed instances, no newer instance features. For the exam, know that AWS recommends migrating to launch templates, and any scenario involving mixed Spot/On-Demand fleets requires a launch template. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-configurations.html)

### Scaling Policies

ASG supports three scaling policy types, and choosing the right one depends on whether you're reacting to real-time metrics, changes in load magnitude, or predictable patterns.

**Target tracking scaling** is the simplest and most commonly used. You declare a target value for a metric — for example, keep average CPU utilization at 50% — and ASG continuously adjusts capacity to maintain that target, both scaling out and scaling in automatically. This is analogous to a thermostat: set the temperature, and the system handles the rest. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html)

**Step scaling** gives you finer-grained control by defining scaling adjustments that vary based on how far the metric breaches an alarm threshold. For instance, add 1 instance if CPU is between 60–80%, but add 3 instances if it exceeds 80%. This is useful when the appropriate response to a small spike differs significantly from the response to a large one. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html)

**Scheduled scaling** is used when load patterns are predictable — for example, scaling out every weekday at 08:00 before business hours begin, and scaling in at 20:00. Scheduled actions don't react to metrics; they simply change the desired, minimum, or maximum capacity at a specified time. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/scheduled_scaling.html)

### Lifecycle Hooks

By default, when ASG launches or terminates an instance, it moves quickly — the instance either starts serving traffic or disappears almost immediately. **Lifecycle hooks** let you pause that transition so you can run custom logic at critical moments. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html)

There are two hook points:

- **`EC2_INSTANCE_LAUNCHING` (Pending state)** — Triggered after the instance is launched but before it's put in service. Useful for installing software, pulling configuration from Parameter Store, or registering the instance with an external service.
- **`EC2_INSTANCE_TERMINATING` (Terminating state)** — Triggered before the instance is actually terminated. Useful for draining in-flight jobs, flushing logs to S3, or deregistering from a service registry.

While a lifecycle hook is active, the instance is held in a `Pending:Wait` or `Terminating:Wait` state. You signal completion by calling `complete-lifecycle-action` via the CLI or SDK — or the hook times out after a configurable period (default 1 hour, maximum 48 hours) and the transition proceeds automatically.

A common exam pattern is: *an ASG must run a bootstrap script before instances receive traffic* — the answer is a lifecycle hook on the `Pending` state combined with a script that signals completion.

### Warm Pools

Cold start latency is a real concern when scaling out: a freshly launched instance takes time to boot, run User Data, and become healthy. **Warm pools** solve this by maintaining a pool of pre-initialized, stopped (or running) instances that are ready to be quickly promoted into the active fleet when demand increases. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-warm-pools.html)

Instances in the warm pool count against your account's EC2 limits but are cheaper to run if kept in a stopped state. When ASG needs to scale out, it pulls from the warm pool first before launching brand-new instances, significantly reducing the time-to-serve for new capacity.

### ASG Health Checks

ASG needs a way to determine whether an instance is healthy and should continue serving traffic, or whether it should be replaced. It supports two health check sources: [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)

- **EC2 health checks** (default) — ASG marks an instance unhealthy only if the underlying EC2 instance itself is in an impaired state (e.g., hardware failure, instance stopping unexpectedly). This check knows nothing about whether your application is actually responding correctly.
- **ELB health checks** — When an ASG is integrated with an Elastic Load Balancer, you can configure ASG to also trust the ELB's health check results. If the load balancer marks an instance as unhealthy (e.g., the application is returning 5xx errors or failing TCP checks), ASG will terminate and replace it.

For production workloads, ELB health checks are strongly preferred because they reflect actual application health, not just EC2 instance state. This is a frequent exam distinction: EC2 health checks alone won't replace an instance whose application has crashed but whose underlying VM is still running.

### Integration with ELB and ALB

ASG and ELB are almost always used together in exam scenarios. The integration works through **target groups**: you register the ASG with a target group, and the load balancer's listener rules route traffic to that group. As ASG scales out, new instances are automatically registered with the target group; as it scales in, they are deregistered before termination. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/attach-load-balancer-asg.html)

One important behavior to understand here is **connection draining** (called *deregistration delay* on ALB/NLB). When an instance is marked for termination, the load balancer stops sending new requests to it but allows in-flight requests to complete within a configurable grace period (default 300 seconds). This prevents abrupt connection drops for users whose requests are mid-flight. Combined with a lifecycle hook on the `Terminating` state, this gives you a clean, zero-disruption scale-in path.

For the exam, a common scenario looks like: *instances are being terminated while users experience dropped connections* — the fix is ensuring connection draining is enabled with an appropriate timeout, or extending the lifecycle hook timeout to allow graceful shutdown.