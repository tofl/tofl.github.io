---
title: "RDS Multi-AZ vs Read Replicas: Availability vs Scalability"
---

## RDS Multi-AZ vs Read Replicas: Availability vs Scalability

When you're designing a database architecture on AWS, one of the most consequential decisions you'll make is how to handle availability and read scaling. Yet many developers—and frankly, many who've passed their first AWS exam—still conflate RDS Multi-AZ deployments with Read Replicas. They're both powerful tools, but they solve fundamentally different problems. Understanding which tool serves which purpose, and when you might actually need both, is essential to building resilient applications on AWS.

The confusion is understandable. Both Multi-AZ and Read Replicas involve replication. Both improve resilience in some way. But they operate under completely different assumptions, use different replication mechanisms, and address different concerns. This article clarifies the distinction in a way that sticks, and walks you through the practical considerations that should drive your architecture decisions.

### The Core Distinction: Purpose and Design Philosophy

Let's start with the simplest possible explanation: **Multi-AZ exists for availability; Read Replicas exist for scalability.**

That's the headline, and everything that follows elaborates on what that really means in practice.

RDS Multi-AZ is fundamentally about ensuring your database stays online even when infrastructure fails. It's a high-availability feature. When you enable Multi-AZ on an RDS instance, AWS automatically provisions a standby replica in a different Availability Zone within the same region. That standby replica is invisible to your application—it doesn't serve traffic. It just sits there, synchronized with your primary database, ready to take over if disaster strikes. The moment the primary database becomes unavailable, AWS performs an automatic failover, promoting the standby to become the new primary. Your application reconnects (after briefly losing connectivity) and life goes on. The entire point is that you have one logical database instance that your application talks to, but behind the scenes, there's redundancy built in.

Read Replicas, by contrast, are about spreading the load. When you create a Read Replica, you're creating a separate database instance that your application can actually connect to and read from. It's a real, accessible database with its own endpoint. Your application deliberately sends read queries to the replica while sending writes to the primary. The replica stays in sync through asynchronous replication, which means there will always be a small lag between writes hitting the primary and appearing on the replica. That lag—replication lag, as we'll discuss in depth—is the price you pay for being able to distribute read traffic across multiple instances. But unlike Multi-AZ, the replica is not invisible. Your application needs to know about it, route queries appropriately, and handle the fact that reads might return slightly stale data.

This distinction shapes everything else: how replication works, when failover happens, which regions they support, their cost profiles, and the scenarios where each makes sense.

### Replication Mechanisms: Synchronous vs. Asynchronous

The replication strategy is where the rubber really meets the road.

**Multi-AZ uses synchronous replication.** When your application writes data to the primary database, that write doesn't complete until it's been acknowledged by both the primary and the standby. This is incredibly important: it means your standby is always byte-for-byte identical to your primary. There is zero data loss. If the primary fails at any moment, the standby has every transaction that the application believes succeeded. This safety comes at a cost—write latency is slightly higher because you're waiting for two disks to acknowledge the write instead of one—but for most workloads, that overhead is negligible. The standby is maintaining an exact, up-to-the-microsecond copy of your data.

**Read Replicas use asynchronous replication.** The primary database accepts a write, acknowledges it to your application, and then pushes that change to the replica(s) in the background. The replica will eventually catch up, but there's a lag. Your application doesn't wait for the replica to acknowledge anything. This asynchronous approach is what makes Read Replicas practical for scaling reads—if you had to synchronously replicate every write across multiple read replicas, write performance would tank. Instead, you get responsive writes and the flexibility to spin up many replicas, accepting that those replicas lag slightly behind the primary. That lag can be milliseconds or seconds, depending on network conditions and the volume of writes.

This difference is more than just technical minutiae. It fundamentally determines what each feature is good for. Synchronous replication is overkill if all you want to do is distribute read traffic. But it's essential if you need zero-downtime failover with zero data loss.

### Automatic Failover: When and How It Happens

**Multi-AZ automatic failover** is transparent and automatic. You don't have to configure anything special. If the primary instance fails—whether due to hardware failure, network partition, or an AWS-initiated maintenance event—RDS detects the failure and automatically promotes the standby to be the new primary. The DNS endpoint that your application uses gets updated to point to the new primary. From your application's perspective, the database briefly becomes unavailable (typically thirty seconds to a few minutes, though often faster), and then it comes back. Your application should have connection retry logic to handle that brief blip, but otherwise, no manual intervention is required. You get automatic, transparent failover with zero data loss because of that synchronous replication.

Here's an important detail: **the failover is not a switch you can manually trigger on demand.** Multi-AZ failover happens when AWS detects that the primary is actually unavailable. You cannot use Multi-AZ to perform planned failovers for testing or routine maintenance. (RDS does handle planned maintenance on Multi-AZ instances in a failover-like way—it takes down the standby, upgrades it, and then fails over; this allows the primary to be upgraded with minimal downtime. But you cannot initiate this yourself on demand.)

**Read Replica failover is manual.** If your primary database fails and you want to promote a Read Replica to become the new primary, you have to do it yourself. AWS provides the tools—you can promote a replica with a single API call or a few clicks in the console—but it's not automatic. This is a consequence of the asynchronous replication and the replica's role as a separate instance. Promoting a replica involves several steps: the replica is read-only, so it first has to be converted to a read-write instance; the DNS might need updating; your application needs to be aware of the new primary endpoint. This is more manual, more work, and leaves room for human error. However, it does give you flexibility. You can promote a replica whenever you want for whatever reason. And if you've got multiple replicas, you can choose which one to promote.

The implication is clear: if your requirement is "the database must stay up and available with no manual intervention," Multi-AZ is the right choice. If your requirement is "I want the ability to promote a replica if my primary fails," then Read Replicas provide that option, but with more operational overhead.

### Replica Lag: Understanding the Asynchronous Reality

Replica lag is the amount of time between when a write completes on the primary and when that write is visible on a Read Replica. It's one of the most important concepts to grasp because it directly shapes what your application can and cannot do with Read Replicas.

Under normal circumstances, replica lag is small—often just a few milliseconds. But it can spike. Heavy write traffic, network congestion, or a slow replica instance can all cause lag to increase. On a high-velocity application, replica lag could be several seconds. And here's the critical part: **your application must be designed to tolerate replica lag.**

This might mean accepting that some read queries return data that was written a few seconds ago. For many use cases—dashboards, analytics, user profile lookups, product catalogs—this is fine. Users don't expect real-time consistency. But for other use cases, it's a problem. If a user places an order and then immediately checks their order history, and that read goes to a replica with a two-second lag, they won't see the order. This is the classic consistency problem.

There are patterns to mitigate this. One common approach is to write reads back to the primary for a period of time after a write (called "read-after-write consistency" or using a "primary-write, replica-read" pattern with short-term stickiness). Another is to query the primary for critical data and replicas for non-critical data. Some applications use application-level caching to avoid hitting the database for recently written data. The point is, if you're using Read Replicas, you need an intentional strategy for handling replica lag.

Multi-AZ, remember, is synchronous. The standby is always perfectly in sync. There's no replica lag to worry about. But then again, you're not reading from the standby, so there's nothing to be lagged in the first place. The standby is just for failover.

### Cross-Region Capabilities and Disaster Recovery

Here's another important difference: where can you put your replicas?

**Multi-AZ is region-specific.** The primary and standby always live in the same region, just different Availability Zones. Multi-AZ protects you against an AZ failing. It does not protect you against an entire region going down (which is rare but has happened). If you need protection against a region failure, Multi-AZ alone isn't sufficient. You need something else—like cross-region Read Replicas.

**Read Replicas can be cross-region.** You can create a Read Replica in a completely different region from your primary. This is incredibly powerful for disaster recovery and for serving geographically distributed read traffic. A US-based application can have replicas in EU and APAC regions for low-latency local reads. Or you can maintain a replica in a different region as a DR standby, promoting it if the primary region becomes unavailable.

The combination of Multi-AZ and cross-region Read Replicas is a common architecture. Multi-AZ handles the "AZ failure, I need failover within 30 seconds" scenario. Cross-region replicas handle the "my entire region is down, I need to recover to another region" scenario. They solve different problems and can work together.

### Cost Implications

Let's talk about money, because it's real and it matters.

**Multi-AZ adds cost, but not double.** The standby instance consumes storage and compute resources, so you'll pay for those. However, AWS pricing is a bit subtle here: for many instance types, the cost increment for Multi-AZ is not simply "double." The pricing structure varies by instance class. But as a general rule, expect Multi-AZ to increase your database costs by 30-50%, roughly. You're paying for redundancy and peace of mind.

**Read Replicas also add cost per replica.** Each Read Replica is a separate database instance, so you pay for its compute and storage separately. However, there's one notable exception: **if a Read Replica is in the same region as the primary, you don't pay data transfer charges between the primary and replica.** But if it's in a different region, you do pay for cross-region data transfer, which can be expensive. This is an important consideration when evaluating cross-region replicas for DR purposes.

So if your goal is just availability within a region, Multi-AZ is typically more cost-efficient than maintaining multiple Read Replicas. But if your goal is to distribute read traffic across multiple regions, Read Replicas are the way to do it, and the cost depends on how many replicas you need.

### Decision Matrix: Which Tool for Which Job

Let's get practical. How do you decide?

**Choose Multi-AZ if:**

Your primary concern is high availability within a single region. You want your database to automatically failover if the primary becomes unavailable. You need zero data loss on failover. You don't need to distribute read traffic. Your application doesn't need to explicitly know about failover. You want minimal operational overhead for high availability.

A typical scenario: a web application running in a single region that needs to be resilient to infrastructure failures but doesn't have extreme read scaling requirements.

**Choose Read Replicas if:**

Your primary concern is read scalability. You have read-heavy workloads and need to spread read traffic across multiple instances. You need to serve reads from geographically distributed locations. You're building a disaster recovery strategy and want the ability to promote a replica if needed. You can tolerate eventual consistency and replica lag. You're willing to manage the operational complexity of routing reads and promoting replicas.

A typical scenario: a SaaS application with global users, heavy read traffic, and a need for regional failover capability.

**Choose both Multi-AZ and Read Replicas if:**

You need both high availability within a region and read scaling and/or cross-region DR. This is common in production architectures at scale. You might have a Multi-AZ primary for immediate failover within the region, and cross-region Read Replicas for DR and geo-distributed read scaling.

A typical scenario: a production application with strict availability requirements, high read traffic, and the need to operate across multiple regions.

### Combining Multi-AZ and Read Replicas

It's worth dwelling on this for a moment because it's a powerful combination and it confuses some people.

When you enable Multi-AZ on a primary instance, you get a synchronous standby replica in another AZ. If you then create a Read Replica, that replica reads from the primary instance, not the standby. The primary replicates asynchronously to the Read Replica. If the primary fails and the standby takes over, the Read Replica automatically starts replicating from the new primary. There's no action required; the replication just continues.

You can also create Read Replicas from the standby instance in a Multi-AZ setup, though this is less common. The point is, these features are orthogonal. You can combine them in various ways to build the resilience profile you need.

### Practical Example: Read Replica Promotion

Let's walk through what actually happens when you promote a Read Replica, because it's a useful mental model.

Suppose you have a primary RDS instance in us-east-1 and a Read Replica in us-west-2 (cross-region). The replica is read-only and is replicating asynchronously from the primary. If the primary instance fails and you decide to promote the us-west-2 replica, here's what happens:

First, the replica is converted from read-only to read-write. It's now a standalone database instance, no longer replicating from anywhere. Next, the replication process is terminated. The replica now contains whatever data it had replicated up to that point—possibly some data loss if the replica was lagged. Then, your application needs to be reconfigured to point to the new primary endpoint (the promoted replica's endpoint) instead of the old primary. This reconfiguration might be automatic if you're using DNS-based discovery or a database proxy, or it might require manual updates or a code deployment.

The entire process—including the replication lag that might have accumulated—introduces a recovery time objective (RTO) measured in minutes and a recovery point objective (RPO) measured in seconds to minutes, depending on replica lag. Multi-AZ, by contrast, has an RTO measured in seconds and an RPO of zero.

### Failover and Maintenance: The Nuanced Differences

Let's clarify one more nuance because it trips people up. When AWS performs planned maintenance on an RDS instance—like a minor version patch—how does that work on Multi-AZ instances?

With Multi-AZ enabled, AWS will perform the maintenance in a failover-like manner. It applies the patch to the standby, promotes the standby to primary, and then patches the old primary (now the standby). This keeps your database available throughout the maintenance window. It's not truly "no downtime," because there's a brief moment when connections are being redirected, but it's designed to minimize impact. This is one of the practical benefits of Multi-AZ that often gets overlooked.

With Read Replicas, AWS still needs to perform maintenance, and it will generally take the replica offline during the maintenance window. The primary continues to run, and reads on that replica are unavailable temporarily. The primary is unaffected.

### Monitoring and Alerting Considerations

In practice, you should monitor different things for each pattern.

For Multi-AZ, monitor the synchronous replication status. AWS provides metrics indicating whether the standby is in sync with the primary. If the standby falls out of sync, that's a warning sign. Also monitor for failover events—when they happen, there's typically a brief connectivity blip that you should detect and log.

For Read Replicas, replica lag is the metric that matters most. Monitor it actively. Set up alerts if lag exceeds a threshold that your application can tolerate. Also monitor the replica's CPU, memory, and I/O to ensure it's not becoming a bottleneck. A replica that's falling behind on writes might need to be scaled up.

### Summary and Key Takeaways

Multi-AZ and Read Replicas are both powerful, but they serve different purposes. Multi-AZ provides high availability through synchronous replication and automatic failover within a region, with zero data loss. Read Replicas provide read scalability through asynchronous replication and can span regions, enabling disaster recovery and geographically distributed read traffic.

The key distinction is that Multi-AZ is about keeping one database available, while Read Replicas are about creating accessible copies for reading. Multi-AZ uses synchronous replication; Read Replicas use asynchronous. Failover is automatic with Multi-AZ and manual with Read Replicas. Replica lag is irrelevant with Multi-AZ and critical with Read Replicas.

In modern production architectures, these features often work together. A Multi-AZ setup handles zone-level failures gracefully. Cross-region Read Replicas extend that protection to regional failures and enable read scaling. Understanding when and how to use each—and how to combine them—is a core skill for building resilient database architectures on AWS.

The next time you're designing a database solution or evaluating an RDS configuration, ask yourself two questions: Do I need automatic failover and zero data loss (Multi-AZ)? Do I need to distribute reads or operate across regions (Read Replicas)? Your answer will likely guide you toward a specific pattern, or toward a combination of both.
