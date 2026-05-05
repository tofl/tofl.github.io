---
title: "Kinesis Provisioned vs On-Demand Capacity Mode: Cost and Performance Trade-offs"
---

## Kinesis Provisioned vs On-Demand Capacity Mode: Cost and Performance Trade-offs

When you're designing a real-time data streaming architecture on AWS, one of the first and most consequential decisions you'll make is how to configure capacity for your Kinesis Data Streams. Should you provision a fixed number of shards and pay a predictable hourly rate? Or should you let AWS automatically scale your capacity based on demand and pay per gigabyte of data ingested? This choice touches everything from your monthly cloud bill to how your application handles traffic spikes, and it's far more nuanced than simply picking the cheaper option.

The reality is that neither capacity mode is universally superior. Provisioned mode excels when you have predictable, steady workloads and want the lowest possible cost at scale. On-Demand mode shines when your traffic patterns are unpredictable, your application is brand new and you're still learning demand patterns, or when you need the peace of mind that comes with automatic scaling. In this article, we'll walk through the mechanics of both modes, work through detailed cost calculations, and give you a framework for choosing the right approach for your workload.

### Understanding Kinesis Capacity Basics

Before diving into the differences, let's establish the foundational unit: the shard. A Kinesis shard is the basic throughput unit of a stream. Each shard provides a guaranteed amount of ingestion and consumption capacity, and you pay based on how many shards you provision or, in the case of On-Demand, how much data you actually push through the system.

The key distinction between the two modes boils down to this: **Provisioned mode is capacity you own; On-Demand mode is capacity you rent.** In Provisioned mode, you decide upfront exactly how many shards you need and pay for them whether you use them fully or not. In On-Demand mode, you don't specify shards at all—you just start sending data, and AWS automatically provisions shards to handle your traffic, scaling them up and down based on observed demand patterns.

### Provisioned Mode: Predictable Costs, Fixed Capacity

In Provisioned mode, you explicitly specify the number of shards your stream requires. Each shard provides fixed throughput: 1 MB per second (or 1,000 records per second) for writes, and 2 MB per second for reads across all consumers.

The pricing model is straightforward: you pay per shard-hour. At the time of writing, this rate is approximately $0.015 per shard per hour in most AWS regions, though you should always verify current pricing in the AWS pricing calculator. This means that if you provision 10 shards running continuously for a month (30 days), your cost would be:

10 shards × 24 hours/day × 30 days × $0.015/shard-hour = $108

That's predictable and easy to forecast. If your workload grows, you scale up by adding shards. If it shrinks, you can remove shards. The operations are straightforward—you simply update the shard count through the AWS Management Console, the CLI, or your infrastructure-as-code tool of choice.

The advantage here is that once you've sized your stream correctly, you know exactly what you're paying. For businesses with steady, predictable workloads, this is the path to the lowest total cost of ownership. A well-designed system that processes a consistent 50 MB of data per second every single day will almost always cost less in Provisioned mode than in On-Demand.

However, Provisioned mode demands that you know your throughput requirements upfront. If you provision too conservatively, you'll hit throttling errors when traffic exceeds your shard capacity. If you provision too generously, you're paying for unused capacity. This is where many teams run into trouble—getting the sizing right requires either historical data, load testing, or educated guesses based on similar systems.

### On-Demand Mode: Scaling Flexibility, Variable Costs

On-Demand mode inverts the model entirely. You don't provision shards; instead, AWS automatically allocates capacity as needed based on your traffic. You pay per gigabyte of data ingested into the stream, at approximately $0.50 per GB in most regions (verify current pricing in your AWS region).

The automatic scaling behavior is where On-Demand becomes interesting—and occasionally surprising. When you enable On-Demand mode, AWS observes your peak traffic over a rolling 30-day window and automatically provisions shards to handle roughly twice that observed peak. This two-times multiplier is built in to provide headroom for sudden spikes beyond what's been seen in the past month.

Let's make this concrete. Suppose your stream in On-Demand mode has been running for a month, and the observed peak write throughput was 10 MB per second. AWS will automatically provision shards to handle approximately 20 MB per second, even if you never actually reach that level in the future. This buffer protects you against unexpected traffic surges, but it also means you're paying for more capacity than your recent history strictly requires.

The advantage is obvious: you don't have to predict or manage capacity. If traffic doubles overnight, your stream automatically scales. If it halves, shards are removed. This is liberating for teams building new applications where demand patterns aren't yet clear, for systems with highly seasonal or unpredictable traffic, and for any scenario where capacity forecasting is simply too difficult.

The trade-off is straightforward: you'll pay a premium for this convenience. For predictable, steady workloads, On-Demand is almost always more expensive than Provisioned mode. But for variable or unknown workloads, the ability to avoid capacity management and the guarantee that you won't be throttled can easily justify the higher unit cost.

### Detailed Cost Comparison Examples

Let's ground this discussion in real numbers. Consider three different workload scenarios and calculate the monthly cost under each capacity mode.

**Scenario 1: Steady, predictable workload**

Your application ingests a constant 5 MB per second, 24 hours a day, 30 days a month. No spikes, no valleys—just reliable, steady streaming.

In Provisioned mode: You need at least one shard to handle 5 MB/s (since one shard handles up to 1 MB/s for writes, you'd actually need 5 shards). Cost: 5 shards × 24 hours × 30 days × $0.015/shard-hour = $54/month.

In On-Demand mode: You're ingesting 5 MB/s × 86,400 seconds/day × 30 days = 12,960 GB/month. Cost: 12,960 GB × $0.50/GB = $6,480/month.

In this scenario, Provisioned mode wins decisively. You're paying about $54 versus $6,480—more than 100 times cheaper. This is why high-volume, steady-state workloads almost always use Provisioned mode.

**Scenario 2: Unpredictable, variable workload**

Your application processes IoT sensor data from outdoor weather stations. Traffic surges during severe weather events but is minimal during calm conditions. Over the past month, you've observed peaks of 20 MB/s during storms but averages around 2 MB/s. You've had weeks where peak demand was only 5 MB/s and weeks where it hit 20 MB/s.

In Provisioned mode, you need to decide what to provision for. If you provision for the observed peak of 20 MB/s (requiring 20 shards), your cost is: 20 shards × 24 hours × 30 days × $0.015/shard-hour = $216/month. But if demand drops and you never see peaks above 10 MB/s again, you've overprovisioned. Conversely, if you provision for what you think is typical (say, 10 shards), you risk throttling during the next storm.

In On-Demand mode: Your stream observes the peak of 20 MB/s and automatically scales to handle twice that—40 MB/s of capacity. If you've averaged 5 MB/s of actual ingestion over the month, you're pushing: 5 MB/s × 86,400 seconds × 30 days = 12,960 GB. Cost: 12,960 GB × $0.50/GB = $6,480/month.

Wait—that doesn't match our Scenario 1 numbers. Let me recalculate with more realistic numbers for a variable workload. If you're averaging 2 MB/s with peaks of 20 MB/s: 2 MB/s × 86,400 × 30 = 5,184 GB. Cost: 5,184 GB × $0.50/GB = $2,592/month. For Provisioned, if you provision 20 shards to handle the peak, you'd pay $216/month. If you provision 10, you pay $108/month but risk throttling.

Here, the analysis depends heavily on your risk tolerance and your ability to handle throttling. If throttling is acceptable and temporary during spikes, Provisioned at 10 shards ($108) is cheapest. If you need to handle peak traffic without throttling, Provisioned at 20 shards ($216) is still cheaper than On-Demand ($2,592), but the gap is much smaller than in Scenario 1.

**Scenario 3: Brand new application with unknown demand**

You're launching a new mobile application and have no historical data on how much streaming data you'll actually need. You expect somewhere between 500 MB and 5 GB per day during peak times, but you're genuinely uncertain.

In Provisioned mode: You might provision 10 shards conservatively, costing 10 × 24 × 30 × $0.015 = $108/month. If actual demand is only 1 MB/s, you're massively overprovisioned and wasting money. If it's 8 MB/s, you're throttling users and degrading your experience.

In On-Demand mode: You start the stream, users begin sending data, and AWS automatically provisions whatever capacity you need. If you end up using 1 TB of data in a month, you pay $500. If it's 10 TB, you pay $5,000. The cost is proportional to actual usage, with automatic scaling built in.

For an unproven application, On-Demand removes the guessing game. You pay more per unit of data, but you avoid the risk of both over-provisioning and under-provisioning. Many teams use On-Demand initially to understand their actual demand patterns, then switch to Provisioned mode once the workload is well understood and steady.

### The Automatic Scaling Mechanism in On-Demand

Understanding exactly how On-Demand scaling works is crucial for predicting your costs and avoiding surprises. AWS does not scale shards up and down based on real-time demand. Instead, it uses a retrospective approach: it looks at your peak traffic over the past 30 days and automatically provisions shards to handle roughly twice that peak.

This has several practical implications. First, if your application experiences a genuine traffic spike beyond anything seen in the past 30 days, On-Demand will eventually scale to handle it, but there may be a lag—potentially causing temporary throttling or degraded performance while scaling is in progress. AWS attempts to scale proactively when it detects increasing trends, but it's not truly real-time.

Second, the two-times multiplier is built in for safety, but it means your actual provisioned capacity may be significantly higher than your recent average usage. If your peak over 30 days was 10 MB/s but you only reached that peak once during a brief event, AWS is still provisioning 20 MB/s of capacity (which translates to 20 shards) for the rest of the month, even though average usage is much lower.

Third, if your workload genuinely has a long-term trend—say, growing 10% week over week—On-Demand will gradually provision more shards to keep pace. This is good for handling growth automatically, but it also means your monthly bill will increase over time without explicit action on your part.

### Switching Between Capacity Modes

AWS does allow you to change between Provisioned and On-Demand modes, but there's an important constraint: you can update your stream's capacity mode a maximum of twice per 24-hour period. This is a rate limit built into the Kinesis API to prevent abuse and ensure stability.

The practical implication is that you can't rapidly flip between modes in response to daily demand fluctuations. If you're experimenting with costs or testing which mode suits your workload better, plan to leave the stream in each mode for at least a day or two to observe behavior.

Changing modes is straightforward via the AWS CLI. To switch to On-Demand:

```bash
aws kinesis update-stream-mode --stream-name my-stream \
  --stream-mode-details StreamMode=ON_DEMAND
```

To switch back to Provisioned:

```bash
aws kinesis update-stream-mode --stream-name my-stream \
  --stream-mode-details StreamMode=PROVISIONED,DesiredShardCount=10
```

When you switch from Provisioned to On-Demand, AWS automatically determines the number of shards based on your recent peak traffic. When you switch from On-Demand to Provisioned, you must explicitly specify how many shards you want—this is where understanding your actual throughput requirements becomes critical.

### Performance and Throughput Limits

Each shard in Provisioned mode supports up to 1 MB per second (or 1,000 records per second, whichever limit is hit first) for writes and 2 MB per second aggregate for all consumers reading from that shard. These are hard limits; exceed them and you'll get throttling errors.

On-Demand mode doesn't have explicit per-shard limits that you interact with—the limits are proportional to how many shards AWS has provisioned on your behalf. However, there's an important detail: On-Demand mode does have account-level burst capacity limits and regional quotas. These are generous (typically 4,000 MB/s per account per region), but they exist. For the vast majority of applications, this is not a constraint.

One nuance worth understanding: in On-Demand mode, you get better burst handling. AWS provisions shards based on your 30-day peak, and those shards are provisioned to handle roughly twice that peak. If you have a sudden spike beyond even the doubled capacity, you may experience throttling, but AWS will begin scaling up additional shards. In Provisioned mode, any traffic beyond your shard count will be throttled immediately with no automatic recovery.

### Making the Decision: A Framework

Here's a practical framework for choosing between the two modes:

Choose **Provisioned mode** if your workload meets any of these criteria: you have historical data showing consistent, predictable demand; your traffic patterns are well understood and relatively stable; cost optimization is a primary concern; or you're running a mature application in production where capacity planning is straightforward. The math strongly favors Provisioned for any high-volume, steady-state workload.

Choose **On-Demand mode** if you're dealing with unpredictable traffic with significant peaks and valleys; you're building a new application and don't yet know demand patterns; your workload is truly event-driven and sparse (like IoT data from geographically distributed devices that report unpredictably); or you value the operational simplicity of not managing shard counts. The price premium is worth it if it eliminates capacity management overhead or prevents costly throttling during demand spikes.

A pragmatic hybrid approach is also valid: start with On-Demand while you gather data about actual demand patterns, then switch to Provisioned once you have two to three months of historical data and can confidently forecast future needs. Many teams follow this path and find it strikes the right balance between operational simplicity and cost optimization.

### Monitoring and Cost Visibility

Whichever mode you choose, robust monitoring is essential. For Provisioned mode, monitor your shard utilization—if you're consistently approaching or exceeding your provisioned throughput, you need to add shards. AWS CloudWatch provides metrics for GetRecords IteratorAgeMilliseconds (which increases when consumers can't keep up) and PutRecord throttling events.

For On-Demand mode, monitor your actual data ingestion volume and correlate it with your monthly bill. CloudWatch provides an `IncomingBytes` metric that directly maps to your costs. Also monitor shard count to understand how AWS is scaling your stream in response to demand patterns. If you notice the shard count climbing steadily over weeks while actual throughput demand is stable, it might be a sign that your 30-day peak-based scaling is capturing outlier events that aren't representative of normal traffic.

### Conclusion

The choice between Kinesis Provisioned and On-Demand capacity modes is fundamentally a trade-off between cost predictability and operational simplicity. Provisioned mode offers the lowest per-unit cost for predictable, high-volume workloads but requires you to accurately forecast demand and actively manage shard counts. On-Demand mode eliminates capacity management and provides automatic scaling at the expense of higher per-gigabyte costs, making it ideal for variable or unknown workloads where the convenience and safety are worth the premium.

There's no universally correct answer—only the right choice for your specific workload, organization, and priorities. Start by understanding your traffic patterns, gathering the cost calculations we've outlined, and honestly assessing your tolerance for capacity management overhead. If you're uncertain, On-Demand provides a low-risk way to operate while you gather the data needed to make an informed decision. Once you're confident in your demand patterns, switching to Provisioned mode can deliver significant cost savings for steady, predictable workloads. The beauty of AWS's flexibility is that you can start one way and evolve your approach as your application matures.
