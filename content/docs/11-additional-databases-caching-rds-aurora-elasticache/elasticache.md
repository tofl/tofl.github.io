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

{{< qcm >}}
[
{
"question": "A company is building a real-time gaming leaderboard that must rank millions of players by score and return the top 100 players in the shortest possible time. Which ElastiCache engine and data structure should the developer use?",
"answers": [
{
"answer": "ElastiCache for Redis using Sorted Sets",
"isCorrect": true,
"explanation": "Redis Sorted Sets store members with an associated score and can return members ranked by score in O(log N) time, making them the canonical data structure for real-time leaderboards."
},
{
"answer": "ElastiCache for Memcached using Strings",
"isCorrect": false,
"explanation": "Memcached only supports Strings and has no native ranking or sorted data structure. It cannot efficiently maintain a leaderboard."
},
{
"answer": "ElastiCache for Redis using Pub/Sub",
"isCorrect": false,
"explanation": "Pub/Sub is a messaging pattern used for fan-out notifications, not for storing or ranking data. It is not suited for leaderboard use cases."
},
{
"answer": "ElastiCache for Redis using Lists",
"isCorrect": false,
"explanation": "Redis Lists maintain insertion order, not score-based order. Ranking players efficiently requires Sorted Sets, not Lists."
}
]
},
{
"question": "A developer is implementing a caching layer for a product catalogue. They want to ensure the cache only stores data that users actually request, accepting that the first request for any item will be slower. Which caching strategy should they use?",
"answers": [
{
"answer": "Lazy Loading (Cache-Aside)",
"isCorrect": true,
"explanation": "Lazy Loading only populates the cache on a cache miss, meaning only requested data is stored. The trade-off is a cold start penalty on the first request after a miss or after TTL expiry."
},
{
"answer": "Write-Through",
"isCorrect": false,
"explanation": "Write-Through populates the cache on every write, regardless of whether the data will ever be read, which wastes memory and does not match the requirement of caching only requested data."
},
{
"answer": "Session Store",
"isCorrect": false,
"explanation": "Session Store is a pattern for sharing user session data across stateless application instances, not a general-purpose caching read strategy."
}
]
},
{
"question": "An application uses Write-Through caching with ElastiCache. A developer notices that many cached items are never read after being written. What is the recommended way to address this memory waste?",
"answers": [
{
"answer": "Set a TTL on cached keys so unused entries expire automatically",
"isCorrect": true,
"explanation": "TTL (Time To Live) ensures that keys expire after a defined period, preventing unused data written by the Write-Through strategy from consuming memory indefinitely."
},
{
"answer": "Switch to the noeviction policy",
"isCorrect": false,
"explanation": "The noeviction policy returns an error when memory is full instead of removing data. This would make the memory problem worse, not better."
},
{
"answer": "Use Memcached instead of Redis to benefit from its multi-threaded architecture",
"isCorrect": false,
"explanation": "The threading model does not affect how unused cached items consume memory. Switching engines does not solve the stale/unused data problem."
},
{
"answer": "Enable Redis AOF persistence so data survives restarts",
"isCorrect": false,
"explanation": "AOF persistence is about durability across restarts, not about evicting or expiring unused cached entries."
}
]
},
{
"question": "A stateless web application runs on multiple EC2 instances behind an Application Load Balancer. Users are randomly routed to different instances on each request. What is the recommended approach to manage user sessions?",
"answers": [
{
"answer": "Store session data in ElastiCache for Redis so all instances can access the same session state",
"isCorrect": true,
"explanation": "Storing sessions in Redis gives every application instance access to shared session data with sub-millisecond reads, which is the standard solution for stateless architectures behind a load balancer."
},
{
"answer": "Store session data in each EC2 instance's local memory",
"isCorrect": false,
"explanation": "Local memory is not shared across instances. If the load balancer routes a user to a different instance, the session data will not be found, breaking the user experience."
},
{
"answer": "Enable sticky sessions on the load balancer and store sessions locally",
"isCorrect": false,
"explanation": "Sticky sessions are a workaround but reduce availability and scalability. ElastiCache is the proper, scalable solution recommended for distributed session management."
},
{
"answer": "Store session data in ElastiCache for Memcached with replication enabled",
"isCorrect": false,
"explanation": "Memcached does not support replication. If a Memcached node fails, all sessions stored on it are lost. Redis with replication is a more resilient choice for session storage."
}
]
},
{
"question": "Which of the following are valid reasons to choose ElastiCache for Redis over ElastiCache for Memcached? (Select TWO)",
"answers": [
{
"answer": "You need Multi-AZ replication with automatic failover",
"isCorrect": true,
"explanation": "Redis supports primary + replica configurations across Availability Zones with automatic failover, making it suitable for high-availability workloads. Memcached does not support replication."
},
{
"answer": "You need the simplest possible horizontal scale-out with no persistence requirement",
"isCorrect": false,
"explanation": "This describes a Memcached use case. Memcached is designed for pure, stateless object caching with simple horizontal scaling."
},
{
"answer": "You need to use Pub/Sub messaging to fan out notifications to multiple subscribers",
"isCorrect": true,
"explanation": "Redis supports a publish/subscribe messaging pattern natively. Memcached has no Pub/Sub capability."
},
{
"answer": "You need a multi-threaded caching engine to maximize CPU utilization across cores",
"isCorrect": false,
"explanation": "Memcached is multi-threaded, not Redis. Redis is mostly single-threaded. If raw multi-threaded performance across cores is the goal, Memcached has the advantage."
}
]
},
{
"question": "A developer wants to ensure that when ElastiCache memory is full, only keys that already have a TTL set are eligible for eviction, and those are evicted using a Least Recently Used policy. Which eviction policy should they configure?",
"answers": [
{
"answer": "volatile-lru",
"isCorrect": true,
"explanation": "volatile-lru applies LRU eviction exclusively to keys that have a TTL set, leaving keys without a TTL untouched when memory pressure occurs."
},
{
"answer": "allkeys-lru",
"isCorrect": false,
"explanation": "allkeys-lru applies LRU eviction across all keys regardless of whether they have a TTL. Keys without a TTL can also be evicted."
},
{
"answer": "noeviction",
"isCorrect": false,
"explanation": "noeviction returns an error when memory is full instead of removing any keys. No eviction takes place at all."
},
{
"answer": "allkeys-lfu",
"isCorrect": false,
"explanation": "allkeys-lfu evicts the least frequently used key across all keys, not just those with a TTL, and uses a frequency-based policy rather than recency-based."
}
]
},
{
"question": "An application stores critical session data in ElastiCache for Redis. The operations team wants to ensure that no session data is ever silently evicted when memory is full — they prefer an explicit error over data loss. Which eviction policy should be configured?",
"answers": [
{
"answer": "noeviction",
"isCorrect": true,
"explanation": "noeviction causes Redis to return an error to the client when memory is full instead of evicting any keys. This is appropriate when silent data loss (such as evicting sessions) is unacceptable."
},
{
"answer": "allkeys-lru",
"isCorrect": false,
"explanation": "allkeys-lru would silently evict least recently used keys, including session data, when memory is full. This is the opposite of the desired behaviour."
},
{
"answer": "volatile-lru",
"isCorrect": false,
"explanation": "volatile-lru evicts keys with TTLs using LRU. If sessions carry TTLs, they could be evicted — still resulting in data loss."
},
{
"answer": "allkeys-lfu",
"isCorrect": false,
"explanation": "allkeys-lfu silently evicts the least frequently used keys, which could include active session data."
}
]
},
{
"question": "A developer is designing a caching strategy for a high-write application where read latency must be minimized and stale data must never be served. Which caching strategy best fits these requirements?",
"answers": [
{
"answer": "Write-Through",
"isCorrect": true,
"explanation": "Write-Through updates the cache on every database write, ensuring the cache always holds fresh data. This eliminates stale reads at the cost of paying two write operations per update."
},
{
"answer": "Lazy Loading",
"isCorrect": false,
"explanation": "Lazy Loading is susceptible to stale data: if the database is updated, the cache retains the old value until the TTL expires or the key is explicitly invalidated."
},
{
"answer": "Session Store",
"isCorrect": false,
"explanation": "Session Store is a pattern for managing user session state across stateless instances, not a general strategy for keeping cached application data fresh."
}
]
},
{
"question": "Which of the following statements about ElastiCache for Redis persistence are correct? (Select TWO)",
"answers": [
{
"answer": "Redis can persist data using RDB snapshots or an Append-Only File (AOF)",
"isCorrect": true,
"explanation": "Redis supports two persistence mechanisms: RDB (point-in-time snapshots) and AOF (a log of every write operation), both of which allow data to survive a node restart."
},
{
"answer": "Memcached also supports optional persistence via RDB snapshots",
"isCorrect": false,
"explanation": "Memcached has no persistence capability at all. Data is lost when a node restarts or fails."
},
{
"answer": "Redis persistence means the cache can survive a node restart without losing all data",
"isCorrect": true,
"explanation": "Because Redis can write data to disk via RDB or AOF, it can reload that data after a restart, unlike Memcached which is entirely in-memory with no persistence."
},
{
"answer": "Enabling AOF on Redis requires switching to a Memcached-compatible cluster mode",
"isCorrect": false,
"explanation": "AOF is a Redis-specific feature and has nothing to do with Memcached. There is no such compatibility requirement."
}
]
},
{
"question": "A developer needs to authenticate clients connecting to an ElastiCache for Redis cluster as a second layer of security beyond network controls. Which feature should they enable?",
"answers": [
{
"answer": "Redis AUTH",
"isCorrect": true,
"explanation": "Redis AUTH requires clients to send a password token at the Redis protocol level before issuing any commands. It acts as an application-level authentication layer on top of network isolation."
},
{
"answer": "IAM database authentication",
"isCorrect": false,
"explanation": "ElastiCache does not support IAM-based authentication at the data plane level. IAM-based authentication is an RDS feature, not an ElastiCache one."
},
{
"answer": "Security group rules on port 6379",
"isCorrect": false,
"explanation": "Security groups provide network-level access control but do not authenticate individual clients at the Redis protocol level. Redis AUTH is an additional layer on top of this."
},
{
"answer": "KMS encryption at rest",
"isCorrect": false,
"explanation": "KMS encryption at rest protects data stored on disk from unauthorized physical access but does not authenticate clients connecting to the cluster."
}
]
},
{
"question": "Which of the following correctly describes the network security model for ElastiCache clusters?",
"answers": [
{
"answer": "ElastiCache clusters should be placed in a private subnet within a VPC, with security groups controlling which resources can connect on the Redis or Memcached port",
"isCorrect": true,
"explanation": "VPC isolation in a private subnet with security group rules is the primary network defence for ElastiCache. Access is restricted to authorized application servers (EC2, Lambda via VPC config, ECS tasks) on port 6379 (Redis) or 11211 (Memcached)."
},
{
"answer": "ElastiCache supports IAM-based data-plane authentication, similar to RDS IAM authentication",
"isCorrect": false,
"explanation": "ElastiCache does not support IAM authentication at the data plane. Access control relies on Redis AUTH and network-level controls, not IAM policies."
},
{
"answer": "ElastiCache clusters can be safely deployed with a public IP address as long as TLS is enabled",
"isCorrect": false,
"explanation": "Public access is strongly discouraged regardless of TLS. The cluster should reside in a private subnet with no public endpoint to minimise the attack surface."
},
{
"answer": "Memcached clusters support replication across Availability Zones for high availability",
"isCorrect": false,
"explanation": "Memcached does not support replication or Multi-AZ. Only Redis supports primary/replica topologies with automatic failover."
}
]
},
{
"question": "A multi-AZ Redis cluster in ElastiCache has one primary node and two read replicas. If the primary node fails, what happens?",
"answers": [
{
"answer": "ElastiCache automatically promotes the replica with the least replication lag to become the new primary, typically within 60 seconds",
"isCorrect": true,
"explanation": "With Multi-AZ and Auto-Failover enabled, ElastiCache detects the primary failure and promotes the most up-to-date replica automatically, restoring write availability without manual intervention."
},
{
"answer": "The cluster becomes read-only until an operator manually promotes a replica",
"isCorrect": false,
"explanation": "Manual promotion is not required when Auto-Failover is enabled. ElastiCache handles promotion automatically."
},
{
"answer": "All data is lost because Redis does not support replication",
"isCorrect": false,
"explanation": "Redis fully supports replication. Data written to the primary is replicated to the replicas, so a primary failure does not cause data loss when replicas are in sync."
},
{
"answer": "Memcached takes over as the failover engine",
"isCorrect": false,
"explanation": "Memcached and Redis are separate, independent engines. One cannot act as a failover for the other."
}
]
},
{
"question": "A developer is evaluating whether to use Redis Pub/Sub on ElastiCache to replace Amazon SQS for delivering critical order events between microservices. What is the most important consideration?",
"answers": [
{
"answer": "Redis Pub/Sub does not provide message durability — if no subscriber is listening when a message is published, the message is lost",
"isCorrect": true,
"explanation": "Redis Pub/Sub is a lightweight, fire-and-forget pattern. Messages are not persisted or queued. For durable, reliable event delivery between microservices, SQS or SNS is the appropriate choice."
},
{
"answer": "Redis Pub/Sub is a drop-in replacement for SQS and provides the same delivery guarantees",
"isCorrect": false,
"explanation": "Redis Pub/Sub offers no durability, no message retention, and no at-least-once delivery. It cannot replace SQS for scenarios that require guaranteed delivery."
},
{
"answer": "Redis Pub/Sub requires IAM policies to authorize publishers and subscribers",
"isCorrect": false,
"explanation": "Redis Pub/Sub uses the Redis AUTH token and network controls for access, not IAM policies."
},
{
"answer": "Redis Pub/Sub only works with ElastiCache for Memcached",
"isCorrect": false,
"explanation": "Pub/Sub is a Redis-specific feature. Memcached does not support Pub/Sub."
}
]
},
{
"question": "Which of the following are TRUE when comparing ElastiCache for Redis and ElastiCache for Memcached? (Select TWO)",
"answers": [
{
"answer": "Memcached uses a multi-threaded architecture, making it better at utilizing multiple CPU cores",
"isCorrect": true,
"explanation": "Memcached is natively multi-threaded, allowing it to take full advantage of multi-core servers. Redis is mostly single-threaded."
},
{
"answer": "Both Redis and Memcached support optional data persistence via RDB snapshots",
"isCorrect": false,
"explanation": "Only Redis supports persistence (RDB and AOF). Memcached is entirely in-memory with no persistence option."
},
{
"answer": "Redis supports clustering (sharding) via Redis Cluster mode, and Memcached also supports horizontal sharding natively",
"isCorrect": true,
"explanation": "Both engines support sharding/clustering. Redis uses Redis Cluster mode; Memcached has built-in horizontal sharding support."
},
{
"answer": "Memcached supports automatic Multi-AZ failover when a primary node fails",
"isCorrect": false,
"explanation": "Memcached has no replication or Multi-AZ failover. Only Redis supports these high-availability features."
}
]
},
{
"question": "How does ElastiCache reduce latency and cost compared to querying a relational database directly?",
"answers": [
{
"answer": "It stores frequently accessed data in-memory, serving reads in microseconds instead of the milliseconds required by a disk-backed database",
"isCorrect": true,
"explanation": "ElastiCache is an in-memory data store. In-memory access is orders of magnitude faster than reading from disk-backed databases like RDS, and it offloads repetitive read workloads from the database."
},
{
"answer": "It compresses database query results and writes them to S3 for fast retrieval",
"isCorrect": false,
"explanation": "ElastiCache stores data in RAM, not in S3. S3 is an object store and would not provide sub-millisecond read latency."
},
{
"answer": "It caches SQL queries inside the RDS engine and returns them before they reach ElastiCache",
"isCorrect": false,
"explanation": "ElastiCache is a separate service that sits in front of the database. It does not interact with or cache inside the RDS query engine."
},
{
"answer": "It uses read replicas within the database engine to distribute query load",
"isCorrect": false,
"explanation": "Read replicas are an RDS/Aurora concept. ElastiCache achieves latency reduction by serving data from memory, entirely avoiding database round-trips for cached results."
}
]
}
]
{{< /qcm >}}