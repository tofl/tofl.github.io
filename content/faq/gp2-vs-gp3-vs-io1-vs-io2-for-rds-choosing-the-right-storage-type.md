---
title: "gp2 vs gp3 vs io1 vs io2 for RDS: Choosing the Right Storage Type"
---

## gp2 vs gp3 vs io1 vs io2 for RDS: Choosing the Right Storage Type

When you provision an Amazon RDS database instance, one of the most consequential decisions you'll make is choosing the storage type. This choice directly impacts your database's performance characteristics, cost structure, and ability to handle traffic spikes. Yet it's often treated as an afterthought—a checkbox on a configuration form that gets defaulted to gp2 and forgotten about.

The reality is more nuanced. AWS offers four distinct EBS volume types for RDS: gp2, gp3, io1, and io2. Each operates under a fundamentally different model of IOPS provisioning and throughput management. Understanding these differences isn't just about optimizing performance; it's about making intelligent tradeoffs between cost and capability that can compound across thousands of database instances and months of operation.

This article walks you through each storage type, explains how they actually work, and helps you think through the decision framework for choosing the right one for your specific workload.

### Understanding the EBS Storage Landscape for RDS

Before diving into individual storage types, let's establish a baseline: every RDS database instance uses Amazon EBS (Elastic Block Store) volumes under the hood. These volumes come in different types, each with its own provisioning model, performance characteristics, and pricing structure.

The key metrics you need to understand are IOPS (input/output operations per second) and throughput (measured in megabytes per second). IOPS represents the number of read or write operations your storage layer can handle concurrently. Throughput represents the total volume of data those operations can transfer. These are related but distinct—you can have high IOPS with low throughput if your operations are small, or lower IOPS with high throughput if your operations are larger.

The critical difference between the storage types lies in how you provision these metrics. Some types bundle IOPS and throughput together in a fixed ratio (gp2). Others let you provision them independently (gp3). Still others tie you to a minimum ratio but allow higher provisioning (io1, io2). This distinction alone explains why choosing the wrong storage type can leave you either overpaying or underperforming.

### GP2: The Baseline Burst Model

GP2 (General Purpose SSD) was the default storage type for RDS for many years, and you'll still encounter it in legacy workloads and new deployments that haven't revisited the choice. It uses a burst model that attempts to balance cost and performance for a broad class of workloads.

Here's how gp2 actually works: baseline performance is calculated from your volume size, specifically at a ratio of 3 IOPS per gigabyte of storage. So a 100 GB gp2 volume gets a baseline of 300 IOPS. This baseline is continuous—you can sustain 300 IOPS indefinitely without performance degradation.

But gp2 introduces a burst bucket. When your workload demands exceed the baseline, the volume can temporarily burst up to a maximum of 16,000 IOPS. This burst capacity comes from an "I/O credit" system. Your volume accumulates credits when you operate below baseline, and you spend those credits when you exceed baseline. Think of it like a savings account: when you're not using your full allocation, you're building up reserves for occasional spikes.

The throughput story follows a similar pattern. For volumes under 1,024 GB, throughput also scales with size, capped at 250 MB/s at the 1,024 GB mark.

For many workloads, this model works adequately. A moderately busy transactional database with occasional traffic spikes can function well on gp2. The problem emerges when your baseline demand chronically exceeds what your volume size provides, or when your traffic spikes are frequent enough to drain the burst bucket faster than it refills. When that happens, your database performance degrades, query latency increases, and applications experience timeouts.

Consider a practical example: you're running a web application with a 500 GB RDS database. That gives you a 1,500 IOPS baseline. If your normal workload sits at 1,200 IOPS but you experience bursts to 3,000 IOPS three times per hour for 20 minutes each time, gp2 might still work—you have a burst bucket that refills during the quiet periods between spikes. But if those bursts happen continuously or your normal baseline creeps up to 1,800 IOPS, you'll find your database struggling.

The pricing for gp2 is straightforward: you pay per gigabyte of provisioned storage per month. There's no separate IOPS charge. This makes gp2 attractive for capacity-constrained scenarios—if you need 500 GB of storage regardless of performance tier, gp2 won't charge you extra for IOPS.

### GP3: Independent Provisioning and the Modern Default

GP3 represents a fundamental shift in how AWS approaches general-purpose storage. Instead of tying IOPS to volume size, gp3 lets you provision IOPS and throughput independently of capacity.

With gp3, you specify three things separately: storage capacity (in GB), IOPS, and throughput (MB/s). The baseline configuration is 3,000 IOPS and 125 MB/s for any size volume. You can increase IOPS up to 16,000 and throughput up to 1,000 MB/s without any volume size requirement. There's no burst bucket—whatever IOPS you provision is what you get continuously.

This independence is powerful. It means you can right-size your storage precisely to what you need, without buying excess capacity just to hit a performance target. It also means you stop paying for IOPS you don't use.

Let's revisit that earlier example with gp3. You still have a 500 GB database, but now you provision exactly 2,000 IOPS and 250 MB/s. You get those metrics consistently, with no burst bucket, no credit system, no surprises when sustained traffic exceeds your baseline. If your workload later demands 3,500 IOPS, you modify the volume to increase IOPS—a change that takes effect immediately with no downtime.

The pricing model reflects this flexibility. You pay separately for storage (per GB per month), for IOPS (per provisioned IOPS per month), and for throughput (per provisioned MB/s per month). This appears more granular, but it's actually cleaner: you pay exactly for what you use.

For many workloads, migrating from gp2 to gp3 results in cost savings. A 1 TB gp2 volume costs less per month than provisioning 3,000 IOPS and 125 MB/s on gp3 (the minimum), but once your gp2 volume approaches its IOPS limits and you need to increase size just to get more IOPS, gp3 becomes cheaper. The break-even point depends on your AWS region and current pricing, but it typically happens in the 1–2 TB range.

Migrating from gp2 to gp3 is straightforward. You can modify an existing RDS instance's storage type through the AWS Management Console, AWS CLI, or infrastructure-as-code tools. The process typically involves a brief outage (seconds to a minute) as the volume type changes, though AWS can perform this during a maintenance window you specify.

When should you choose gp3? For new RDS deployments, gp3 should be your default. It provides better performance predictability, cleaner pricing, and more flexibility than gp2. The only reason to stick with gp2 is if you're managing legacy infrastructure where the change would require extensive testing, or if you have workloads where baseline performance truly aligns with the gp2 3:1 IOPS-to-capacity ratio and you want to minimize operational overhead.

### IO1: Provisioned IOPS for Demanding Workloads

IO1 (Provisioned IOPS SSD) enters the territory of explicitly performance-optimized storage. It's designed for databases where you need guaranteed, sustained IOPS regardless of spike patterns, and where performance variability is simply not acceptable.

With io1, you provision IOPS independently of storage capacity, but within a specific ratio: you can provision between 50 and 64,000 IOPS, with a minimum ratio of 50:1 (meaning a 100 GB volume needs at least 5,000 IOPS provisioned). Throughput scales with your IOPS: io1 delivers up to 1,000 MB/s.

The key difference from gp3 isn't the maximum IOPS (both support 16,000 on RDS), but rather the performance guarantees and what happens at higher IOPS levels. IO1 is built for ultra-high IOPS workloads. If you provision 64,000 IOPS on io1, you get a volume specifically engineered for that sustained load, with latency characteristics optimized for that performance level.

Pricing for io1 reflects its premium nature. You pay for storage, and then separately for each provisioned IOPS. A high-IOPS io1 configuration can become expensive quickly—provisioning 50,000 IOPS costs significantly more than gp3 at the same IOPS level.

When does io1 make sense? Real-world scenarios include large NoSQL databases with sustained high concurrency, data warehouses running complex queries, or transactional systems with millions of customers that can't tolerate any performance degradation. If you're running a financial trading platform or a SaaS metrics database serving thousands of concurrent customers, io1 might be justified.

However, in practice, io1 usage for RDS has declined since gp3's introduction. For most customers, gp3 provides the same IOPS ceiling (16,000 on RDS) at lower cost, without the complexity of ratio constraints. IO1 still has its place for ultra-high-performance requirements beyond gp3's limits, but that's a smaller segment of the workload spectrum.

### IO2: The Latest High-Performance Option

IO2 (Provisioned IOPS SSD io2) is AWS's newest and most advanced provisioned IOPS option. It builds on io1's foundation with improved performance and reliability characteristics.

IO2 supports up to 64,000 IOPS on RDS (matching io1), but with a better baseline ratio and lower minimum: you can provision 100 IOPS per GB of storage, with a minimum of only 100 IOPS on a 1 GB volume. This is much more flexible than io1's 50:1 ratio, allowing you to provision lower IOPS on large volumes without waste.

IO2 also delivers improved latency characteristics and durability. It provides 99.999% durability (five nines), compared to io1's 99.9% (three nines). For mission-critical databases, this additional durability guarantee can be a meaningful differentiator.

Throughput on io2 reaches up to 1,000 MB/s, matching io1.

Pricing-wise, io2 is typically higher than io1 for the same IOPS provisioning, reflecting its advanced characteristics. However, the improved ratio means you might provision fewer IOPS overall, potentially offsetting the per-IOPS cost increase.

When should you choose io2? If you're considering io1 for a new workload, io2 is likely the better choice. You get better price-to-performance characteristics and durability guarantees. However, if gp3 can meet your performance requirements—which it can for most workloads—gp3 remains the more economical choice.

### Comparing the Types: A Decision Framework

Let's ground this discussion in a practical comparison. Imagine you're right-sizing storage for several different RDS workloads.

**Scenario 1: Standard web application database**

A typical web application database with moderate traffic. Peak load is around 2,000 IOPS, normal load is around 800 IOPS, and you have occasional traffic spikes. You have 300 GB of data.

With gp2: You'd need about 900 GB to get 2,700 baseline IOPS, wasting 600 GB of unused capacity and paying for that waste monthly. You'd likely still experience some burst exhaustion on spike days.

With gp3: You'd provision 300 GB storage, 2,500 IOPS, and 250 MB/s. You'd pay only for what you use, and you'd have consistent performance during spikes. Cost is typically 20-40% lower than gp2 for this workload.

With io1/io2: Unnecessary overhead and expense. Gp3 handles this workload perfectly at lower cost.

**Scenario 2: High-volume transactional database**

A multi-tenant SaaS platform handling millions of transactions daily. You have sustained load at 8,000 IOPS, 2 TB of data, and cannot tolerate performance degradation.

With gp2: You'd need a very large volume (approximately 2.7 TB) to get 8,000 IOPS baseline, incurring substantial waste and cost.

With gp3: You'd provision 2 TB storage with 8,000 IOPS and 500 MB/s. This works perfectly and costs significantly less than gp2.

With io1/io2: Only if you need more than 16,000 IOPS (gp3's RDS ceiling). Otherwise, gp3 is the better choice.

**Scenario 3: Ultra-high-performance data warehouse**

An analytical system requiring 50,000 sustained IOPS to support hundreds of concurrent complex queries. You have 5 TB of data.

With gp2: Not viable. You'd need a 17 TB volume to achieve this IOPS baseline, which is economically nonsensical.

With gp3: Not applicable. Gp3 maxes out at 16,000 IOPS on RDS.

With io1/io2: This is the domain where io1 and io2 justify their cost. You'd provision 50,000 IOPS with your 5 TB volume. IO2 would be preferable for its durability and ratio characteristics.

### Monitoring and Right-Sizing

Choosing a storage type is only half the battle. You also need to monitor actual performance to validate your choice and catch situations where your assumptions were wrong.

For RDS, the primary CloudWatch metrics to watch are VolumeReadOps, VolumeWriteOps, and VolumeReadBytes/VolumeWriteBytes. These tell you how many operations are hitting your storage and how much data those operations are transferring. You can graph these metrics over time to understand patterns: normal load, peak load, and any anomalies.

Additionally, watch ConsumedReadCapacityUnits and ConsumedWriteCapacityUnits. These metrics, available for provisioned IOPS volumes, show you how much of your provisioned IOPS you're actually consuming. If you're consistently at 80-90% of your provisioned IOPS, you're well-optimized. If you're consistently maxed out, you need more. If you're consistently below 30%, you're overprovisioned.

For gp2, watch the VolumeQueueLength metric. High queue length indicates your workload is hitting the IOPS limit and operations are waiting for service. This is a clear signal that you should either increase volume size (to increase baseline IOPS) or migrate to gp3.

Here's a practical workflow for right-sizing: provision storage conservatively, monitor for a week or two of representative traffic, then adjust. With gp3, this is easy—you simply increase IOPS or throughput through the console. With gp2, you'd need to increase volume size, which is less flexible. This operational advantage alone makes gp3 worth choosing for most workloads.

You can also use RDS Performance Insights, a feature available on most RDS instances, to see detailed breakdown of database activity. This tool shows you which queries or sessions are driving IOPS, helping you identify whether your storage demand stems from normal application behavior, inefficient queries, or traffic spikes.

### Migration Considerations

If you're currently running gp2 and wondering whether to migrate to gp3, here's the decision logic:

First, assess your current gp2 performance. If you're experiencing VolumeQueueLength spikes or query latency increases during traffic peaks, you're hitting IOPS limits. In this case, migration is justified not just for cost, but for performance improvement.

Second, calculate the cost differential. Pull your current gp2 storage size and estimate your IOPS needs (typically 2-3x your normal load, or whatever your monitored peak actually is). Pricing varies by region, but gp3 is usually cheaper for volumes over 1 TB.

Third, plan the migration. RDS supports in-place storage type conversion through a modify operation. You specify the new storage type, and AWS handles the backend conversion. This typically causes a brief (30-second to 2-minute) outage as the volume type changes. Schedule this during your maintenance window to minimize user impact.

Fourth, validate post-migration. After switching to gp3, monitor CloudWatch metrics and application performance for a few days. Confirm that your provisioned IOPS are sufficient and that your application performs as expected.

The migration process via AWS CLI looks something like this:

```bash
aws rds modify-db-instance \
  --db-instance-identifier mydb \
  --storage-type gp3 \
  --iops 3000 \
  --allocated-storage 500 \
  --apply-immediately
```

Note the `--apply-immediately` flag. Without it, the change is applied during your next scheduled maintenance window. With it, the change happens immediately, incurring a brief outage.

If you're considering upgrading from gp3 to io1 or io2, the threshold is typically around 16,000 IOPS. Below that, gp3 is more economical. Above it, you need the higher IOPS ceiling that io1/io2 provide.

### Performance Implications Beyond IOPS

While IOPS and throughput are the primary metrics, they don't tell the complete story. Latency characteristics, consistency, and how the storage type behaves under sustained vs. burst loads also matter.

GP2's burst model can introduce latency unpredictability. When you're operating within baseline, latency is consistent. But as you approach the burst limit and the burst bucket depletes, latency can spike unpredictably. Applications that require consistent, predictable latency can suffer.

GP3, io1, and io2 provide more consistent latency since they don't use a burst model. Whatever you provision is what you get, consistently. This predictability is valuable for applications with strict latency SLAs.

The tradeoff is that gp2 can be cheaper if your workload truly is bursty—if you have long periods of low activity with brief spikes. The burst bucket lets you ride those spikes without paying for sustained high IOPS. But in practice, many workloads that feel "bursty" actually have sustained baseline demands that exceed what the gp2 model provides cost-efficiently.

### When to Consider Alternatives

There are edge cases where you might choose differently than the common recommendations.

If you have a batch processing job that runs once per week and demands massive IOPS for a few hours, followed by days of inactivity, gp2 might be more cost-effective than provisioning high IOPS on gp3. You'd provision just enough baseline for normal operations, then burst for your batch window.

If you're running read-heavy analytics on RDS, where your write IOPS are minimal but read volume is high, you might focus optimization on throughput rather than IOPS. In this case, gp3's independent throughput provisioning becomes particularly valuable.

If you're using RDS for a test or development environment where performance requirements are loose and cost matters more than consistency, gp2 can still be reasonable to minimize spend.

But for production workloads—especially multi-tenant SaaS, e-commerce, or any system where performance affects user experience directly—gp3 should be your default starting point. It provides the flexibility and cost-efficiency that the modern cloud demands.

### Conclusion

Choosing between gp2, gp3, io1, and io2 involves understanding how each type provisions IOPS and throughput, and matching that provisioning model to your workload characteristics.

GP2 remains viable but is increasingly the wrong choice for new deployments. Its burst model and capacity-tied IOPS create inefficiencies that gp3 solves elegantly.

GP3 should be your default for most RDS workloads. It provides independent IOPS and throughput provisioning, consistent performance without burst unpredictability, and cleaner pricing. For workloads below 16,000 IOPS, gp3 is almost always more economical and performant than gp2, and usually than io1/io2.

IO1 and io2 serve the high-performance segment where sustained IOPS demands exceed what gp3 provides, or where the durability guarantees of io2 are required. They're powerful tools, but they're necessary for fewer workloads than vendors' recommendations might suggest.

The key to making the right choice is monitoring—understanding your actual IOPS profile, your latency requirements, and your growth trajectory. Once you have that data, the decision becomes straightforward. And with gp3's flexibility, you can always start conservatively and adjust as your workload evolves.
