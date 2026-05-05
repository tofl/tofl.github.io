---
title: "Aurora Serverless v1 vs v2: Key Differences and Migration Path"
---

## Aurora Serverless v1 vs v2: Key Differences and Migration Path

When you first encounter Aurora Serverless, it feels like magic—your database scales automatically, you pay only for what you use, and you don't manage capacity. But if you've been working with v1 for a while, or you're evaluating which version to adopt, you'll quickly discover that the two generations are quite different animals. Understanding these differences isn't just about picking the right architecture; it directly impacts your application's performance, cost, and operational complexity.

Aurora Serverless v1 launched as AWS's answer to the "I want a relational database that scales like a Lambda function" problem. It solved real pain points for certain workloads, but it also introduced some quirks and limitations that made it impractical for others. Aurora Serverless v2, released a few years later, fundamentally rethinks how serverless databases should work. Rather than tearing down and spinning up capacity in discrete chunks, v2 scales your compute resources in fine-grained increments continuously. The result is a database that feels far more like a traditional Aurora instance—but without the capacity planning headaches.

Let's dig into what actually changed, why it matters, and how to move from one to the other.

### Understanding the Core Architecture: Warm Pools vs. In-Place Scaling

The fundamental architectural difference between v1 and v2 comes down to how they handle scaling. This distinction cascades through nearly everything else we'll discuss.

**Aurora Serverless v1** uses a warm pool model. When you create a v1 cluster, AWS maintains a fleet of pre-provisioned database instances in the background, sized at various capacity levels (typically ranging from 2 to 128 ACUs). When your application's load increases, Aurora doesn't gradually add CPU and memory to your existing instance. Instead, it pauses your current connection, waits for any active transactions to complete, and then resumes your application on a different instance from the warm pool that has more capacity. Similarly, when load decreases, it moves you to a smaller instance. This process is called failover or brokering, and it typically takes 10-30 seconds depending on the size of the jump and how much state needs to migrate.

Think of it like this: if your current instance is a bus with 8 seats and you suddenly have 12 passengers, Aurora doesn't add 4 more seats to that bus. It parks the bus, gets your passengers off, and brings around a bigger bus that's already running. This works reasonably well, but your passengers experience a brief interruption.

**Aurora Serverless v2** takes a completely different approach: in-place, granular scaling. Instead of moving between pre-sized instances, v2 continuously adjusts the compute resources of your actual database cluster in small increments. You're not moving between different instances; the same database instance gets more or fewer vCPUs and memory allocated dynamically. AWS achieves this by using a different virtualization layer that allows for much finer-grained resource allocation without the traditional instance restart or connection brokering overhead.

The practical impact is significant. With v2, your application experiences seamless scaling without the brief pause that v1 causes. If your workload ramps up from 2 to 4 ACUs, there's no connection interrupt. The database simply has more resources available. This makes v2 far more suitable for workloads that have sudden or frequent scaling events, or for applications that can't tolerate even brief pauses in database connectivity.

The warm pool approach of v1 also means AWS maintains idle capacity in the background, which contributes to higher overall costs for many workloads, even if you're not actively using that capacity. v2's in-place scaling model eliminates that waste.

### Feature Parity: What v1 Couldn't Do

When Aurora Serverless v1 launched, it came with several notable constraints. Some were architectural limitations; others were deliberate trade-offs to keep the product simple during its early days. v2 has closed many of these gaps, making it suitable for a much broader range of use cases.

**Multi-AZ deployments** represent one of the most significant missing pieces in v1. If you needed high availability with automatic failover across availability zones, v1 simply couldn't deliver it. You had to choose: you could have serverless autoscaling, or you could have multi-AZ redundancy, but not both. v2 fully supports Multi-AZ, meaning your database spans multiple availability zones and automatically fails over if one zone becomes unavailable. For production workloads, this isn't a nice-to-have—it's often mandatory.

**Read replicas** were another v1 limitation that frustrated many teams. You could create read replicas in v1, but they had to be provisioned instances, not serverless. This meant if you wanted to offload read traffic to another region or availability zone, you'd need to manage capacity on those replicas manually. v2 allows fully serverless read replicas, which can also autoscale independently based on their own traffic patterns. This opens up possibilities for workloads that previously had to resort to caching layers or application-side read distribution.

**Aurora Global Databases**, which enable read-only replicas in multiple AWS regions with sub-second replication lag, were completely unavailable for v1. This was particularly limiting for applications with geographically distributed users or strict data residency requirements. v2 now supports Global Databases, allowing you to maintain read replicas in other regions that automatically stay in sync with your primary cluster, all while using serverless autoscaling.

**Backup and restore** functionality differs between versions. v1 has some restrictions around automated backups and point-in-time recovery that v2 has relaxed. Additionally, v2 provides better integration with other AWS services and more consistent behavior with provisioned Aurora.

These feature additions in v2 weren't easy engineering wins—they required rethinking fundamental aspects of how the serverless architecture works. But their inclusion means that v2 is genuinely suitable as a primary database choice for production applications, whereas v1 always felt slightly second-class for anything beyond development, testing, or non-critical workloads.

### Pricing and Cost Models: ACUs and Cold Starts

Understanding how you're charged for Aurora Serverless is essential to evaluating whether serverless makes financial sense for your workload.

Both v1 and v2 price based on Aurora Compute Units (ACUs). One ACU corresponds roughly to 2 GB of memory paired with proportional vCPU allocation. If your database is running 4 ACUs, it's essentially a 1 vCPU instance with 8 GB of memory (though the exact CPU-to-memory ratio varies by configuration). You're charged per second for the ACUs your database consumes.

The key difference emerges in how the two versions charge for idle capacity and cold starts. **In v1**, when your database scales down to its minimum (typically 2 ACUs), you continue paying for those 2 ACUs even if there's zero traffic. Because of the warm pool architecture, AWS needs to maintain some minimum capacity standing by. If your database has periods of inactivity—say, you run batch jobs from 2 AM to 4 AM and the database is idle the rest of the time—you're still paying for that minimum for the entire day. For some workloads, especially those with predictable down-time windows, this can make v1 significantly more expensive than provisioned Aurora.

**In v2**, the minimum capacity is also configurable, but the scaling behavior is more responsive and efficient. Additionally, v2 supports pause functionality, which we'll discuss in a moment. However, v2 pricing still includes charges for storage, I/O, and minimum compute capacity if you don't enable pausing.

Speaking of pausing: **Aurora Serverless v1 does not support automatic pause**. If you want your database to pause when there's no activity, you need to implement application logic or use a scheduler. **Aurora Serverless v2 introduced automatic pause**, which puts your database into a paused state after a period of inactivity. When paused, you pay only storage and backup costs—effectively zero compute charges. This is transformative for dev/test environments or workloads with long idle periods. You can set the pause delay anywhere from 5 minutes to 1 day. When a query arrives after the database is paused, there's a cold start delay of around 10-30 seconds while the compute layer wakes up, but for non-critical workloads, this is often acceptable.

Let's put this in concrete terms. Imagine you're running a staging database that's used during business hours but sits idle overnight and on weekends. With v1, you might pay $50-100 per month just to keep 2 ACUs running 24/7. With v2 and pause enabled, your monthly bill might be $5-10 for storage, with compute charged only during the hours you're actually using it. For development and testing workloads, this difference is game-changing.

Of course, if your production workload runs 24/7 with moderate traffic, serverless might be more expensive than a small provisioned instance. A provisioned db.t3.small costs roughly the same per month regardless of traffic, whereas serverless costs accumulate per second. Run the math for your specific patterns, but generally: unpredictable or variable workloads favor serverless, while consistent baseline traffic favors provisioned.

### Cold Start Behavior and Performance Implications

The cold start experience differs meaningfully between v1 and v2, and it's worth understanding in detail because it directly affects how you design your applications.

**Aurora Serverless v1** experiences cold starts when the database scales up. If your minimum capacity is 2 ACUs and you suddenly get traffic that demands 16 ACUs, v1 needs to pause your connections, move your workload to a larger instance, and resume. This entire process typically takes 10-30 seconds, during which your application receives database connection errors. Your application must have retry logic to handle this gracefully. For API endpoints, you can usually catch the exception and retry the request; users might see a brief delay, but it's often unnoticeable if you retry immediately. However, for long-running batch jobs or streaming applications, a cold start is more disruptive.

**Aurora Serverless v2** also experiences cold starts when the database scales from zero or wakes from pause. However, because v2 uses in-place scaling for normal load increases, cold starts are less frequent. You primarily encounter them when:

1. The database is initially created (it takes 10-15 seconds to boot)
2. The database wakes from pause (similar startup time)
3. The load exceeds the maximum configured ACUs and there's some time lag (rare and brief)

Normal scaling within the configured range in v2 happens smoothly without user-visible delays. This is a substantial quality-of-life improvement over v1.

The difference in cold start frequency makes v2 far more forgiving for applications that lack sophisticated retry logic or connection pooling. It also makes v2 more suitable for applications where every millisecond of latency matters, like real-time analytics or gaming backends.

If you do enable pause on v2 and want to avoid cold starts in your application, you can set up a CloudWatch event or Lambda function to pre-emptively resume the database before peak usage windows. This is a simple operational pattern that's barely necessary anymore, but it's there if you need it.

### Migration Strategy: From v1 to v2

If you've built your application on Aurora Serverless v1 and want to move to v2, the good news is that the migration path is straightforward. The databases are compatible at the SQL level—the same application code works on both. The challenge is orchestrating the data migration with minimal downtime and testing thoroughly to ensure your application behaves as expected under the new scaling model.

**Step 1: Evaluate Your Application's Readiness**

Before you touch the database, review your application code for any assumptions specific to v1's behavior. Specifically:

Look for explicit minimum and maximum capacity configurations. v1 uses `min_capacity` and `max_capacity` parameters set at cluster creation time. v2 uses `min_aurora_adu` and `max_aurora_adu` (Aurora Database Units—another term for the same concept, confusingly). If your infrastructure-as-code is hardcoding these values, you'll need to update them.

Check whether your application has explicit pause logic. If you've implemented your own pause mechanism for v1 because it wasn't available, you can now simplify by relying on v2's native pause functionality.

Review your connection pooling and retry logic. v2 is more forgiving about cold starts during normal operation, but robust retry logic is still a best practice for any serverless workload.

Verify that your application doesn't rely on v1-specific limitations that you've worked around. For instance, if you've disabled read replicas because they weren't serverless in v1, you now have the option to add them in v2.

**Step 2: Create a v2 Cluster**

You cannot upgrade a v1 cluster in-place to v2. Instead, you create a new v2 cluster and migrate data to it. Here's the process:

Create a new Aurora Serverless v2 cluster with the same database engine version and configuration as your v1 cluster. Ensure the v2 cluster is in the same VPC and security group configuration as your v1 cluster, or at least has network connectivity to your application servers and any external systems that access the database. Configure the scaling parameters: set `min_aurora_adu` and `max_aurora_adu` based on your v1 configuration (roughly 1 ACU = 1 ADU in practical terms, though the underlying implementation differs). Decide whether to enable automatic pause if appropriate for your workload.

**Step 3: Data Migration**

With both clusters running, you need to get your data from v1 to v2. The standard approach is to use AWS Database Migration Service (DMS), which handles schema migration, full data copy, and ongoing replication until you're ready to cut over.

Launch a DMS replication instance in your AWS environment. Create a source endpoint pointing to your v1 cluster and a target endpoint pointing to your v2 cluster. Create a migration task that performs a full load of all tables, followed by continuous replication of changes (CDC, or Change Data Capture). This keeps the v2 cluster synchronized with v1 until you're ready to switch traffic.

Run the migration task and monitor its progress. DMS provides detailed metrics on how much data has been replicated and whether there are any errors. This might take minutes or hours depending on your database size.

Alternatively, if you prefer a simpler approach for smaller databases, you can:

Take a manual snapshot of your v1 cluster, restore that snapshot to a provisioned Aurora cluster, then restore that provisioned cluster to your v2 serverless cluster. This works but involves an extra step.

Use AWS Database Export to S3 and then load the data back using LOAD DATA INFILE, but this requires downtime and is more manual.

For most production scenarios, DMS is the right tool because it minimizes downtime and gives you confidence that data is in sync before you switch.

**Step 4: Testing and Validation**

Before you route production traffic to v2, you need to validate that everything works as expected. Set up a testing phase where your application can query the v2 cluster while continuing to write to v1. Compare results to ensure data consistency. Run load tests against v2 to understand its scaling behavior under your actual traffic patterns. This is important because v2's scaling characteristics are different—you might find that your minimum/maximum ACU settings need adjustment based on how the new architecture behaves.

Test failover scenarios. Since v2 now supports Multi-AZ, verify that your application handles brief connection losses during failover. Test pause and resume if you've enabled pause—verify that your application retries correctly when the database wakes up.

**Step 5: Cutover**

Once testing is complete and you're confident in v2, you're ready to switch production traffic. The exact approach depends on your application architecture:

If you use DNS (which you should), update your database endpoint DNS to point to the v2 cluster. You can do this gradually if you support weighted DNS routing, directing a small percentage of traffic to v2 first, then ramping up as you gain confidence.

If you use connection pooling or a database proxy, update the configuration to use the v2 endpoint.

Coordinate with your team to perform the cutover during a maintenance window if possible, though with proper testing, the actual switch should be low-risk.

**Step 6: Decommission v1**

After you've verified that v2 is handling all traffic correctly (typically after 24-48 hours), delete the v1 cluster. But keep the final snapshot for a few days just in case you need to roll back—though if you've done proper testing, rollback should be unnecessary.

### Managing the Transition Smoothly

Several operational considerations make the migration easier:

**Use parameter groups effectively.** Both v1 and v2 use parameter groups to manage configuration. If you've customized parameters in v1, export those settings and apply them to v2. This ensures consistent behavior across the transition.

**Plan for monitoring changes.** Aurora Serverless v2 exposes different metrics than v1. The database load (measured in ACUs) is exposed differently, and scaling events are less dramatic. Review your CloudWatch dashboards and alarms—some v1-specific alarms might no longer be relevant, and you may want to add new ones specific to v2's behavior.

**Consider regional presence.** If v1 clusters are in multiple regions, plan to migrate them all within a reasonable timeframe. Having some clusters on v1 and others on v2 adds operational complexity.

**Leverage automation.** Infrastructure-as-code tools like CloudFormation or Terraform support both Aurora Serverless v1 and v2. If you're using these tools, update your templates to specify v2. This ensures that new environments and disaster recovery scenarios use the latest architecture.

### When v1 Still Makes Sense

Despite v2's improvements, there are still scenarios where v1 remains a reasonable choice, at least until you're ready to migrate:

If you have a small, non-critical workload (development database, small staging environment) and migration effort isn't justified by the benefits, v1 works fine. The gap in capabilities matters less for non-production systems.

If you're in a region where v2 isn't yet available (AWS rolls out features region-by-region), you may not have a choice. Check the current regional availability.

If you've invested heavily in application code or automation specifically optimized for v1's behavior and there's no immediate business driver to migrate, the cost-benefit might not justify the effort. However, this gets less true as time passes—v2 is AWS's current focus, and v1 will eventually be deprecated.

For most other scenarios, v2 is the better choice for new workloads, and migration for existing v1 workloads is worth planning in the medium term.

### Conclusion

The evolution from Aurora Serverless v1 to v2 represents a meaningful architectural improvement. v1 solved the problem of database autoscaling but came with trade-offs—occasional pauses, limited features like Multi-AZ and global databases, and less efficient scaling for certain workload patterns. v2 addresses these limitations with a fundamentally different approach to scaling that's more responsive and efficient, while closing feature gaps that made v1 unsuitable for many production scenarios.

The migration path is straightforward for most applications: create a v2 cluster, use DMS to migrate data with minimal downtime, test thoroughly, and switch traffic. The effort is measured in hours to days for most workloads, and the benefits—smoother scaling, better performance characteristics, pause functionality, and access to features like Multi-AZ and Global Databases—justify the investment.

If you're already running v1, audit your workload against v2's benefits and start planning a migration timeline. For new projects, v2 should be your default choice unless specific constraints require otherwise. The serverless database landscape has matured considerably, and v2 represents a genuinely practical alternative to provisioned capacity for a wide range of applications.
