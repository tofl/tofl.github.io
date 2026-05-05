---
title: "DynamoDB On-Demand vs Provisioned Capacity: Cost Comparison and Switching Strategies"
---

## DynamoDB On-Demand vs Provisioned Capacity: Cost Comparison and Switching Strategies

When you create a DynamoDB table, you face one of the most consequential decisions in your AWS architecture: how should you pay for throughput? The choice between On-Demand and Provisioned capacity modes fundamentally shapes your operational costs, scaling behavior, and application flexibility. Get it right, and you're operating efficiently at any traffic level. Get it wrong, and you could be hemorrhaging money—either through over-provisioning you don't need or paying premium rates for unpredictable spikes.

This isn't a theoretical debate. The decision directly impacts your bill, your application's resilience, and the mental overhead of managing your infrastructure. In this article, we'll break down both capacity modes in practical terms, walk through cost calculations with real numbers, identify the break-even points where one mode becomes cheaper than the other, and show you how to switch between them strategically.

### Understanding DynamoDB's Two Capacity Modes

DynamoDB offers two fundamentally different pricing and scaling models, and understanding the mechanics of each is essential before you can make an intelligent choice between them.

**Provisioned Capacity** is the traditional model that's been around since DynamoDB's inception. You specify in advance how many read capacity units (RCUs) and write capacity units (WCUs) you need, and AWS reserves that throughput for you. You pay a fixed hourly rate for that reserved capacity, regardless of whether you actually use it. Think of it like a committed resource reservation—you're paying upfront for guaranteed availability. Within a single calendar day, you can scale provisioned capacity up as many times as you want, but there's a crucial restriction: you can only scale down once per day (or four times per day if you're within the free tier). This built-in throttle prevents you from gaming the system by constantly scaling down to save money.

**On-Demand Capacity** flips the model on its head. You don't reserve anything. Instead, you pay per request—specifically, per million read requests and per million write requests. DynamoDB automatically scales to handle whatever traffic arrives, instantly and without any upper limit. If your table suddenly receives ten times its normal traffic, DynamoDB serves it without batting an eye. You just pay more that hour. There's no pre-planning, no capacity forecasting, and no scaling delays. The tradeoff is that the per-request price is significantly higher than the per-unit price under provisioned capacity.

### The Pricing Mathematics: Making Them Comparable

To make an intelligent decision, you need to understand exactly how the pricing works and where the crossover point lies. Let's establish the numbers first, then work through some realistic scenarios.

As of current AWS pricing (and these rates vary by region, so always check your specific region), provisioned capacity in most US regions costs approximately $0.00013 per RCU-hour and $0.00065 per WCU-hour. That means if you provision 100 RCUs and 100 WCUs for an entire month, you're paying roughly $94 for reads and $468 for writes—a combined $562 for that capacity.

On-Demand pricing is expressed per million requests: approximately $1.25 per million read requests and $6.25 per million write requests. The relationship between requests and capacity units is important: one capacity unit provides one request per second, or roughly 86,400 requests per day. Over a month, that's approximately 2.6 million requests per capacity unit.

Let's convert that to an apples-to-apples comparison. If you use 1 RCU of provisioned capacity for a month, you're paying about $0.94. That same RCU, if fully utilized (86,400 requests per day), would generate about 2.6 million requests monthly. Under On-Demand pricing, 2.6 million reads would cost $3.25. So at full utilization, On-Demand is roughly 3.5 times more expensive per unit of capacity.

However, if your actual usage is only 10% of provisioned capacity, you're still paying 100% of the provisioned cost, while On-Demand would cost roughly 10% as much. This is the fundamental tension: provisioned capacity is cheaper at high utilization, On-Demand is cheaper at low utilization.

### Calculating Your Break-Even Point

The break-even analysis is where you move from theory to your actual decision. Here's how to think about it systematically.

Suppose you're considering a table with an estimated baseline of 50 RCUs and 20 WCUs. Over a month, that's roughly $94 for reads and $104 for writes—a combined $198. At what level of utilization does On-Demand become cheaper than provisioned?

If you provision 50 RCUs, you get 50 requests per second, or approximately 129.6 million read requests per month (at full utilization). If you only use 20% of that, you'd have 25.9 million requests. Under On-Demand, that would cost $32.38. You're still paying $94 for provisioned. At 20% utilization, provisioned is cheaper by $61.62.

Now suppose your workload varies wildly. Some days you need 200 RCUs to handle peak demand, other days you need only 10 RCUs. If you provision for the peak, you're paying $188 per month just for read capacity, even though you're only using that peak for a fraction of your time. On-Demand would charge you only for what you actually use. If your usage averages out to, say, 40 RCUs equivalent over the month, On-Demand might cost you $50, versus your $188 provisioned spend.

Here's a practical formula: estimate your monthly usage in requests. Divide by 1 million to get your On-Demand cost per service (read or write). Compare that to your provisioned cost. If On-Demand is cheaper, and you don't need the predictability or have spare budget, use On-Demand. If provisioned is cheaper and your utilization is relatively stable, use provisioned.

### When On-Demand Makes Business Sense

Beyond the pure math, certain workload characteristics strongly favor On-Demand, even if provisioned might theoretically be cheaper at average utilization.

**Unpredictable, bursty workloads** are the classic On-Demand use case. Imagine you're running a mobile app that goes viral. Traffic spikes from baseline 10 RCUs to 500 RCUs in the span of minutes. With provisioned capacity, you're either constantly on-call to scale up, or you've pre-provisioned for the spike and you're paying 95% of the time for capacity you don't need. On-Demand handles the spike transparently—you just pay for it when it happens.

**Development and testing environments** benefit enormously from On-Demand. When you're iterating on features, running integration tests, or deploying feature branches, you can't predict traffic patterns. Many teams over-provision dev tables just to be safe, paying for unnecessary capacity. Others under-provision and get throttled. On-Demand eliminates this guessing game. You pay only for what you actually use, and you never get throttled due to capacity limits.

**New applications with unknown demand** are another classic scenario. You're launching a new service, but you have no idea whether it'll get 1,000 users or 100,000 users in the first month. On-Demand lets you launch without a crystal ball. As your application stabilizes and traffic patterns become clear, you can analyze usage and potentially switch to provisioned capacity for better economics.

**Applications with variable multi-tenant workloads** can also favor On-Demand. If you're building a SaaS platform where customer usage patterns are independent and unpredictable, a single provisioned table might need to be sized for your noisiest customer, even if most customers use a fraction of that. On-Demand scales automatically to each customer's actual load.

**Cost-insensitive, low-volume applications** may simply be better off with On-Demand for operational simplicity. If your table handles 10 million requests per month total, On-Demand might cost you $50-$75. The difference between that and provisioned might only be $20-$30 per month—not worth the operational burden of managing provisioning and scaling policies.

### When Provisioned Capacity Wins

Conversely, provisioned capacity remains the right choice for many applications, particularly in production environments where you have predictable, sustained traffic.

If your workload is relatively stable—say, you consistently use 100 RCUs and 50 WCUs day in and day out—provisioned capacity is unambiguously cheaper. You'll spend about $235 per month, versus roughly $250-$300 for On-Demand at equivalent usage. The cost advantage compounds over time.

**High-volume applications** benefit dramatically from provisioned capacity. If you're processing millions of requests per day and your utilization is reasonably predictable, the per-request cost of On-Demand becomes prohibitive. A mature application with billions of monthly requests is almost always better served by provisioned capacity, where you can fine-tune your reservations and potentially leverage reserved capacity (a separate AWS product that offers discounts for multi-year commitments).

**Predictable daily or weekly patterns** are well-suited to Auto Scaling on provisioned capacity. Many applications have clear patterns: higher load during business hours, lower load at night; higher load on weekdays, lower on weekends. You can configure Auto Scaling rules to scale provisioned capacity up and down with your known patterns, getting much of the flexibility of On-Demand with the cost savings of provisioned.

**Regulated or mission-critical applications** may prefer provisioned capacity because it gives you explicit control and clear visibility. You're not at the mercy of per-request pricing spikes. You know your maximum monthly bill. That predictability can be valuable from a financial planning perspective, and from a compliance perspective it's sometimes easier to reason about.

### Auto Scaling on Provisioned Capacity vs On-Demand Scaling

One of the biggest misunderstandings developers have is that Auto Scaling on provisioned capacity is equivalent to On-Demand. It's not, and the difference matters.

When you use On-Demand capacity, DynamoDB scales instantly to meet demand. If your request rate jumps from 100 RCUs to 400 RCUs in a single second, DynamoDB handles it. There's no delay, no scaling lag, no risk of throttling during the ramp-up.

Auto Scaling on provisioned capacity works differently. You define scaling policies that trigger when CloudWatch metrics cross certain thresholds. For example, you might set a policy that scales up capacity whenever your utilization exceeds 70% for two consecutive minutes. When that condition is met, Auto Scaling gradually increases your provisioned capacity. This process takes time—typically several minutes—and your utilization might spike beyond your provisioned capacity before Auto Scaling can react. If your application is sensitive to throttling, that brief period of under-provisioning could cause errors.

However, Auto Scaling is still powerful. For workloads with gradual, predictable ramps (like traffic growing throughout the business day), Auto Scaling can provide most of On-Demand's flexibility at provisioned capacity costs. It's a middle ground.

The real limitation of Auto Scaling is sudden, unpredictable spikes. If traffic jumps tenfold in seconds, Auto Scaling's reaction time might not be fast enough, and you could get throttled. On-Demand handles this seamlessly.

### The Cost of Switching Between Capacity Modes

Once you've chosen a capacity mode, be aware that switching isn't free—not in terms of money, but in terms of time and operational considerations.

AWS enforces a critical restriction: you can switch between capacity modes a maximum of four times in a 24-hour period, and you must wait at least one hour between switches. This means you can't toggle back and forth rapidly. In practice, this means a capacity mode switch is a deliberate decision, not something you do lightly.

The switching process itself is immediate from a technical standpoint—your table remains online and accessible throughout the switch. But the restriction exists to prevent abuse and ensure stability. If you're planning to switch from provisioned to On-Demand (or vice versa), you need to be reasonably confident in that choice, knowing you can't easily revert for at least an hour.

This has practical implications. If you're running an experiment to compare costs between modes, you'll need at least 24 hours to switch back and forth, make measurements, and gather data. It's not something you can do in five minutes.

When you do switch, any Auto Scaling policies on the original provisioned capacity are deleted. If you switch back to provisioned later, you'll need to reconfigure those policies. There's no memory of your previous configuration.

### Real-World Cost Comparison Examples

Let's ground this in concrete scenarios so you can see how these considerations play out in practice.

**Scenario One: E-commerce catalog service**

Your application serves an online store with a product catalog. Traffic is stable and predictable: roughly 200 RCUs and 30 WCUs during business hours (16 hours per day), and 50 RCUs and 5 WCUs during off-peak hours (8 hours per day). You have well-defined peak and off-peak periods.

For provisioned capacity, you could provision for the peak: 200 RCUs and 30 WCUs. Monthly cost: approximately $188 for reads, $156 for writes, totaling $344. You're paying for peak capacity 24/7, but you only need it 16 hours per day.

Alternatively, you could set up Auto Scaling with a baseline of 50 RCUs and 5 WCUs, scaling up to 200 RCUs and 30 WCUs during peak hours. Your effective average becomes roughly 125 RCUs and 17 WCUs, costing approximately $118 for reads and $88 for writes, totaling $206. Auto Scaling saves you $138 per month.

On-Demand would cost you roughly $1.25 × 2.6 (million reads at average 125 RCUs) × 1.25 for the read cost, plus $6.25 × 0.44 (million writes at average 17 WCUs) for writes. That comes to approximately $4.06 for reads and $2.75 for writes per million monthly requests, totaling roughly $93 per month. In this scenario, On-Demand is cheaper than even Auto Scaling on provisioned.

**Scenario Two: High-volume API backend**

You're running a backend API for a SaaS product with millions of daily users. Traffic is very predictable: roughly 1,500 RCUs and 800 WCUs, with minimal variation (±10%). Your utilization is consistently high.

Provisioned capacity: 1,500 RCUs and 800 WCUs costs approximately $1,410 per month for reads and $3,120 for writes, totaling $4,530.

On-Demand for the same volume would cost you roughly $1.25 × 101.4 (million reads at 1,500 RCUs) plus $6.25 × 53.9 (million writes at 800 WCUs), totaling approximately $126.75 for reads and $337.25 for writes, or $464 per month. In this scenario, provisioned capacity is 10 times cheaper.

This is why mature, high-volume applications use provisioned capacity. The cost savings are enormous.

**Scenario Three: Startup MVP with unknown demand**

You're launching a new mobile app. You have no idea how many users you'll get or what their usage patterns will be. You estimate maybe 10-50 RCUs and 5-25 WCUs, but you're genuinely uncertain.

Provisioned capacity: You provision conservatively at 50 RCUs and 25 WCUs, spending approximately $94 + $130 = $224 per month. If your app takes off and you hit 500 RCUs and 250 WCUs of demand, you're throttled and losing money because you under-provisioned. If your app is a dud and averages 5 RCUs and 2 WCUs, you're wasting $210 per month on capacity you don't use.

On-Demand: You pay only for what you actually use. If you end up needing equivalent to 5 RCUs and 2 WCUs, you spend roughly $7-$10 per month. If your app explodes and you hit 500 RCUs and 250 WCUs, you pay roughly $641 per month, but you're not throttled and users have a good experience. On-Demand gives you flexibility during the uncertain phase. Once you've stabilized and know your actual traffic, you can analyze the data and switch to provisioned if it makes financial sense.

### Monitoring and Decision-Making

How do you actually make these decisions in your own AWS environment? The answer lies in CloudWatch metrics and historical analysis.

DynamoDB publishes metrics like `ConsumedReadCapacityUnits` and `ConsumedWriteCapacityUnits` to CloudWatch. Over a representative time period (at least a week, ideally a month), you can pull these metrics and calculate your actual usage. Look at your peak usage, your average usage, and the ratio between them.

If peak usage is more than two times your average, you're a candidate for On-Demand or Auto Scaling. If peak and average are similar, provisioned capacity is probably cheaper.

Check your utilization. DynamoDB's console shows you what percentage of your provisioned capacity you're actually consuming. If you're consistently using more than 80% of provisioned capacity, you're getting good value. If you're consistently using less than 30%, you're probably overpaying.

Look at your historical traffic patterns. Are they predictable and repeatable? Or chaotic and random? Predictability favors provisioned capacity, randomness favors On-Demand.

### Making the Switch: A Practical Workflow

If you decide to switch capacity modes, here's how to do it without downtime.

First, pick a change window, ideally during lower-traffic hours. While the switch itself is instantaneous, you want to monitor closely afterward.

Navigate to your DynamoDB table in the AWS Console, find the "Billing settings" or "Capacity" section (this has been reorganized in recent console updates), and look for the option to update capacity mode. You'll be prompted to confirm: you're switching from [current mode] to [new mode].

Click the switch. The operation completes within seconds. Your table remains fully accessible the entire time.

If you switched from provisioned to On-Demand, congratulations—you're done. If you switched to provisioned, you'll need to set your initial RCU and WCU values. AWS defaults to a conservative starting point, but you can adjust based on your expected usage.

After the switch, monitor CloudWatch metrics for the next hour to ensure everything is behaving as expected. Check for any unexpected throttling (if you switched to provisioned with too-low capacity) or cost anomalies (if you switched to On-Demand and traffic spiked).

Remember that 24-hour cooldown before your next switch. Use that time to gather data and be confident in your decision.

### Hidden Costs and Considerations Beyond Throughput

While throughput pricing is the main story, don't overlook other cost factors that interact with capacity mode.

**Transactional reads and writes** (using `TransactReadItems` and `TransactWriteItems`) consume double the capacity of standard operations. This matters for cost calculations but affects both capacity modes equally.

**Global Secondary Indexes (GSIs)** have their own provisioned capacity (or On-Demand if you've configured the table for it). If you're using GSIs heavily, ensure your capacity planning accounts for them. They can sometimes be a hidden scaling bottleneck.

**Data transfer out of DynamoDB** incurs charges. This is separate from throughput pricing. If you're exporting data frequently to analytics tools or other AWS services, factor that into your total cost picture.

**Point-in-time recovery and backups** add costs, but these are fixed and don't vary by capacity mode, so they don't affect your decision between modes.

**DynamoDB Streams** are free, but processing those streams through Lambda or Kinesis has its own costs that you should factor in separately.

### Conclusion

The choice between DynamoDB On-Demand and Provisioned capacity is fundamentally a choice between simplicity and cost optimization. On-Demand is simpler—no capacity planning, no scaling management, transparent scaling. Provisioned capacity is cheaper at high utilization and requires more operational management.

The decision isn't permanent. You can switch between modes up to four times per 24 hours, which means you can experiment and adjust as your workload evolves. The restriction exists to prevent gaming the system, but it's loose enough to allow legitimate optimization.

Start by analyzing your actual usage patterns using CloudWatch metrics. Calculate your break-even point using your region's current pricing. If you're uncertain or your traffic is bursty, try On-Demand—the peace of mind is worth a small cost premium. If your traffic is stable and predictable, run the math on provisioned capacity, potentially with Auto Scaling to handle predictable variation.

The best capacity mode for your application is the one that balances cost, operational burden, and reliability in a way that aligns with your specific needs. And because DynamoDB makes switching relatively frictionless, you can always experiment and iterate toward the right answer.
