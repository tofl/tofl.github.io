---
title: "OpenSearch UltraWarm and Cold Storage Tiers Explained"
---

## OpenSearch UltraWarm and Cold Storage Tiers Explained

When you're running a logging or analytics workload on Amazon OpenSearch Service, you face a familiar tension: keeping all your data hot and searchable costs money, but archiving it completely means losing the ability to query it. OpenSearch's tiering system—comprising hot, UltraWarm, and cold storage layers—gives you a pragmatic middle ground. Instead of choosing between "expensive and fast" or "cheap and unavailable," you can design a retention strategy where data moves through progressively cheaper tiers as it ages and is queried less frequently.

This article walks you through how these tiers work, the economics of each, and how to automate the movement of your data to optimize both cost and performance. Whether you're managing terabytes of log data or building a multi-year analytics archive, understanding OpenSearch's tiering options will help you build systems that scale without breaking your budget.

### Understanding OpenSearch Storage Tiers

OpenSearch Service offers three distinct tiers where you can store and query your indexes, each with different performance characteristics and cost profiles.

The **hot tier** is where all newly ingested data lands by default. It uses standard EBS-backed storage nodes—fast, responsive, and expensive. When you're indexing millions of events per second, querying with sub-second latencies, or running complex aggregations, the hot tier is where you want to be. Hot indexes live on the primary data nodes of your cluster, and every query and write operation benefits from the low-latency access these provide.

The **UltraWarm tier** is AWS's clever bridge between hot storage and long-term archival. UltraWarm nodes are backed by S3 rather than EBS, which makes them significantly cheaper to operate. The trade-off is that UltraWarm indexes are read-only—you cannot write new documents to them. They're designed for data you no longer actively ingest into but still want to search regularly. Think of indexes from last week, last month, or even last quarter. A typical query against UltraWarm data takes longer than a hot query (because the data must be fetched from S3), but it's dramatically cheaper per gigabyte.

The **cold tier** represents your longest-term storage option. When an index is moved to cold storage, the index itself is detached from your cluster entirely and stored as a snapshot in S3. Cold indexes are not queryable without first being restored back to hot or UltraWarm. For compliance archives or data you rarely need to access, cold storage is the most economical option.

### The Economics of Each Tier

To make good tiering decisions, you need to understand the cost structure. Let's break down the financial picture.

Hot storage costs are driven by two factors: the number and type of nodes you run, and the data volume stored on EBS. A typical hot node might be an i3en.3xlarge instance with both compute and NVMe storage, costing around $3–5 per hour depending on region. Then you pay for EBS storage itself, which runs roughly $0.10–0.15 per GB per month for gp3 volumes. If you're storing 5 TB of hot data, you're looking at about $500–750 monthly just for storage, before network, compute, and data transfer costs.

UltraWarm nodes, by contrast, are much cheaper. UltraWarm nodes are optimized instances (like r6g.xlarge) without local storage, running around $1–2 per hour. You pay separately for S3 storage at roughly $0.023 per GB per month. That same 5 TB would cost only about $115 per month in S3 storage alone. The caveat is that UltraWarm queries incur S3 request charges and data transfer costs, but for infrequently accessed data, the overall savings are substantial—often 60–80% cheaper than keeping the same data hot.

Cold storage is the cheapest long-term option. You're paying S3 Standard storage rates (around $0.023 per GB per month) with no compute costs, because the index snapshots aren't attached to any cluster. A 5 TB cold index might cost $115 per month in S3, plus snapshot request fees. If you rarely or never query this data, cold is where it belongs.

Here's a practical example: suppose you ingest 1 TB of logs daily and want to keep two weeks of data hot, eight weeks in UltraWarm, and everything older than twelve weeks in cold. Your hot tier might hold 14 TB and cost around $1,400–2,100 monthly. Your UltraWarm tier holds 56 TB at roughly $1,300 monthly. Your cold archive grows indefinitely but costs only storage—a year of daily data (365 TB) might cost $8,400 annually in S3. The total cost for this setup is a fraction of what you'd pay keeping all 365 TB hot or even all in UltraWarm.

### Query Performance Trade-offs

The journey through tiers isn't free from a performance perspective, and you need to understand what queries cost in latency.

A query against hot data typically responds in tens of milliseconds. The index is in memory or on fast NVMe storage, the data is local to the node processing it, and there's minimal I/O overhead. This is ideal for dashboards, alerts, and interactive analysis where humans are waiting for results.

UltraWarm queries are slower. When you search an UltraWarm index, OpenSearch fetches the data from S3 into the UltraWarm node's cache, executes the query, and returns results. A query that took 50 milliseconds on hot data might take 1–5 seconds on UltraWarm, depending on data size, query complexity, and whether the data is already cached in the node's memory. For log searching or historical analysis where you don't need immediate results, this is acceptable. For real-time dashboards, it's not.

Cold indexes are not queryable at all without restoration. If you need to search a cold index, you must first restore it to hot or UltraWarm—a process that can take minutes to hours depending on the index size. Cold storage is for "I might need this data someday" scenarios, not "I query this weekly."

The practical implication is that your tiering strategy must align with your query patterns. If your business requirements say "we need to search logs from the last 30 days with sub-second latency," those 30 days must be in your hot tier, regardless of cost. But data from 90 days ago that you query maybe once a month? That belongs in UltraWarm or cold.

### Moving Data Between Tiers

There are two primary ways to move indexes between tiers: manual migration and automated migration via Index State Management (ISM) policies. For any production system, automation is the way to go, but let's start with the manual approach to understand what's actually happening under the hood.

To manually move an index from hot to UltraWarm, you first ensure it's not receiving new writes (you've rotated to a new hot index). Then you shrink the index to a single shard, which is a requirement for UltraWarm. You can do this with a simple API call:

```json
PUT my-logs-2024-01-01/_settings
{
  "index.number_of_shards": 1
}
```

Once the index is shrunk, you move it to UltraWarm with an allocation filter:

```json
PUT my-logs-2024-01-01/_settings
{
  "index.routing.allocation.require.data": "warm"
}
```

OpenSearch will automatically migrate the shard from hot nodes to UltraWarm nodes. The process can take minutes to hours depending on index size and network bandwidth.

To move from UltraWarm to cold storage, you take a snapshot of the index first, then delete the index from the cluster, and finally restore it manually when needed. Alternatively, you can use ISM to automate this workflow.

**Index State Management** is where things get elegant. ISM lets you define policies that automatically transition indexes based on age, size, or other conditions. Here's a simplified example policy:

```json
{
  "policy": {
    "description": "Move logs through tiers based on age",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [
          {
            "rollover": {
              "min_doc_count": 1000000
            }
          }
        ],
        "transitions": [
          {
            "state_name": "warm",
            "conditions": {
              "min_index_age": "7d"
            }
          }
        ]
      },
      {
        "name": "warm",
        "actions": [
          {
            "set_read_only": {}
          },
          {
            "shrink": {
              "num_new_shards": 1
            }
          }
        ],
        "transitions": [
          {
            "state_name": "cold",
            "conditions": {
              "min_index_age": "30d"
            }
          }
        ]
      },
      {
        "name": "cold",
        "actions": [
          {
            "snapshot": {
              "repository": "my-repository",
              "snapshot": "my-snapshot"
            }
          }
        ],
        "transitions": [
          {
            "state_name": "delete",
            "conditions": {
              "min_index_age": "365d"
            }
          }
        ]
      },
      {
        "name": "delete",
        "actions": [
          {
            "delete": {}
          }
        ]
      }
    ]
  }
}
```

This policy automatically rolls over to a new hot index when it reaches 1 million documents, moves indexes to UltraWarm after 7 days of inactivity, snapshots them to cold after 30 days, and deletes them after one year. Once you attach this policy to your indexes, OpenSearch manages the entire lifecycle without manual intervention.

The beauty of ISM is that it removes the operational burden. You define your retention strategy once, and it executes automatically. No more hunting through your cluster to manually move old indexes or worrying about accidentally querying performance by leaving too much data hot.

### Typical Retention Patterns for Log Analytics

Different organizations have different compliance and business requirements, but a few patterns have emerged as common and practical for log analytics workloads.

The **active-archive pattern** is popular for organizations that need quick access to recent logs but want to minimize cost. Keep 30 days hot, 60 days in UltraWarm, and snapshot older data to cold storage. This gives you interactive search over the last month (for troubleshooting and debugging), searchable archives for the previous two months (for trend analysis and compliance audits), and unlimited cold storage for the long-term record. Queries during that three-month window are fast; queries into cold storage require restoration but are possible.

The **compliance-driven pattern** suits heavily regulated industries. Ingest everything hot for immediate analysis, move to UltraWarm after 30 days, and keep cold snapshots for seven years. The costs are high because you're storing massive volumes long-term, but every bit of data is audit-searchable and compliant with retention policies. You might use cold storage class analysis tools to further optimize S3 costs by moving cold snapshots to Glacier after a few years if you never actually query them.

The **performance-optimized pattern** is for organizations running real-time analytics and dashboards. Keep only the current day's data hot (or perhaps the last 3–7 days), move older data immediately to UltraWarm, and delete cold snapshots aggressively. This keeps your hot cluster lean, your costs predictable, and your query performance consistently snappy. You trade historical searchability for operational simplicity and cost control.

The **time-series compression pattern** acknowledges that not all data is equally valuable. You might keep highly detailed, high-cardinality data hot for only 7 days, then move a compressed or pre-aggregated version to UltraWarm for 90 days. This works well if your upstream systems can generate aggregated metrics (hourly summaries, percentile rollups) alongside raw logs. You lose granularity over time, but you keep the data searchable and affordable.

### Best Practices for Tiering Strategy

Before you implement OpenSearch tiering, consider a few foundational decisions that will shape your entire strategy.

First, align your tiering strategy with your actual query patterns, not your hopes or fears about what users might want. Many teams over-provision hot storage because they worry they'll need to search old data quickly. In practice, if you haven't searched data in 30 days, you probably won't search it in the next week either. Use OpenSearch's monitoring to understand which indexes are actually being queried, then base your tiering decisions on that reality.

Second, use ISM policies religiously. Manual index management doesn't scale and introduces human error. Write a policy that reflects your business requirements, test it thoroughly in a non-production environment, and let it run. Revisit it quarterly as your requirements evolve, but don't manage transitions by hand.

Third, monitor your UltraWarm and cold query latencies. If users are consistently frustrated by slow searches of UltraWarm data, that data might belong in hot storage. Conversely, if cold storage is never accessed, consider shortening your retention window. Let real performance data inform your tiering decisions, not assumptions.

Fourth, set up appropriate S3 lifecycle policies for your snapshot buckets. If you're keeping cold snapshots for compliance, make sure your S3 bucket isn't accidentally deleting them. If you're truly archival, consider moving snapshots to S3 Standard-IA or Glacier after 90 days to save even more money.

Finally, plan for growth. Your tiering strategy should accommodate projected data volume growth over the next 12–24 months. If you're ingesting 1 TB daily now but expecting 5 TB daily in two years, that should influence whether you buy UltraWarm capacity now or plan to scale it later.

### Conclusion

OpenSearch's tiering system—hot, UltraWarm, and cold storage—gives you the flexibility to build analytics platforms that are both performant and cost-effective. Hot storage keeps your most-queried data fast. UltraWarm bridges the gap for data you need to search occasionally at a much lower cost. Cold storage provides indefinite, audit-ready archival at minimal expense.

The key to success is understanding the trade-offs: hot is fast and expensive, UltraWarm is slower and much cheaper, cold is immutable until restored and cheapest of all. Align your tiering strategy with your query patterns and compliance requirements, automate transitions with ISM policies, and monitor the results. Done well, tiering transforms OpenSearch from a system where you constantly compromise between cost and capability into one where you can have both—you're just searching at different speeds depending on how old the data is.
