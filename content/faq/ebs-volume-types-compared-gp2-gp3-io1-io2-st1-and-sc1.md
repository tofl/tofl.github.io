---
title: "EBS Volume Types Compared: gp2, gp3, io1, io2, st1, and sc1"
---

## EBS Volume Types Compared: gp2, gp3, io1, io2, st1, and sc1

When you launch an EC2 instance on AWS, you're making a choice about storage that affects performance, cost, and reliability. That choice centers on EBS—Elastic Block Store—and specifically, which volume type to use. Unlike compute instances where "bigger is better" is straightforward, EBS volume types involve nuanced trade-offs between IOPS, throughput, latency, and cost. Understanding these differences isn't just academic; it's the foundation of building efficient, cost-effective applications on AWS.

In this article, we'll walk through each major EBS volume type, explain what makes them different, and help you develop the intuition to choose the right one for your workload.

### Understanding EBS Volume Fundamentals

Before diving into specific volume types, let's establish some vocabulary. EBS volumes are network-attached block storage devices that persist independently of EC2 instances. Three performance metrics matter most:

**IOPS** (Input/Output Operations Per Second) measures how many read or write operations a volume can perform each second. Think of this as the volume's ability to handle many small, random operations—like database queries hitting an index.

**Throughput** measures the total data (in MB/s) the volume can transfer per second. This matters for sequential, bulk operations like copying large files or streaming video.

**Latency** is the time it takes for a single operation to complete. For most workloads, lower is better, though it's less commonly advertised than IOPS and throughput.

These metrics are interdependent. A volume with high IOPS but low throughput might excel at random database access but struggle with sequential file operations. The reverse creates opposite problems. Volume type selection is really about matching these characteristics to your workload's actual demands.

### GP2: The Burstable General-Purpose Workhorse

GP2 (General Purpose 2) has been the default EBS volume type for years. If you've launched an EC2 instance without overthinking the storage choice, you probably got GP2. It remains available and suitable for many workloads, but understanding its design helps clarify why AWS introduced GP3.

GP2 volumes operate on a burstable credit system. You receive a baseline IOPS allocation of three IOPS per GB of volume size. So a 100 GB GP2 volume gets 300 baseline IOPS. As you perform I/O operations, you consume credits. When you're not using the volume heavily, you accumulate credits that let you "burst" beyond baseline for short periods—up to a maximum of 3,000 IOPS.

This burstable design works well for workloads with variable demand. A web application that handles spikes in traffic during business hours but runs light at night fits perfectly. The volume baseline handles average load, and burst capacity absorbs peaks. You don't pay for guaranteed peak capacity you won't always use.

However, GP2 has a significant limitation: you cannot independently adjust IOPS and throughput. Throughput is tightly coupled to IOPS. The relationship is roughly one MB/s throughput per 3.3 IOPS. If you need more throughput, you must increase IOPS, which means increasing volume size, which increases cost. For workloads that need more IOPS than GP2's 3,000 IOPS maximum or more throughput than the 125 MB/s maximum, you're out of luck with GP2.

GP2 is cost-effective for general-purpose applications like WordPress sites, small databases, development and test environments, and applications where performance is important but not critical. The simplicity is valuable too—you provision size and move on.

### GP3: The Modern General-Purpose Standard

GP3 (General Purpose 3) is AWS's answer to the GP2 limitations. It decouples IOPS and throughput provisioning, giving you independent control over each. This is a genuinely useful improvement that applies to many real-world scenarios.

With GP3, you provision a volume size (which affects cost but not performance), a baseline IOPS level (independently from throughput), and a throughput level. All three are independent variables. The base allocation is 3,000 IOPS and 125 MB/s throughput, included in the price. You can provision up to 16,000 IOPS and 1,000 MB/s throughput on a single volume.

Consider a practical example. You're running a relational database that performs many small, random queries (high IOPS demand) but doesn't need massive sequential throughput. With GP2, meeting your IOPS target might force you to pay for excess throughput. With GP3, you specify exactly the IOPS you need and a moderate throughput level, paying only for what you use.

Here's another scenario: a batch processing job that reads a large file sequentially. You might need 500 MB/s throughput but not particularly high IOPS. With GP3, you can set IOPS lower (reducing cost) while cranking up throughput. GP2 wouldn't allow this flexibility.

GP3 performs well for web applications, e-commerce platforms, medium-sized databases, and any workload where you want predictable performance with cost control. Because AWS has made GP3 the default for new EBS volumes and reduced its price relative to GP2, most new deployments should use GP3 unless you have specific reasons to choose otherwise.

The trade-off is slightly higher latency compared to provisioned IOPS volumes (io1 and io2). For most applications, this 1-2 millisecond difference is negligible. If your application is latency-sensitive—like a high-frequency trading system—provisioned IOPS types are more appropriate.

### IO1 and IO2: Provisioned IOPS for High-Performance Workloads

When general-purpose volumes aren't enough, you need provisioned IOPS. IO1 (Provisioned IOPS SSD) and IO2 (Provisioned IOPS SSD) guarantee a specific IOPS level you define when creating the volume. Unlike GP2's burstable model, provisioned IOPS volumes deliver consistent performance.

IO1 lets you provision up to 32,000 IOPS per volume (64,000 if attached to an optimized EC2 instance). The IOPS-to-size ratio is flexible—you can provision more IOPS without dramatically increasing volume size, though there are practical limits. With IO2, you get even more: up to 64,000 IOPS per volume (or 256,000 on Nitro instances with IO2 Block Express, which we'll discuss separately).

The key difference between IO1 and IO2 isn't features—it's reliability and durability. IO2 offers higher reliability with a 99.999% durability guarantee compared to IO1's 99.9%. IO2 volumes also have slightly better latency characteristics and can maintain high IOPS at larger sizes more efficiently. For mission-critical applications, the reliability premium of IO2 often justifies the cost difference over IO1.

Throughput on provisioned IOPS volumes is generally good but not maximized. IO1 maxes out around 500 MB/s; IO2 reaches 1,000 MB/s. If you need both extremely high IOPS and high throughput, you might need multiple volumes in a RAID configuration or consider instance store (ephemeral) storage, though the latter doesn't persist.

Provisioned IOPS volumes suit databases with predictable, high I/O demands—especially NoSQL databases like DynamoDB (which uses provisioned IOPS internally) or relational databases like Oracle and PostgreSQL running on EC2. They're also appropriate for enterprise applications requiring guaranteed performance and high-performance search engines like Elasticsearch.

The cost reflects the performance guarantee. Provisioned IOPS volumes cost more than GP3 because you're paying for guaranteed, consistent performance. You pay per IOPS provisioned, so it's essential to right-size. Provisioning 50,000 IOPS when your workload only needs 10,000 is wasteful.

### IO2 Block Express: Ultra-High Performance on Nitro Systems

IO2 Block Express is a specialized variant of IO2 for extreme performance scenarios. It's only available on AWS Nitro system EC2 instances, which includes most modern instance types. Block Express increases IOPS capacity to 256,000 per volume and throughput to 4,000 MB/s. Latency drops to sub-millisecond consistency.

Block Express sounds impressive, but it's genuinely niche. High-frequency trading systems, large-scale distributed databases, and data warehouses processing terabytes in parallel might need this tier. For the vast majority of applications, it's overkill. The cost is correspondingly high, so it's only justified when you're running workloads that actually saturate IO2's standard capabilities.

The practical constraint is often the EC2 instance itself. Even a high-performance Nitro instance can only achieve so much network I/O bandwidth to its attached volumes. Block Express is useful when you're running multiple volumes in parallel on a single instance or using multi-attach (which allows a single EBS volume to attach to up to 16 instances simultaneously).

### ST1: Throughput-Optimized HDD for Sequential Workloads

We've focused on SSD volumes so far, but EBS offers magnetic volumes too. ST1 (Throughput Optimized HDD) is the speedy version of magnetic storage, optimized for sequential, high-throughput workloads.

ST1 can deliver up to 500 MB/s throughput, which is respectable. However, IOPS are limited to around 500. This makes sense: mechanical disks are optimized for sequential access, not random access. The internal mechanics require less seeking, so throughput is high relative to IOPS.

ST1 is ideal for workloads that read or write large amounts of data sequentially: data warehouses, log processing, Hadoop jobs, and sequential data analysis. If your application reads a 100 GB dataset from start to finish repeatedly, ST1 can do this efficiently and cheaply. If your application makes thousands of random queries, ST1 will frustrate you with slow response times.

A practical example is an ETL pipeline that ingests gigabytes of logs nightly. The job reads the entire log file sequentially and transforms it. For this type of work, ST1 offers similar performance to SSD volumes at a fraction of the cost. Why pay for SSD random IOPS when you're not using them?

ST1 volumes must be at least 125 GB (unlike GP2/GP3, which can be much smaller) and can scale to 16 TB. They're also less durable than SSD options (99.8% durability), though this rarely matters for ephemeral data or data you can recover.

### SC1: Cold Storage HDD for Archive and Infrequent Access

SC1 (Cold HDD) is the budget option. It delivers up to 250 MB/s throughput and roughly 250 IOPS maximum. It's slower than ST1 but costs even less, making it suitable for workloads accessed infrequently.

SC1 is appropriate for archives, backup storage, and cold data that you access occasionally but don't want to delete. If you need to store historical data for compliance reasons but only access it a few times a year, SC1 is cost-effective. The slower performance doesn't matter if you're accessing it rarely. Like ST1, SC1 has a 125 GB minimum and reaches 16 TB maximum.

One caution: SC1 has a burst mechanism similar to GP2, but with lower baseline IOPS. If you suddenly need high I/O on SC1 data, you'll see poor performance. It's only suitable for genuinely infrequent access patterns.

### Comparing IOPS and Throughput Characteristics

To make these concrete, here's how the major types compare across performance dimensions:

GP2 provides up to 3,000 IOPS baseline (with burst), 125 MB/s throughput, and good general-purpose balance. GP3 offers 3,000 IOPS baseline (configurable to 16,000), up to 1,000 MB/s throughput, and independent scaling. IO1 delivers up to 32,000 IOPS, 500 MB/s throughput, with guaranteed consistency. IO2 matches IO1 in standard form and adds Block Express for 256,000 IOPS and 4,000 MB/s throughput. ST1 provides moderate IOPS (500) but excellent throughput (500 MB/s). SC1 is the budget option with 250 IOPS and 250 MB/s throughput.

These numbers matter when your application's actual demand is known. Measure your production workload's IOPS and throughput using CloudWatch metrics. If you see steady 8,000 IOPS and 200 MB/s throughput, GP3 provisioned at 8,000 IOPS and 200 MB/s is perfect. If measurements show you hitting 10,000 IOPS regularly, you've outgrown GP2 and need GP3 or provisioned IOPS. If you're sequential at 400 MB/s with low IOPS, ST1 is ideal.

### Pricing and Cost Considerations

EBS pricing varies by region, but the general structure is consistent. GB-month pricing (what you pay for provisioning) and IOPS/throughput pricing (what you pay for performance) combine to determine total cost.

GP2 has modest GB-month pricing with no IOPS surcharge. GP3 has comparable GB-month pricing but adds modest per-IOPS and per-MB/s charges for provisioning above baseline. Provisioned IOPS volumes have higher per-IOPS charges. ST1 and SC1 are cheaper per GB than SSD options, making them attractive for large volumes.

For a concrete example: a 1 TB GP3 volume provisioned at 3,000 IOPS and 125 MB/s (baseline) might cost roughly $100-120 per month depending on region. The same volume with IO1 provisioned at 10,000 IOPS would cost significantly more, perhaps $300-400 monthly. A 1 TB ST1 might cost $50-60 per month.

The key is matching performance to actual need. Choosing IO1 when GP3 suffices burns money. Choosing SC1 for an active database burns time and frustrates users. The cheapest volume isn't always the wisest choice; the right-sized volume is.

### Decision Framework: Choosing Your Volume Type

How do you actually decide? Start by understanding your workload's I/O pattern. Are you predominantly random or sequential? How IOPS-heavy versus throughput-heavy?

For general-purpose workloads with variable or unpredictable demand, start with GP3. It's now the AWS default because it covers most use cases well. The independent IOPS/throughput provisioning gives you flexibility to right-size. If measurements show you're staying well under 3,000 IOPS baseline, you might drop to GP2 to save minimal costs, but the gap is small enough that GP3's flexibility usually justifies its cost.

For databases with steady, high I/O demand—especially relational databases with high concurrency or NoSQL workloads—provisioned IOPS volumes are appropriate. Choose IO2 over IO1 for mission-critical databases; the reliability premium is worth it. Block Express is only relevant if you're already maxing out IO2's standard capabilities.

For sequential workloads processing large datasets—data warehouses, analytics, batch jobs—ST1 is cost-effective. SC1 is for archival and genuinely infrequent access.

One practical tip: many organizations choose a volume type, deploy it, and never revisit the decision. Instead, measure actual I/O performance in production for a month. CloudWatch provides IOPS and throughput metrics. If your database averages 4,000 IOPS with peaks at 6,000, GP3 provisioned at 6,500 IOPS is right-sized. If you're consistently hitting 30,000 IOPS, IO2 is necessary. If you're only seeing 500 IOPS on a large sequential workload, maybe ST1 is appropriate. The data guides the decision.

### Practical Considerations: Multi-Attach and Instance Limitations

One more practical detail: volume-to-instance limitations affect your choices. Standard EBS volumes attach to a single instance. If you need very high I/O and want to spread load across multiple instances, you could attach multiple smaller volumes to each instance or use IO2 multi-attach, which lets a single volume attach to up to 16 Nitro instances. Multi-attach requires careful coordination—your application needs to handle consistency—but it's an option for specialized high-availability scenarios.

Instance type also matters. Older instance types have lower EBS bandwidth limits. A general-purpose m5 instance can handle around 14,000 MB/s to EBS volumes; a high-performance c5 can handle similar throughput. If you provision a volume with 4,000 MB/s throughput but attach it to an instance with insufficient EBS bandwidth, you'll never realize that throughput. Always check instance-type EBS throughput specifications when provisioning high-performance volumes.

### Conclusion

EBS volume type selection combines technical understanding with practical measurement. GP3 is the modern default for general-purpose workloads, offering flexibility and reasonable cost. When workloads demand guaranteed, high IOPS, IO2 provisioned IOPS volumes deliver. Sequential, high-throughput workloads benefit from ST1; archival data suits SC1. Your actual workload characteristics—IOPS demand, throughput needs, access patterns—should guide your choice.

The good news is that EBS performance is measurable. Deploy a reasonable volume type, monitor actual I/O patterns through CloudWatch, and adjust if needed. Many production databases run perfectly well on GP3 with careful provisioning. Others genuinely need provisioned IOPS. Rather than guessing, let production data inform your decision. This approach keeps costs reasonable while ensuring your applications have the storage performance they actually require.
