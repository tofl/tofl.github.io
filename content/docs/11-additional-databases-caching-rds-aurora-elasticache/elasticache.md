---
title: "37. ElastiCache"
type: docs
weight: 3
---

## ElastiCache

Modern applications routinely hit the same database rows thousands of times per second — user profiles, product catalogues, leaderboards, session tokens. Every one of those hits costs latency and money. Amazon ElastiCache [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html) solves this by sitting an **in-memory data store** in front of your database. Reads that would take milliseconds against RDS or DynamoDB take **microseconds** from ElastiCache, and your database is freed from repetitive work it never needed to do.

ElastiCache is a fully managed service: AWS handles provisioning, patching, failure detection, and backups, leaving you to focus on caching logic.

It supports two engines — **Redis** and **Memcached** — and choosing between them is the first decision you will make.

### Redis vs Memcached

| | Redis | Memcached |
|---|---|---|
| Data structures | Strings, hashes, lists, sets, **sorted sets**, bitmaps, streams | Strings only |
| Persistence | Optional (RDB snapshots, AOF log) | None |
| Replication / Multi-AZ | Yes — primary + replicas, automatic failover | No |
| Pub/Sub messaging | Yes | No |
| Clustering (sharding) | Yes (Redis Cluster mode) | Yes (built-in) |
| Threading model | Single-threaded (mostly) | **Multi-threaded** |
| Use when | You need durability, advanced data types, failover, or pub/sub | You need the simplest possible horizontal scale-out with no state |

In practice, **Redis is the default choice** for most production workloads. Memcached is a good fit when you want pure, stateless object caching and plan to scale horizontally across many nodes without needing replication.

Full engine comparison: [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/SelectEngine.html)

### Caching Strategies

How you populate and update the cache is just as important as which engine you pick. Three patterns cover the vast majority of real-world use cases.

**Lazy Loading (Cache-Aside)**
The application checks the cache first. On a *cache miss* it reads from the database, writes the result into the cache, and returns it. On subsequent requests the cache serves directly.

- ✅ Only data that is actually requested gets cached — no wasted memory.
- ❌ The first request after a miss (or after expiry) always pays the full database round-trip — this is called a *cold start* penalty.
- ❌ Stale data is possible: if the database is updated, the cache holds the old value until TTL expires.

**Write-Through**
Every write to the database is *also* written to the cache immediately.

- ✅ Cache is always fresh — no stale reads.
- ❌ Every write pays twice (database + cache), even for data that may never be read.
- ❌ Cache is populated with data that might sit unused, wasting memory.

In production, **combining both** is common: write-through for hot, frequently-read keys; lazy loading as the fallback.

**Session Store**
A stateless application (e.g., multiple Lambda functions or EC2 instances behind a load balancer) cannot keep session state in local memory — any instance could handle any request. Storing sessions in Redis gives every instance access to the same session data with sub-millisecond reads. This is one of the most prevalent ElastiCache use cases alongside database result caching.

### Cache Eviction and TTL

A cache has finite memory. When it is full, ElastiCache must decide what to remove. The **eviction policy** controls this behaviour [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/ParameterGroups.Redis.html#ParameterGroups.Redis.policy).

Common policies:
- `allkeys-lru` — evict the **least recently used** key across all keys. Good general default.
- `volatile-lru` — LRU eviction, but only among keys that have a TTL set.
- `allkeys-lfu` — evict the **least frequently used** key (available in Redis 4+).
- `noeviction` — return an error when memory is full instead of evicting. Useful when you cannot afford data loss (e.g., a session store).

Beyond eviction, you should always set a **TTL (Time To Live)** on cached keys. TTL ensures stale data expires automatically and prevents unbounded memory growth. The right TTL is application-specific — seconds for real-time feeds, hours for product catalogue data.

### Redis-Specific Features Worth Knowing

**Persistence** — Redis can optionally persist data to disk via RDB snapshots or an Append-Only File (AOF), so the cache survives a restart. [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/RedisRestoreRDB.html)

**Pub/Sub** — Redis supports a lightweight publish/subscribe messaging pattern. Producers publish to a channel; subscribers receive messages in real time. This is useful for simple fan-out notifications but is not a replacement for SQS/SNS in durable messaging scenarios.

**Sorted Sets** — A Redis data structure where every member has an associated score. ElastiCache can return members ranked by score in O(log N) time. Real-time leaderboards (gaming, sports) are the canonical use case.

**Multi-AZ with Auto-Failover** — A Redis cluster can have one or more **read replicas** in different Availability Zones. If the primary node fails, ElastiCache automatically promotes the replica with the least replication lag, typically within 60 seconds. [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/AutoFailover.html) This makes Redis suitable for workloads that need high availability, not just caching.

### Security

**Encryption in transit** is enabled via TLS; **encryption at rest** uses KMS-managed keys. [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/encryption.html)

**Redis AUTH** adds a password requirement at the Redis protocol level — clients must send the correct token before issuing any commands. This is a second layer on top of network-level controls and is important for the exam. [🔗](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/auth.html)

**VPC isolation** is the primary network defence. Your ElastiCache cluster should live in a **private subnet** with no public access. Security groups control which application servers (EC2 instances, Lambda functions via VPC config, ECS tasks) can open connections on the Redis port (6379) or Memcached port (11211). ElastiCache does not support IAM-based authentication the way RDS does — access control at the data-plane level relies on Redis AUTH and network isolation.