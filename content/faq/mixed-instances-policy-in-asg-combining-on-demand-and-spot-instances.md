---
title: "Mixed Instances Policy in ASG: Combining On-Demand and Spot Instances"
---

## Mixed Instances Policy in ASG: Combining On-Demand and Spot Instances

When you're running applications on AWS, one of the most impactful cost optimization strategies is intelligently blending On-Demand and Spot instances within the same Auto Scaling Group. This approach lets you maintain the reliability guarantees of On-Demand capacity while capturing the significant savings that Spot instances offer—typically 70–90% cheaper than their On-Demand counterparts. However, implementing this strategy correctly requires understanding several interlocking concepts: launch templates, capacity parameters, and allocation strategies.

In this guide, we'll explore how to configure a mixed instances policy in an Auto Scaling Group, examine the parameters that control the balance between On-Demand and Spot, and walk through practical examples that show why this matters for both your wallet and your application's resilience.

### Why Mix Instance Types in a Single ASG?

Before diving into configuration details, let's establish why you'd want to do this in the first place. Imagine you're running a web application that normally requires 10 instances to handle traffic. If you launched all 10 as On-Demand instances, you'd pay the full on-demand rate for every instance, every hour. But what if you could run 2 of those instances as reliable On-Demand capacity and the remaining 8 as Spot instances? You'd maintain a guaranteed baseline of reliable capacity while dramatically reducing your overall bill.

The trade-off is that Spot instances can be interrupted with minimal notice when AWS needs the underlying capacity back. By combining the two, you gain cost efficiency without sacrificing the core availability your application requires. The ASG will handle replacement of interrupted Spot instances automatically, and your On-Demand base ensures you always have a minimum of predictable, uninterruptible capacity.

### Launch Templates: A Prerequisite, Not Optional

To use a mixed instances policy, you must first understand that it requires a **launch template**, not the older launch configuration. This is a hard requirement, not a preference. Launch templates are the modern AWS construct that support the flexibility needed for mixed instance policies; launch configurations are simpler but inflexible and deprecated for new use cases.

A launch template defines the baseline configuration for your instances: AMI, instance type, key pair, security groups, monitoring settings, and so on. However, with a mixed instances policy, you'll override the instance type specified in the template. Think of the launch template as providing the "everything except instance type" specification, and the mixed instances policy as saying "now launch this template with these specific instance types, in this proportion."

Here's a simplified launch template you might create:

```bash
aws ec2 create-launch-template \
  --launch-template-name my-app-template \
  --version-description "Production web server" \
  --launch-template-data '{
    "ImageId": "ami-0c55b159cbfafe1f0",
    "InstanceType": "t3.medium",
    "KeyName": "my-keypair",
    "SecurityGroupIds": ["sg-12345678"],
    "Monitoring": {"Enabled": true},
    "UserData": "IyEvYmluL2Jhc2gKZWNobyBcIkhlbGxvIFdvcmxkXCIK"
  }'
```

Notice the `InstanceType` is specified—but when you use this template in a mixed instances policy, that type becomes a default that you'll override. The policy gives you the power to say "use this template, but launch instances with types t3.medium, t3.large, or t2.medium instead of just t3.medium."

### Understanding OnDemandBaseCapacity

The first knob you'll turn when configuring a mixed instances policy is `OnDemandBaseCapacity`. This parameter defines the absolute minimum number of On-Demand instances that the ASG will always maintain, regardless of scaling activity.

If you set `OnDemandBaseCapacity` to 3, then at minimum, 3 instances will always be On-Demand. If the ASG scales up to 10 total instances, those first 3 will be On-Demand. If it scales to 20, still 3 will be On-Demand. The other 17 will be determined by the next parameter we'll discuss.

This serves a critical purpose: it guarantees you have a floor of stable, uninterruptible capacity. You'd typically set this to the minimum capacity needed to keep your application functional even if all Spot instances are interrupted simultaneously. For a web service, this might be 2 or 3 instances. For a batch processing job with no real-time requirements, it might be 0.

### Controlling Spot vs. On-Demand Above the Base: OnDemandPercentageAboveBaseCapacity

Once you've established your On-Demand base, every instance you add beyond that base is governed by `OnDemandPercentageAboveBaseCapacity`. This parameter defines what percentage of the capacity above the base should be On-Demand instances.

Let's work through an example. Suppose your ASG has:
- `OnDemandBaseCapacity`: 2
- `OnDemandPercentageAboveBaseCapacity`: 20
- Desired capacity: 10

Here's the math:
- First 2 instances: On-Demand (the base)
- Remaining 8 instances: governed by the 20% parameter
- 20% of 8 = 1.6, rounded to 2 instances On-Demand
- The other 6 are Spot

So you'd have 4 On-Demand instances and 6 Spot instances for a 10-instance ASG. That's roughly a 40% On-Demand ratio overall, but the configuration itself says 20% above base—the base inflates the actual On-Demand percentage.

If you wanted all capacity above the base to be Spot, you'd set `OnDemandPercentageAboveBaseCapacity` to 0. If you wanted everything to be On-Demand (which defeats the purpose but is valid), you'd set it to 100.

### Spot Allocation Strategies: Choosing How to Distribute Risk

AWS offers multiple strategies for deciding which Spot instance types to launch when you have several options. Each strategy makes different trade-offs between cost, availability, and resilience to interruptions.

**Lowest-Price Strategy**

The simplest strategy is `lowest-price`. When the ASG needs to launch a Spot instance, it looks at the Spot prices of all the instance types you've specified and launches whichever is cheapest at that moment. This minimizes your immediate cost but creates a concentration risk: if AWS needs that cheap instance type back, you could lose many instances in one interruption event.

**Capacity-Optimized Strategy**

`capacity-optimized` is often the better choice. Instead of picking the cheapest option, this strategy launches instances from the instance types that have the lowest interruption rates (based on historical data that AWS tracks). The reasoning is elegant: by spreading your Spot instances across types with lower interruption frequencies, you reduce the likelihood of simultaneous failures. You might pay slightly more than the absolute lowest-price option, but you gain reliability.

**Capacity-Optimized with Prioritization**

`capacity-optimized-prioritized` is a variant where you provide an ordered list of instance types. AWS still uses capacity-optimization logic, but respects your priority ranking when possible. This is useful when you have a preferred instance type (perhaps one you've tested extensively with your application) and want to use it when capacity allows, but fall back to others if needed.

**Price-Capacity-Optimized Strategy**

The newest strategy, `price-capacity-optimized`, balances both concerns. It considers both the Spot price and the interruption rate, attempting to find instance types that offer good pricing without excessive interruption risk. This is a practical middle ground for many workloads.

### Practical Configuration Example

Let's build a complete mixed instances policy for a realistic scenario. Imagine you're running a content delivery application with the following requirements:

- You want to run at least 3 instances all the time (On-Demand base)
- You're willing to run up to 15 instances during peak traffic
- You want to keep roughly 33% of your total capacity as On-Demand (a good balance for many applications)
- You prefer t3 instances for performance, but can tolerate t2 or even t4g instances if Spot prices dictate

Here's how you'd structure this. First, you'd create a launch template as shown earlier. Then you'd create your ASG with a mixed instances policy:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-app-asg \
  --min-size 3 \
  --max-size 15 \
  --desired-capacity 10 \
  --vpc-zone-identifier "subnet-12345678,subnet-87654321" \
  --mixed-instances-policy '{
    "LaunchTemplate": {
      "LaunchTemplateSpecification": {
        "LaunchTemplateName": "my-app-template",
        "Version": "$Latest"
      },
      "Overrides": [
        {
          "InstanceType": "t3.medium",
          "WeightedCapacity": "1"
        },
        {
          "InstanceType": "t3.large",
          "WeightedCapacity": "2"
        },
        {
          "InstanceType": "t2.medium",
          "WeightedCapacity": "1"
        },
        {
          "InstanceType": "t4g.medium",
          "WeightedCapacity": "1"
        }
      ]
    },
    "InstancesDistribution": {
      "OnDemandBaseCapacity": 3,
      "OnDemandPercentageAboveBaseCapacity": 50,
      "SpotAllocationStrategy": "capacity-optimized"
    }
  }'
```

Let's break down what you've configured:

The `Overrides` section lists the instance types you're willing to launch. Notice the `WeightedCapacity` field—this lets you account for different instance sizes. A t3.large is roughly twice as powerful as a t3.medium, so you assign it a weight of 2. When the ASG scales to 10 instances with a desired capacity of 10, it might launch a mix like 5 t3.medium instances, 2 t3.large instances, and 3 t2.medium instances—all adding up to 10 capacity units.

With `OnDemandBaseCapacity` of 3, you guarantee 3 On-Demand instances always. Of the remaining 7 capacity units, 50% (3.5, rounded up to 4) should be On-Demand. So you'd end up with roughly 7 On-Demand and 3 Spot instances.

The `capacity-optimized` strategy ensures that when the ASG launches Spot instances, it picks types that historically have lower interruption rates, reducing your risk of cascading failures.

### Cost and Resiliency Benefits in Practice

Let's quantify the impact. Assume On-Demand t3.medium instances cost $0.0416 per hour, and Spot instances of the same type average $0.0125 per hour (roughly 70% savings). If you run that 10-instance example 24 hours a day for a month:

- All On-Demand: 10 × $0.0416 × 24 × 30 = $2,995
- Mixed (7 On-Demand, 3 Spot): (7 × $0.0416 + 3 × $0.0125) × 24 × 30 = $2,265

You've saved roughly 24% on your compute costs by using mixed instances, without sacrificing the availability guarantees that your On-Demand base provides. For larger scale operations, these savings compound significantly.

On the resilience front, imagine a Spot interruption event affects one of your 3 Spot instances. Your ASG immediately launches a replacement—because you've specified multiple instance types in your overrides, the replacement might come from a different type with better availability. Your 7 On-Demand instances keep your application running smoothly throughout the interruption.

### Fine-Tuning for Your Workload

The right balance between On-Demand and Spot depends on your specific requirements. A stateless web service might comfortably run with `OnDemandPercentageAboveBaseCapacity` set to 20%, reserving a small On-Demand base and letting Spot handle most of the load. A stateful application that's slow to initialize might prefer 50% or higher above the base to minimize the impact of Spot interruptions.

Similarly, the choice of allocation strategy depends on your priorities. If cost is paramount and your application tolerates the occasional interruption, `lowest-price` might be acceptable. If you want the best of both worlds—good pricing and low interruption frequency—`capacity-optimized` or `price-capacity-optimized` are typically the smarter defaults.

You can also adjust these settings over time. Start conservative (higher On-Demand percentage, lower risk) and gradually increase your Spot ratio as you gain confidence that your monitoring and replacement procedures handle interruptions smoothly.

### Monitoring and Alerts

When you're running mixed instances, observing whether your policy is behaving as expected becomes important. CloudWatch metrics for your ASG will show you the total number of instances, but you'll want to use the AWS Console or CLI to verify the actual split between On-Demand and Spot.

The ASG's activity log will show you when Spot instances are being replaced due to interruptions. If you see frequent interruptions of the same instance type, that's a signal to reconsider your allocation strategy or diversify further into additional instance types.

### Conclusion

A mixed instances policy in your Auto Scaling Group is one of the highest-leverage cost optimization techniques available in AWS. By maintaining a guaranteed base of On-Demand capacity while letting Spot instances handle the excess, you achieve significant savings without sacrificing the reliability that production applications demand.

The key to success is understanding the three core concepts: using a launch template as your configuration foundation, setting an appropriate On-Demand base and percentage above that base, and choosing an allocation strategy that matches your tolerance for interruptions. Start with `capacity-optimized` as your allocation strategy and a 30–50% On-Demand ratio above the base, then adjust based on your application's behavior and your cost targets.

As your AWS experience grows, you'll find that mixed instances policies become a standard part of your architecture for any stateless or loosely coupled workload. Combined with proper monitoring and alerting, they're a practical way to optimize costs without trading away the operational excellence that your users expect.
