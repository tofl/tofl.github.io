---
title: "DynamoDB Auto Scaling: Configuring Target Tracking for RCU and WCU"
---

## DynamoDB Auto Scaling: Configuring Target Tracking for RCU and WCU

When you first provision a DynamoDB table with fixed read and write capacity units, you're making a bet about what your application will need. Too conservative, and you're paying for resources you don't use. Too aggressive, and you risk throttling errors that degrade user experience. This is where DynamoDB Auto Scaling enters the picture—a managed service that watches your table's usage patterns and adjusts capacity automatically. Understanding how to configure it properly is essential for building cost-efficient, resilient applications on AWS.

### Understanding DynamoDB Capacity Modes and Why Auto Scaling Matters

DynamoDB offers two capacity modes: on-demand and provisioned. The on-demand mode is simple—you pay per request, and AWS handles all scaling automatically. But if your workload is predictable or has extended periods of low activity, provisioned mode with auto scaling can be significantly cheaper. The catch is that you need to understand how auto scaling works and configure it thoughtfully.

When you enable auto scaling on a provisioned DynamoDB table, you're essentially telling AWS, "I want you to automatically adjust my capacity between these bounds to maintain a target utilization level." This eliminates the manual capacity planning grind while protecting you from unexpectedly high bills or performance degradation.

### How DynamoDB Auto Scaling Works Under the Hood

DynamoDB Auto Scaling is built on top of Application Auto Scaling, the same service that powers scaling for EC2, RDS, and other AWS resources. Behind the scenes, it works through a system of CloudWatch metrics and alarms. DynamoDB continuously publishes metrics for your table's consumed read and write capacity. Application Auto Scaling monitors these metrics through CloudWatch alarms and evaluates whether current capacity matches your target utilization percentage.

The default target utilization is 70%, which means Application Auto Scaling aims to keep your consumed capacity at about 70% of your provisioned capacity. If consumption climbs above this threshold, an alarm triggers and capacity scales up. If consumption drops below the threshold, another alarm triggers and capacity scales down. This happens automatically, without any manual intervention.

It's helpful to think of this as a self-regulating system. DynamoDB is constantly asking: "Is the current consumption too high relative to what I've provisioned?" If yes, it provisions more. If no, and consumption is lower than needed, it deprovisions. The system balances itself around your target utilization.

### Setting Min and Max Capacity Bounds

Every auto scaling configuration requires two guardrails: minimum and maximum capacity units. These bounds define the range within which auto scaling can operate.

Your **minimum capacity** should reflect the baseline load your application expects during quiet periods. If your table serves a global application with users in multiple time zones, you might never truly reach zero traffic, so a minimum of 100 RCU and 50 WCU could be reasonable. Conversely, if you have a batch job that runs daily and your table is completely idle otherwise, you might set a minimum as low as 1 RCU and 1 WCU. The key is balancing cost savings against the reality of your application's off-peak behavior. Going too low on minimums can cause unexpected throttling if traffic arrives during a quiet period.

Your **maximum capacity** is your safety net. It prevents auto scaling from provisioning unlimited capacity in response to a runaway workload. This is critical for cost control. If you set a maximum of 10,000 RCU and 10,000 WCU, you're capping your potential bill from scaling at a predictable level. If your application suddenly experiences viral traffic that would require 20,000 RCU, auto scaling will provision up to your maximum and then stop—requests beyond that will be throttled. This sounds scary, but in practice, it's better than an unbounded bill. You can always increase your max capacity if needed.

Choosing these bounds requires understanding your traffic. Start by analyzing CloudWatch metrics from a few weeks of production traffic. Look at the peak RCU and WCU you've consumed. Your maximum should be comfortably above that peak to allow for growth and traffic spikes. Your minimum should be low enough to save money during quiet periods but high enough to avoid throttling when traffic isn't zero.

### Understanding Target Utilization and the 70% Default

The target utilization percentage (default 70%) is the core tuning knob for auto scaling behavior. It defines the "sweet spot" where Application Auto Scaling wants to keep your consumed capacity relative to provisioned capacity.

At 70% utilization, if your table is currently provisioned for 1,000 RCU, auto scaling aims for around 700 RCU of consumption. If consumption jumps to 800 RCU (above 70%), Application Auto Scaling increases provisioning. If consumption drops to 600 RCU (below 70%), it decreases provisioning.

The 70% default is AWS's recommendation for a reasonable balance. A higher target utilization (say, 90%) means you're running closer to your provisioned limit, which saves money but leaves less buffer for traffic spikes. A lower target utilization (say, 50%) means more headroom but potentially higher costs. In practice, unless you have strong reasons to change it, the 70% default works well.

It's worth noting that this percentage is applied separately to read and write capacity. You can configure different target utilization percentages for RCU and WCU if your workload characteristics differ significantly. However, most teams stick with the same target for both.

### The Critical Issue: Scaling Lag

Auto scaling doesn't happen instantaneously. There's a lag between when demand increases and when new capacity becomes available. This scaling lag typically spans **several minutes**, usually somewhere between 1 and 5 minutes depending on AWS's load and your specific circumstances.

Why does this matter? Imagine your table receives a sudden traffic spike. Your application immediately begins consuming more capacity. The consumed capacity climbs above your target utilization threshold, triggering a CloudWatch alarm. But the alarm doesn't fire instantly—it requires a few data points over time to confirm the trend. Once the alarm fires, Application Auto Scaling receives the signal and begins provisioning additional capacity. From request arrival to new capacity availability, you've lost several minutes.

During this lag window, your application might exceed the currently provisioned capacity and encounter throttling. This is why your minimum capacity buffer matters. If you know your typical peak is 1,000 RCU, but you've configured a minimum of 100 and a maximum of 1,500 with a 70% target, you're relying on auto scaling to keep you safe. But auto scaling won't save you from a sudden spike—only sufficient pre-provisioned capacity will.

The scaling lag is one reason why DynamoDB's on-demand mode exists. If your workload has frequent, unpredictable spikes, paying per request is often simpler and cheaper than tuning provisioned mode with auto scaling.

### Why You Need a Capacity Buffer

This brings us to a fundamental principle: auto scaling works best when your workload is relatively predictable, and you maintain a buffer above your expected throughput.

Consider a real example. You run a social media platform where posts peak during lunch hours (12 PM to 1 PM) and evenings (7 PM to 9 PM). Your analysis shows peak consumption is 800 RCU. You configure auto scaling with a minimum of 100 RCU, a maximum of 2,000 RCU, and a 70% target utilization.

During off-peak hours, consumption drops to 50 RCU, so auto scaling deprovisions to your minimum of 100 RCU. As lunch approaches and consumption rises to 400 RCU, auto scaling begins increasing provisioning. But with a 70% target, auto scaling maintains 570 RCU (roughly 70% utilization at 400 RCU consumption). By the time consumption reaches 800 RCU, auto scaling has had time to adjust provisioning to approximately 1,140 RCU.

This works smoothly because the ramp-up is gradual. Auto scaling has time to react.

Now imagine an unexpected event—a celebrity mentions your platform in a tweet. Traffic explodes from 400 RCU to 5,000 RCU in 30 seconds. Your provisioned capacity hasn't had time to scale yet. You're immediately throttled.

The buffer concept means this: don't rely on auto scaling alone for predictable traffic patterns. Instead, set your minimum capacity to cover your normal, expected baseline. Then allow auto scaling to handle growth above that baseline and to scale down during quiet periods. In the celebrity tweet scenario above, you'd want minimum capacity of at least 1,200 RCU (above your expected peak) so that you start with sufficient capacity even before auto scaling has time to react.

The buffer is insurance. It costs more at rest, but it prevents throttling during foreseeable peak periods and gives auto scaling time to handle traffic beyond that peak.

### Key Limitations of DynamoDB Auto Scaling

Auto scaling is powerful, but it has real limitations you should understand.

**It does not scale below historical peak.** This is perhaps the most important constraint. Auto scaling tracks the highest capacity your table has ever needed. It will never deprovision below that peak. If your table ever consumed 5,000 RCU in the past (perhaps due to a one-time data migration), auto scaling will never scale down below 5,000 RCU unless you manually adjust the minimum capacity. This prevents tragic scenarios where you lose access to needed capacity, but it can inflate your costs if you run a large one-time job and forget to adjust settings afterward.

You can always manually adjust your minimum capacity downward, but this is a deliberate action, not automatic. Be disciplined about resetting auto scaling configuration after temporary workload changes.

**It does not handle sudden, severe spikes well.** As discussed, the lag between demand spike and capacity increase means you'll encounter throttling if traffic suddenly multiplies. Auto scaling is designed for gradual ramp-ups, not flash traffic. If your workload is prone to sudden spikes, you should either set your minimum higher, use on-demand mode, or implement client-side throttling and retry logic to gracefully handle temporary throttling.

**It applies only at the table level.** Auto scaling is configured per table, not per partition or per secondary index. If you have a global secondary index with different access patterns than your base table, you can configure separate auto scaling for the index, but there's no option to scale based on individual partition hot spots. If one partition key is receiving disproportionate traffic, you'll need to provision for the entire table's peak, even if other partitions are idle.

**There is a cooldown period.** After scaling up or down, Application Auto Scaling enters a cooldown period (by default a few minutes) during which it won't initiate another scaling action. This prevents rapid oscillation around your target utilization but also means it can't respond to quick successive changes in demand.

### Configuring Auto Scaling in Practice

Let's walk through the practical steps. You can configure auto scaling through the AWS Management Console, the AWS CLI, or Infrastructure as Code tools like CloudFormation or Terraform.

Through the Console, navigate to your DynamoDB table's "Auto Scaling" tab. You'll see separate configuration panels for Read Capacity and Write Capacity. For each, you specify:

1. A minimum capacity (in RCU or WCU)
2. A maximum capacity
3. A target utilization percentage

For example, for a read-heavy analytics table, you might set:
- Minimum RCU: 100
- Maximum RCU: 5,000
- Target Utilization: 70%

And for writes (since this table is read-heavy):
- Minimum WCU: 10
- Maximum WCU: 500
- Target Utilization: 70%

Via the AWS CLI, you'd use the `register-scalable-target` command to register the table with Application Auto Scaling, then use `put-scaling-policy` to create the target tracking policy. Here's a conceptual example:

```bash
aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/MyTable \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --min-capacity 100 \
  --max-capacity 5000

aws application-autoscaling put-scaling-policy \
  --policy-name my-read-scaling-policy \
  --service-namespace dynamodb \
  --resource-id table/MyTable \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    TargetValue=70,PredefinedMetricSpecification={PredefinedMetricType=DynamoDBReadCapacityUtilization}
```

In Infrastructure as Code, most tools abstract this into a single configuration block, making it simpler. The conceptual approach remains the same: define min, max, and target utilization.

### Monitoring Auto Scaling Activity

After configuration, monitor your auto scaling behavior through CloudWatch. The key metrics to watch are:

**ConsumedReadCapacityUnits and ConsumedWriteCapacityUnits** show your actual usage. Compare these to your provisioned capacity to see how close you're running to your target utilization.

**ProvisionedReadCapacityUnits and ProvisionedWriteCapacityUnits** show what you're currently paying for. Healthy auto scaling means this value fluctuates with demand, not staying constant.

**UserErrors and system-level throttling metrics** indicate problems. If you see frequent throttling, your minimum capacity is too low or your target utilization is too aggressive.

Through CloudWatch Logs, you can also see the history of scaling events—when auto scaling provisioned up or down and why. This helps you understand whether your configuration is responsive to real traffic patterns.

### Cost Optimization with Auto Scaling

Auto scaling's primary value is cost optimization. Consider a table with highly variable traffic. Using fixed provisioned capacity, you'd need to provision for peak demand, paying for unused capacity during off-peak hours. With auto scaling, you pay for peak capacity only during peak hours and scale down during quiet periods.

If your peak demand is 1,000 RCU and your baseline is 100 RCU, and your traffic spends 8 hours per day at peak and 16 hours at baseline, auto scaling can reduce costs significantly. Fixed provisioning costs 1,000 RCU × 730 hours/month. Auto scaling costs approximately (100 × 16 + 1,000 × 8) / 24 hours/day averaged, which is much lower.

However, don't assume auto scaling is always cheaper. If your workload is consistently high (say, 80% peak capacity utilization most of the time), provisioned mode might already be cost-effective. Run the numbers against your actual usage patterns.

### Real-World Considerations

In production, auto scaling works well for most use cases when configured thoughtfully. A few practical tips:

Start with conservative settings. It's easier to adjust your target utilization or capacity bounds after observing real behavior than to react to unexpected throttling.

Don't set your target utilization too high (above 80%) unless you're confident your workload has smooth, predictable ramps. Higher targets save money but reduce your buffer for sudden changes.

Regularly review your minimum capacity after major workload changes. If you run a large data import, remember to adjust the minimum back down when it's complete.

Use on-demand mode for truly unpredictable workloads. Auto scaling is powerful, but on-demand is simpler and often cheaper for bursty, uneven traffic patterns.

### Conclusion

DynamoDB Auto Scaling, built on Application Auto Scaling and CloudWatch alarms, is a practical tool for balancing cost and performance. By setting appropriate minimum and maximum capacity bounds and understanding the default 70% target utilization, you can build tables that adapt to your workload automatically. The key is recognizing that auto scaling reacts to trends over minutes, not seconds, so maintaining an appropriate capacity buffer is essential for handling gradual traffic growth and foreseeable peaks. Combined with careful monitoring and an understanding of its limitations—particularly that it won't scale below historical peaks and won't protect against sudden spikes—auto scaling becomes a reliable component of your DynamoDB strategy. Whether you're optimizing costs for a mature application or designing a new system, thoughtful auto scaling configuration pays dividends in both operational simplicity and cloud spending.
