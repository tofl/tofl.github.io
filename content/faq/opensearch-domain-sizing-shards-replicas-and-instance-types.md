---
title: "OpenSearch Domain Sizing: Shards, Replicas, and Instance Types"
---

## OpenSearch Domain Sizing: Shards, Replicas, and Instance Types

Getting the sizing of an Amazon OpenSearch domain right is one of those decisions that feels less critical at launch than it actually is. Size it too small, and you'll hit performance walls when your data grows. Size it too generously, and you're burning budget on unused capacity. The real challenge is that some decisions—like shard count—become nearly impossible to change later without reindexing. This article walks you through the practical considerations that let you make an informed sizing decision the first time, and understand the trade-offs when you need to scale.

### Why OpenSearch Sizing Matters

Before diving into the mechanics, let's establish why this matters. OpenSearch is a distributed search and analytics engine. It breaks your data into chunks called shards, spreads those chunks across multiple nodes, and coordinates searches across all of them in parallel. The way you divide your data fundamentally shapes your cluster's performance characteristics, your costs, and your operational flexibility.

Think of it like designing a bookstore. If you have one person (one shard) responsible for all the books, they'll be a bottleneck. If you split the books across too many staff members (too many shards), you'll waste money on overhead and coordination costs. The goal is to find the right balance for your specific workload.

### Understanding Shard Size and Count

A shard is the fundamental unit of data distribution in OpenSearch. Each shard is a Lucene index that contains a subset of your documents. When you index a document, OpenSearch uses a routing algorithm to determine which shard receives it. When you search, OpenSearch queries every relevant shard in parallel and merges the results.

The recommended shard size range is between 10 and 50 GB. This isn't arbitrary—it's derived from practical experience across thousands of deployments. Here's why this range makes sense.

At the lower end, a 10 GB shard is small enough that operations like recovery (when a node fails and the shard needs to be redistributed) complete quickly. Recovery involves reading data from disk, compacting it, and shipping it over the network to another node. Smaller shards mean faster recovery, which reduces the window of vulnerability when your cluster is operating below full replication. Additionally, smaller shards are easier for the JVM to manage in memory, since maintaining shard metadata and state requires heap space.

At the upper end, a 50 GB shard is large enough that you're not creating excessive coordination overhead. Every shard adds overhead to cluster state management, coordination between nodes, and search performance. With very small shards, you'd spend more time coordinating queries across hundreds of shards than actually searching the data.

Let's work through a concrete example. Suppose you're building a logging system and expect to ingest 500 GB of data over a one-year period. Using the shard size range, you'd want between 10 and 50 shards. A reasonable target might be 20 shards, which would give you 25 GB per shard—right in the middle of the recommended range. This balances recovery speed, memory overhead, and coordination costs.

The calculation is straightforward:

```
Number of primary shards = Expected data volume / Target shard size
```

If your expected volume is 500 GB and you want 25 GB per shard:

```
Number of primary shards = 500 GB / 25 GB = 20 shards
```

But here's the critical constraint: once you create an index with a specific number of primary shards, you cannot change it without reindexing. Reindexing means creating a new index with the correct shard count and copying all documents from the old index to the new one. For large datasets, this is time-consuming and resource-intensive. This is why careful planning upfront is so important.

When you create an index, you specify the number of shards like this:

```bash
PUT /my-index
{
  "settings": {
    "number_of_shards": 20,
    "number_of_replicas": 1
  }
}
```

Plan for growth conservatively. If you think you might grow to 2 TB of data over two years, plan your shard count for that 2 TB target, not your current size. The extra shards will be underutilized initially, but the operational overhead is minimal, and you'll avoid the painful reindex operation when you hit your growth projections.

### Replica Strategy: Balancing Availability and Cost

While you're stuck with your primary shard count, replicas are genuinely flexible. Replicas are copies of your primary shards. If you have a primary shard on Node A, a replica shard is a copy on Node B (or C, D, etc.). When you search, OpenSearch can query either the primary or any replica. When you index, OpenSearch updates the primary and all replicas.

The standard recommendation is to have at least one replica (which means two copies of your data total: one primary and one replica). This gives you basic redundancy. If a node fails, your data isn't lost. Additionally, having a replica means your read operations can be distributed across two nodes instead of one, effectively doubling your read throughput capacity.

Let's think through a typical scenario. You have 20 primary shards. With one replica, you now have 40 total shards across your cluster (20 primaries + 20 replicas). If each shard uses about 1 GB of heap memory for metadata and JVM overhead, you've now doubled your memory requirement. More replicas mean more copies of your data, more heap usage, and higher storage costs. But they also mean better read performance and higher availability.

Here's a table to help you think through common replica configurations:

A zero-replica setup means each primary shard exists exactly once. This saves storage and cost, but any node failure causes immediate data loss or at minimum forces recovery from snapshot backups. This is generally only appropriate for non-critical development environments.

One replica is the production standard. You have two copies of every shard, so you can tolerate a single node failure without data loss. Read operations can be load-balanced across primaries and replicas.

Two replicas means three copies of every data. This is appropriate if you need very high read throughput or if your availability requirements are extremely strict. Major cloud providers and SaaS companies typically run with two or three replicas.

The number of replicas is also specified in the index settings and can be changed at any time without reindexing:

```bash
PUT /my-index/_settings
{
  "number_of_replicas": 2
}
```

When you increase the replica count, OpenSearch starts creating new replica shards in the background. This requires network bandwidth and disk I/O, but it doesn't stop your cluster from serving reads and writes. Conversely, decreasing the replica count removes replica shards, freeing up space on your nodes.

One important consideration: if you have a three-node cluster and you set `number_of_replicas` to 3, you'll need a fourth node to fully satisfy that configuration. OpenSearch won't place multiple copies of the same shard on the same node (that would defeat the purpose of replication). So think carefully about the relationship between your replica count and your node count.

### Choosing Instance Types for Different Roles

OpenSearch clusters can contain different types of nodes, each serving a different purpose. Understanding the trade-offs between them is crucial for efficient sizing.

**Data nodes** are where your actual shards live. These nodes store indices and perform searches and indexing operations. When you specify instance types for your OpenSearch domain, you're usually defining data nodes. The right size depends on your shard count and expected query volume. A general rule is that you want enough data nodes so that your data is distributed roughly evenly. If you have 20 shards and 5 data nodes, each node holds about 4 shards on average.

Data node instances should have sufficient memory for both the JVM heap and the operating system's page cache. The JVM needs heap for shard metadata, filter caches, and query coordination. The page cache (Linux filesystem cache) dramatically speeds up search performance by keeping frequently-accessed index data in memory. As a rule of thumb, allocate about 50% of an instance's RAM to the JVM heap and let the rest be available for the page cache.

For example, if you're using an `r6g.xlarge` instance with 32 GB of RAM, you might set the JVM heap to 16 GB and let the remaining 16 GB be available for the page cache.

**Master nodes** are responsible for cluster coordination. They maintain the cluster state (which nodes are healthy, which shards exist where, etc.), handle node failures, and execute administrative operations like creating or deleting indices. Master nodes don't store data shards; they're purely coordinating nodes.

In small clusters (fewer than 5 or 6 nodes), the data nodes also serve as master-eligible nodes, and one of them is elected master. But as your cluster grows, it's strongly recommended to run dedicated master nodes. A dedicated master node is a node that will never be elected to hold data shards; it solely participates in cluster coordination.

Why does this matter? When a data node fails, the cluster undergoes a rebalancing operation: shards that were on the failed node are reassigned to healthy nodes and recovered. During this time, the master node is heavily loaded. If the master node is also trying to serve queries and handle indexing on large datasets, it might become unresponsive, causing the cluster to think the master has failed, which triggers a master election and further instability. Dedicated master nodes avoid this contention.

The recommended practice is to run an odd number of dedicated master nodes, typically three. Three master nodes can tolerate the failure of one master node and still maintain a quorum (2 out of 3 nodes are needed to make cluster decisions). This prevents the "split-brain" scenario where the cluster accidentally partitions into two independent groups, each thinking it's the authoritative master.

Dedicated master nodes don't need to be large instances. They're not storing data or running complex queries. An `m6g.large` or even smaller instance is usually sufficient for a master node, regardless of your cluster's total data volume. The important thing is that you have three of them and they're distributed across different availability zones.

**UltraWarm nodes** are an optional, cost-effective option for warm data. Think of your indices as having a lifecycle: hot data (recent, frequently queried), warm data (older but still occasionally accessed), and cold data (rarely accessed, primarily for compliance or deep analytics). UltraWarm nodes are purpose-built for warm data. They're cheaper than regular data nodes but slightly slower because they retrieve index data from S3 instead of storing it locally.

UltraWarm is appropriate if you're storing large amounts of historical data that's infrequently accessed. For instance, if you're ingesting logs continuously into hot indices and want to keep the last 30 days of logs on hot data nodes, but you want to keep a year of historical logs available for occasional queries, you could use UltraWarm for the older indices. This significantly reduces your storage costs compared to running additional data nodes.

To use UltraWarm, you specify which indices should migrate to warm storage and when. OpenSearch handles the migration process, moving the index to UltraWarm nodes and retrieving it from S3 as needed for searches. The trade-off is slightly higher query latency (because data is fetched from S3) but much lower cost.

### Cluster Architecture: Putting It Together

Let's work through a realistic example to bring these pieces together. Suppose you're building an application metrics system and you expect to ingest about 2 TB of data over two years. You want to maintain data for the past 90 days in hot storage and keep a year of data total for trending analysis.

**Step 1: Determine shard count.** For 2 TB of total data, targeting 25 GB per shard:

```
Number of shards = 2 TB / 25 GB = 80 shards
```

**Step 2: Decide on replicas.** You want high availability and good read performance for a production application:

```
Number of replicas = 1 (standard production setting)
```

This means 160 total shards in your cluster (80 primaries + 80 replicas).

**Step 3: Choose data node instance types and count.** You want to distribute 80 primary shards across your data nodes reasonably evenly. Let's say you use `r6g.2xlarge` instances with 64 GB of RAM (split into roughly 32 GB heap and 32 GB for page cache). If each data node hosts about 8 primary shards, you'd need about 10 data nodes.

```
Data node count = 80 primary shards / 8 shards per node ≈ 10 nodes
Instance type: r6g.2xlarge
```

**Step 4: Add dedicated master nodes.** For stability and cluster health:

```
Dedicated master nodes = 3
Instance type: m6g.large
```

**Step 5: Plan for warm storage.** Suppose 270 GB of your data (the oldest 90 days beyond your immediate 90-day window) would be placed on UltraWarm:

```
UltraWarm capacity = ~11 nodes (r6g.large instances)
```

The exact calculation depends on the AWS documentation for your region, but UltraWarm pricing is significantly cheaper than data nodes while still providing search capability.

This is a realistic production cluster: 10 data nodes for hot data, 3 master nodes for coordination, and 11 UltraWarm nodes for warm data. Your total cost is lower than it would be if you ran everything on data nodes, and your performance and availability are high.

### Planning for Growth and Future Operations

One of the most important lessons from OpenSearch sizing is that your initial decisions have lasting consequences. Shard count especially cannot be changed without a reindex operation, which is time-consuming for large datasets.

When you're sizing your cluster, think about where your data volume will be in two to three years. It's usually better to overprovision shards initially than to face a painful reindex operation later. Excess shards have minimal overhead in a well-sized cluster. The coordination cost of having 80 shards instead of 40 is negligible compared to the operational effort of reindexing 2 TB of data.

On the flip side, don't go overboard. Creating 1,000 shards for an application that will never exceed 100 GB of data is wasteful. Use the 10–50 GB shard size as your guide and plan conservatively but not recklessly.

As your cluster operates, monitor key metrics: the average shard size (using the cluster stats API or your monitoring tools), node CPU and memory utilization, and query latency. If your shards are growing beyond 50 GB, you may need to plan for a reindex with higher shard count. If nodes are consistently at 70%+ memory utilization, you should add more nodes or increase node size.

Additionally, consider using index lifecycle management (ILM) to automate the movement of indices between hot, warm, and cold storage tiers as they age. This allows you to maximize cost efficiency while maintaining good performance for active data.

### Conclusion

Sizing an OpenSearch domain is a blend of arithmetic and judgment. You calculate the right number of shards based on expected data volume and the 10–50 GB recommendation, choose a replica count that balances availability and cost, select instance types that match your workload and budget, and decide whether dedicated master nodes and warm storage make sense for your use case.

The key insight is that shard decisions are permanent and reindex operations are costly, so it's worth taking time upfront to plan for reasonable growth. Conversely, replicas and node counts are flexible—you can adjust them as you learn more about your actual workload in production. Make bold, conservative choices on shard count; be ready to adjust on everything else. With that approach, you'll build a cluster that performs well, scales smoothly, and doesn't surprise you with unexpected costs or operational challenges down the road.
