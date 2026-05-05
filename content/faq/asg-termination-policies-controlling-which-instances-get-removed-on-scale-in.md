---
title: "ASG Termination Policies: Controlling Which Instances Get Removed on Scale-In"
---

## ASG Termination Policies: Controlling Which Instances Get Removed on Scale-In

When your Auto Scaling Group decides to shrink—whether due to decreased demand, scheduled scaling, or manual intervention—AWS needs to pick which instances to terminate. This decision might seem trivial, but it has real consequences for your application's stability, your infrastructure costs, and your deployment strategy. Understanding termination policies transforms you from someone who sets up Auto Scaling and hopes for the best into someone who can architect resilient, cost-effective systems with predictable behavior.

Let's explore how Auto Scaling Groups make these critical decisions and how you can take control of the process.

### Why Termination Policies Matter

Imagine you're running a web application on a dozen instances. A scale-in event is triggered, and AWS needs to remove four of them. Which four should it choose? The naive answer—"it doesn't matter, they're all identical"—falls apart quickly when you consider real-world complexities.

If you're in the middle of a deployment, terminating a newly launched instance carrying the latest code is wasteful. If you're about to cross a billing hour boundary, terminating an instance one minute before the hour resets leaves you paying for a full hour you barely used. If you've explicitly marked certain instances as protected, they shouldn't be touched. These scenarios illustrate why termination policies exist: they let you encode business logic into your infrastructure's scaling behavior.

### The Default Termination Policy

By default, when you don't specify a custom termination policy, AWS Auto Scaling Group uses a combination of criteria applied in order:

First, it looks at the launch template or launch configuration. AWS terminates instances using the oldest launch configuration or template version. This makes intuitive sense: if you've updated your launch configuration with a new AMI or instance type, you want the older instances—potentially running stale software or less optimal hardware—to be the first to go during scale-in events.

Second, if multiple instances share the same launch configuration or template version, AWS picks the instance closest to the next billing hour. An AWS instance incurs a full hour of charges once it crosses into a new billing hour. Terminating an instance that's five minutes away from the next hour edge wastes less money than terminating one that just started its current hour. This is a subtle but powerful cost optimization.

Let's make this concrete. Suppose you have three instances, all launched five minutes apart from the same AMI:

- Instance A: launched at 10:00, now at 10:55 (five minutes until the next hour)
- Instance B: launched at 10:05, now at 10:55 (fifty-five minutes until the next hour)
- Instance C: launched at 10:10, now at 10:55 (fifty minutes until the next hour)

If a scale-in event removes one instance, the default policy terminates Instance A, saving you the cost of a full additional hour.

### Alternative Termination Policies

AWS provides several alternatives to the default policy, each optimized for different scenarios:

**OldestInstance** prioritizes terminating the instance that has been running the longest, regardless of launch configuration version. This is useful when you want to cycle through your fleet regularly, perhaps to apply OS patches or refresh cached data. However, it doesn't consider which version of your application code is running, so you might accidentally remove instances running your latest deployment.

**NewestInstance** does the opposite—it removes the most recently launched instances first. This is rarely useful in normal operations, but it can help in specific troubleshooting scenarios or when you've just deployed a change and want to quickly roll it back by scaling in the new instances first.

**OldestLaunchConfiguration** specifically targets instances created from the oldest launch configuration, completely ignoring the "closest to billing hour" consideration. This is valuable if your billing cycle matters less than ensuring your fleet uses the latest configuration as quickly as possible. For instance, if you've updated your launch configuration to use a more secure AMI, this policy ensures the old, less secure instances are removed preferentially.

**ClosestToNextInstanceHour** flips the priority: instead of terminating old launch configurations first, it purely focuses on billing hour optimization. This is your choice when all your instances are running the same code and configuration, and you want to minimize compute costs. During a large scale-in event, this policy can save substantial money by avoiding wasted billing hours.

**AllocationStrategy** aligns termination with your capacity allocation strategy. If you've configured your Auto Scaling Group to spread instances across availability zones using a balancing strategy, this policy terminates instances in ways that maintain that balance during scale-in. Similarly, if you're using a capacity-weighted allocation strategy (common when mixing instance types), it respects those weights during termination.

**Default** explicitly selects AWS's default behavior, useful when you want to be explicit in your infrastructure-as-code templates about which policy you're using.

### Combining Multiple Policies in Priority Order

Here's where termination policies become truly powerful: you can specify a comma-separated list of policies, and AWS applies them in order until one makes a decision.

For example, the policy string `OldestLaunchConfiguration,ClosestToNextInstanceHour` tells AWS: "First, terminate instances using the oldest launch configuration. If multiple instances use the same launch configuration, among those, terminate the one closest to the next billing hour."

This combination is common and sensible. You get the deployment freshness of OldestLaunchConfiguration combined with the cost optimization of ClosestToNextInstanceHour. Here's another useful combination: `AllocationStrategy,OldestLaunchConfiguration,ClosestToNextInstanceHour`. This says, "First, maintain capacity balance across zones; second, prefer old launch configurations; third, optimize billing."

When you're setting this via the AWS CLI, it might look like this:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-asg \
  --launch-template LaunchTemplateId=lt-0123456789abcdef0 \
  --min-size 2 \
  --max-size 10 \
  --desired-capacity 5 \
  --vpc-zone-identifier "subnet-12345678,subnet-87654321" \
  --termination-policies "OldestLaunchConfiguration" "ClosestToNextInstanceHour"
```

Or if you're updating an existing Auto Scaling Group:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name my-asg \
  --termination-policies "AllocationStrategy" "OldestLaunchConfiguration" "ClosestToNextInstanceHour"
```

The order matters. AWS evaluates policies left to right, so put your highest-priority consideration first.

### Protecting Instances from Termination

Sometimes you need to prevent specific instances from being terminated, even during scale-in events. This is where instance protection comes in handy.

You might protect an instance because it's running a critical housekeeping task, or you're in the middle of draining connections from it before it can safely shut down. The `set-instance-protection` API gives you this control:

```bash
aws autoscaling set-instance-protection \
  --instance-ids i-0123456789abcdef0 \
  --auto-scaling-group-name my-asg \
  --no-should-decrement-desired-capacity
```

The `--no-should-decrement-desired-capacity` flag is important: it tells Auto Scaling that even though this instance is protected, the desired capacity should stay the same. If you omit this flag (or use `--should-decrement-desired-capacity`), the desired capacity decreases but the instance remains running, effectively over-provisioning your fleet.

Protected instances are skipped during termination decisions. If you have five instances and three are protected during a scale-in event that removes two instances, AWS terminates two of the unprotected instances. However, if you try to scale in by more instances than are unprotected, the operation completes but your Auto Scaling Group retains more instances than desired.

You can query protection status:

```bash
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names my-asg \
  --query 'AutoScalingGroups[0].Instances[*].[InstanceId,ProtectedFromScaleIn]'
```

This reveals which instances are protected, helping you understand your current fleet state.

### Impact on Rolling Deployments

Rolling deployments—where you gradually replace instances running old code with instances running new code—interact meaningfully with termination policies.

When you update your launch template or configuration, new instances are launched with the new configuration, but old instances aren't automatically terminated. Your termination policy determines which old instances disappear first during the natural scaling process or during a deliberate scale-in to remove old instances.

Consider this scenario: you've updated your launch template and scaled up your Auto Scaling Group from 5 to 10 instances (adding 5 new instances with the latest code). Then you scale back down to 5 instances. With the default policy, AWS terminates the 5 old instances—exactly what you want. The new instances remain.

However, if you'd accidentally set your termination policy to `NewestInstance`, AWS would terminate the 5 new instances you just launched, leaving you with old code. This is a subtle but critical mistake.

A robust rolling deployment strategy typically uses `OldestLaunchConfiguration` as the primary termination policy. This ensures that as you gradually increase desired capacity with a new launch configuration, subsequent scale-in events remove old instances preferentially, completing the migration to new code.

When combined with Auto Scaling lifecycle hooks, you can implement even more sophisticated deployments. Lifecycle hooks pause instances during termination, giving them time to gracefully close connections, drain queues, or log final state before being removed. While the instance waits in the terminating state, your termination policy has already decided to remove it—the hook just provides a grace period.

### Best Practices for Termination Policies

Choose your termination policy based on what matters most to your application. If you're deploying frequently and want the latest code to be safe from termination, prioritize `OldestLaunchConfiguration`. If cost optimization is paramount and your instances are interchangeable, put `ClosestToNextInstanceHour` first.

Be explicit in your infrastructure-as-code templates. Don't rely on defaults; specify the exact policy you want. This makes your intent clear to future maintainers and prevents surprises when AWS defaults change (though they rarely do).

Test your policies in non-production environments. Trigger scale-in events and observe which instances are terminated. Does the behavior match your expectations? Are critical instances being protected appropriately?

Document why you chose your specific policy. A comment in your CloudFormation template or Terraform code explaining the reasoning prevents someone from "simplifying" your configuration later and breaking subtle requirements.

Consider using multiple policies in combination. The single-policy approach rarely captures all your requirements. Most production systems benefit from a three-part policy like `AllocationStrategy,OldestLaunchConfiguration,ClosestToNextInstanceHour`.

### Conclusion

Auto Scaling Group termination policies are a small corner of AWS infrastructure management, but they have outsized impact on your system's behavior during scale-in events. The default behavior—preferring old launch configurations and billing-hour optimization—works well for many applications, but understanding the alternatives and how to combine them lets you align scaling behavior with your specific operational needs.

Whether you're optimizing for cost, deployment freshness, or high availability, a thoughtfully chosen termination policy ensures that when AWS removes instances from your fleet, it removes the ones you'd choose if you had to do it manually. That's the essence of good infrastructure design: machines making decisions that humans would approve of.
