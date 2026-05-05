---
title: "Scaling ElastiCache: Vertical vs Horizontal Scaling Strategies"
---

## Scaling ElastiCache: Vertical vs Horizontal Scaling Strategies

When your application starts hitting the limits of your in-memory cache, you face a critical decision: do you upgrade your existing nodes to handle more load, or do you add more nodes to distribute the work? This question sits at the heart of scaling ElastiCache, and the answer depends on your architecture, tolerance for downtime, and the specific engine you're running.

ElastiCache supports two popular in-memory data stores—Redis and Memcached—and each responds differently to scaling challenges. More importantly, the way you scale these systems can have profound implications for your application's availability and performance. In this article, we'll explore both vertical and horizontal scaling strategies, understand when each makes sense, and walk through the practical mechanics of implementing them.

### Understanding Your Scaling Options

Before diving into specifics, let's establish what we mean by vertical and horizontal scaling in the context of ElastiCache.

Vertical scaling involves upgrading to a larger node type—moving from a cache.t3.medium to a cache.r7g.xlarge, for example. This gives you more memory, more CPU, and more network throughput on each individual node. It's often the simplest approach conceptually: throw more resources at the problem.

Horizontal scaling means adding more nodes to your cluster. Instead of making each node bigger, you distribute your data across more nodes, spreading the load across the fleet. This approach typically offers better resilience and can accommodate larger datasets, but it's more complex to implement correctly.

The tricky part is understanding that vertical and horizontal scaling have fundamentally different operational characteristics. Vertical scaling in ElastiCache often triggers downtime, while horizontal scaling can often happen online. This distinction alone can make or break your scaling strategy.

### Vertical Scaling: Simplicity with a Cost

Vertical scaling is the most straightforward approach to adding capacity. You select a larger node type and initiate the upgrade through the AWS Management Console, AWS CLI, or infrastructure-as-code tools like Terraform.

When you upgrade a node type in ElastiCache, AWS must restart the node with the new instance type. During this restart, your cache is temporarily unavailable. For a standalone Redis instance or a Memcached node, this means any in-flight connections are dropped and cached data is lost (unless you're using Redis persistence, which we'll discuss shortly).

The duration of downtime during vertical scaling typically ranges from a few minutes to several minutes, depending on the size of the node and network conditions. For applications that can tolerate brief cache misses, this may be acceptable. Your application will experience a spike in load on your primary database as requests bypass the now-unavailable cache, but if you've designed proper retry logic, most applications recover gracefully.

The real benefit of vertical scaling emerges when you're running out of a single resource—usually memory. If your working set is growing but you don't want to manage cluster complexity, upgrading node types is clean and operationally simple. There's no resharding logic to worry about, no connection pooling adjustments needed across multiple nodes, and no risk of uneven data distribution.

However, vertical scaling has hard limits. AWS offers node types up to cache.r7g.24xlarge with substantial memory, but you can't scale indefinitely on a single node. Additionally, vertical scaling doesn't improve fault tolerance—a larger single node is still a single point of failure. If that node experiences hardware issues, you're down regardless of how much memory it has.

### Horizontal Scaling for Redis: Cluster Mode Enabled

Redis shines when you need true horizontal scalability, especially with Redis Cluster Mode enabled. This is where ElastiCache becomes significantly more powerful than simple vertical expansion.

In Redis Cluster Mode, your data is partitioned across multiple primary nodes using hash slots. Redis divides the 16,384 available hash slots among your primary nodes, and each key is mapped to a slot using CRC16 hashing. This distribution is deterministic—the same key always maps to the same slot, ensuring consistency without needing centralized coordination.

When you add shards to a Redis Cluster Mode cluster, AWS initiates an online resharding operation. This is the critical difference from vertical scaling: your cluster remains available during the entire process. AWS migrates hash slots from existing shards to new shards gradually, and because each slot migration happens without stopping the cluster, your application experiences no downtime.

Let's walk through what online resharding looks like. Suppose you have a 3-shard Redis Cluster Mode cluster and you want to add 2 more shards to reach 5 total. You request the addition through the AWS Console or API. AWS then:

1. Creates the new shard nodes and adds them to the cluster
2. Begins migrating hash slots from the existing shards to the new shards
3. Updates the cluster's topology information so all nodes understand the new distribution
4. Monitors the migration to ensure data integrity

During this entire process, your application continues reading and writing normally. There might be microsecond-level latencies during slot migrations as data moves between nodes, but this is typically imperceptible compared to network latency and query processing time.

The mechanics of slot migration are worth understanding. When a client tries to access a key that's currently being migrated, Redis responds with a MOVED or ASK redirect that tells the client which node now has that key. Properly written Redis clients—and most popular ones like redis-py, node-redis, and ioredis—handle these redirects automatically.

Online resharding does introduce some operational considerations. The resharding operation consumes CPU and network bandwidth on both source and destination shards. If your cluster is already at high utilization, initiating a reshape during peak traffic might degrade performance. AWS typically recommends scheduling resharding during lower-traffic windows to minimize impact, though the operation won't cause downtime.

Removing shards from a Redis Cluster Mode cluster works similarly. AWS redistributes data from the shard you're removing to the remaining shards and then removes the empty shard. Again, this happens online without stopping your cluster.

### Horizontal Scaling for Redis: Adding Read Replicas

Beyond sharding, Redis offers another horizontal scaling strategy: read replicas. A read replica is an additional node that replicates data from a primary node but serves only read traffic.

In a non-clustered Redis setup (called Redis Cluster Mode Disabled in AWS terminology), you can have one primary node and up to five read replicas. All writes go to the primary, which replicates writes to all replicas asynchronously. Reads can be distributed across all nodes—primary and replicas—reducing load on the primary.

This architecture is excellent for read-heavy workloads. Consider an application that reads user profiles from cache thousands of times per second but writes new profiles infrequently. By adding read replicas, you distribute the read load across multiple nodes, each with its own CPU and network bandwidth.

Adding a read replica to a Redis Cluster Mode Disabled cluster is operationally simple and doesn't cause downtime. AWS provisions a new node, establishes the replication stream from the primary, and it's ready to serve traffic within minutes.

However, read replicas don't help with memory scaling. All your data still exists on the primary node, so if you're running out of memory, you still need either vertical scaling or the shard-based approach of Cluster Mode.

There's also a consistency consideration: replicas lag behind the primary by milliseconds due to replication latency. If your application writes a value and immediately reads from a replica, there's a small window where you might get stale data. For most use cases, this is perfectly acceptable—your application can be designed to read from the primary when strict consistency matters—but it's important to understand.

### Horizontal Scaling for Memcached: Auto-Discovery

Memcached clustering works fundamentally differently from Redis. Memcached has no concept of primary/replica relationships or data replication. Instead, data is distributed across nodes using consistent hashing on the client side.

When you add a node to a Memcached cluster, the client application must learn about the new node and begin distributing keys to it. This is where Memcached's auto-discovery feature becomes invaluable.

Auto-discovery allows Memcached clients to automatically discover cluster members without requiring configuration changes. Instead of hardcoding a list of Memcached nodes in your application configuration, you provide the address of the cluster's configuration endpoint. Your client library periodically queries this endpoint to learn about all available nodes and automatically adjusts its key distribution algorithm accordingly.

The beauty of auto-discovery is that adding or removing Memcached nodes requires no application restarts or code changes. When you add a node to your Memcached cluster through the AWS Management Console, auto-discovery clients automatically discover it within minutes and start using it for new key distributions.

However, this comes with a caveat: adding a Memcached node causes existing keys to be rehashed across the cluster. Keys that previously hashed to Node A might now hash to the new Node C. This means cache misses during scaling—the old keys are still on the original nodes, but the client might look for them on the new distribution. This is a form of cache eviction, and it's unavoidable with consistent hashing.

The impact of this cache miss spike is usually manageable for Memcached clusters because Memcached is typically used for non-critical caching (unlike Redis, which is often used for sessions, locks, and other mission-critical data). Applications expect Memcached cache misses and have fallback logic to fetch data from the database.

One important note: Memcached auto-discovery only works for clients using compatible client libraries and connecting through the cluster's configuration endpoint, not individual node endpoints. Your application code must be written to use auto-discovery from the start; you can't retrofit it into an existing deployment that directly targets individual nodes.

### Planning Capacity with CloudWatch Metrics

Neither vertical nor horizontal scaling happens in a vacuum. Effective scaling requires monitoring your cluster to understand when you've reached capacity limits and what type of scaling addresses your specific bottleneck.

ElastiCache publishes several critical metrics to CloudWatch that reveal your cluster's health and capacity utilization.

**EngineCPUUtilization** shows the percentage of CPU being used by the Redis or Memcached engine process itself. High CPU utilization indicates that your nodes are working hard to process requests. If you're seeing sustained CPU utilization above 75–80%, scaling is likely needed. For vertical scaling, higher CPU often points to complex operations—perhaps many sorted set operations or large string parsing—that benefit from faster processors. For horizontal scaling, high CPU across all nodes suggests that adding more nodes to distribute load would help.

**DatabaseMemoryUsagePercentage** reveals how much of your node's available memory is consumed by cached data. As this approaches 100%, you're approaching your cluster's capacity. If you're hitting memory limits, you have two options: vertical scaling to larger nodes with more memory, or horizontal scaling to distribute your dataset across more nodes. This metric is particularly important because memory is often the limiting factor for cache clusters.

**CurrConnections** tracks the number of active client connections. Memcached and Redis both have limits on concurrent connections per node, though these limits are high. If you're approaching connection limits, it often indicates that your application is creating too many connections (a connection pooling issue) rather than that your cluster needs scaling. However, more nodes can help distribute connections if pooling isn't feasible.

Beyond these, **NetworkBytesIn** and **NetworkBytesOut** show network throughput. If your cluster is saturating available network bandwidth, adding more nodes distributes the load across more network interfaces. **CacheHitRate** reveals what percentage of requests are served from cache versus hitting your backend database. A declining hit rate might indicate you need more memory.

Effective capacity planning means establishing baselines for these metrics under normal load and setting up alarms for concerning thresholds. Most organizations find that initiating scaling when CPU reaches 70–75% or memory reaches 80–85% provides a comfortable buffer before hitting hard limits.

### Making the Scaling Decision

So when should you scale vertically versus horizontally? The decision matrix is relatively straightforward in practice.

Choose vertical scaling when you have capacity headroom on other dimensions but are constrained by a single resource on your current nodes. If your cluster has plenty of available memory but CPU is at 60%, upgrading to a faster node type makes sense. Vertical scaling also makes sense if you prefer operational simplicity and can tolerate brief maintenance windows. For smaller workloads or those with low traffic, the simplicity of managing a single large node might outweigh the complexity of clustering.

Choose horizontal scaling—adding shards in Redis Cluster Mode or nodes in Memcached—when you're running out of memory or need better fault tolerance. If your dataset is growing faster than you can vertically scale, horizontal scaling lets you expand indefinitely. Horizontal scaling also improves availability: losing one node in a multi-node cluster affects only the data on that node, not your entire cache.

For Redis without Cluster Mode, adding read replicas is the answer when you have a read-heavy workload but don't need more total memory. This is an underutilized pattern that can dramatically improve performance for applications that read much more frequently than they write.

In practice, many organizations use a combination approach. They might start with a moderately-sized standalone Redis instance or small Memcached cluster, scaling vertically as the application grows. Once they hit the limits of vertical scaling or need better fault tolerance, they migrate to horizontally-scaled architectures like Redis Cluster Mode. This two-phase approach balances operational simplicity early with scalability later.

### Execution Considerations and Best Practices

Regardless of which scaling approach you choose, executing it correctly requires attention to detail.

For vertical scaling in Redis, understand whether you're using Redis persistence (RDB snapshots or AOF logs). If you are, the upgrade process includes saving your data before shutting down the old node and reloading it on the new node. This can extend downtime significantly for large datasets. Plan accordingly and test the process in non-production environments first.

For online resharding in Redis Cluster Mode, monitor the resharding progress in the ElastiCache console. The operation shows you which shards are migrating slots and how many slots remain. Pay attention to the estimated time remaining—if it's taking much longer than expected, network congestion might be the culprit.

For Memcached scaling, ensure your client libraries support auto-discovery. Some older libraries or custom implementations might not. If auto-discovery isn't feasible, you'll need to manually update your application configuration and restart services, which introduces complexity.

Always test scaling operations in non-production environments first. Create a test cluster with similar data volume and traffic patterns, perform the scaling operation, and validate that your application behaves as expected. This catches configuration issues, code problems, and performance surprises before they affect production.

### Conclusion

Scaling ElastiCache effectively requires understanding both the technical mechanics and the operational implications of your scaling choices. Vertical scaling offers simplicity but eventually hits hard limits and requires downtime. Horizontal scaling—whether through Redis sharding, read replicas, or Memcached node addition—provides superior scalability and availability but introduces operational complexity.

The best approach depends on your current constraints, as revealed by CloudWatch metrics. If you're bottlenecked on CPU but have memory headroom, vertical scaling is efficient. If memory is the constraint, horizontal scaling becomes necessary. By monitoring your cluster proactively and understanding these scaling mechanisms, you can grow your cache layer efficiently and maintain the high performance your applications demand.
