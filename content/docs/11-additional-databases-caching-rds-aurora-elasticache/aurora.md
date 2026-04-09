---
title: "36. Aurora"
type: docs
weight: 2
---

## Aurora

Amazon Aurora is a cloud-native relational database engine built by AWS from the ground up to overcome the performance and availability limitations of traditional relational databases. It is fully compatible with MySQL and PostgreSQL, meaning your existing drivers, tools, and queries work without modification. Aurora solves a core problem: standard relational databases weren't designed with distributed cloud infrastructure in mind, so AWS re-architected the storage and replication layers entirely. The result is a managed database that delivers up to 5× the throughput of MySQL and 3× that of PostgreSQL, while offering durability and availability that would be complex and costly to achieve on your own. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)

### Shared Distributed Storage

The most fundamental difference between Aurora and standard RDS is how storage works. Rather than attaching storage to a single DB instance, Aurora uses a **shared distributed storage layer** that is completely decoupled from the compute layer.

Your data is automatically replicated **6 times across 3 Availability Zones** — 2 copies per AZ. This happens transparently and continuously. Aurora can tolerate the loss of 2 copies without impacting write availability, and the loss of 3 copies without impacting read availability. You don't configure replication — it's built in. Storage also auto-scales in 10 GiB increments up to 128 TiB, with no downtime. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html)

This architecture has a critical practical implication: **failover is much faster than RDS**. Because all replicas share the same underlying storage volume, a promoted replica doesn't need to replay logs or sync data — it simply starts serving reads and writes from the same volume the primary was using.

### Aurora Replicas and Auto-Failover

Aurora supports up to **15 read replicas** within the same cluster, all reading from the shared storage layer. Replication lag is typically in the single-digit milliseconds — far lower than the asynchronous replication used by RDS Read Replicas.

When the primary instance fails, Aurora automatically promotes one of the Aurora Replicas to be the new primary. You can assign a **failover priority tier** (0–15) to each replica to control which one is promoted first. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)

A concrete example: if you have a write-heavy application with a reporting dashboard, you point your application's write traffic to the primary and your reporting queries to a replica — both without managing any replication yourself.

### Cluster Endpoints

Aurora exposes multiple endpoint types to route traffic appropriately:

- **Writer endpoint** — Always points to the current primary instance. Even after a failover, the DNS record is updated automatically, so your application doesn't need to change its connection string.
- **Reader endpoint** — Load-balances read traffic across all available Aurora Replicas. If a replica is added or removed, the endpoint adjusts automatically.
- **Custom endpoints** — Let you define a subset of instances to target. Useful when you have replicas with different instance sizes (e.g., route heavy analytical queries to larger instances while lighter reads go elsewhere). [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html)

### Aurora Serverless v2

Aurora Serverless v2 removes the need to provision and manage DB instance sizes. The database scales compute capacity **instantly and granularly** in increments of 0.5 ACUs (Aurora Capacity Units), from a minimum you define up to 128 ACUs. Scaling happens in seconds, and you pay only for the capacity consumed per second. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)

This is ideal for workloads with unpredictable or spiky traffic — SaaS applications, development/test environments, or any use case where over-provisioning would be wasteful. Unlike v1, Serverless v2 supports Multi-AZ, read replicas, and Global Databases, making it suitable for production use.

### Global Databases

Aurora Global Databases allow a single Aurora cluster to span **multiple AWS regions**, with one primary region handling writes and up to 5 secondary read-only regions. Cross-region replication happens at the storage level with typical latency **under 1 second**. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)

The key use cases are:
- **Disaster recovery** — If an entire region goes down, you can promote a secondary region to become the new primary in under a minute.
- **Low-latency global reads** — Serve users in Europe from a European replica while writes still go to us-east-1.

### Aurora Multi-Master

In a standard Aurora cluster, only one instance handles writes at a time. Aurora Multi-Master changes this by allowing **multiple writer instances** within the same cluster, each capable of handling read and write traffic. If one writer fails, others continue without any failover delay. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-multi-master.html)

This is suited for applications that cannot tolerate even the brief interruption of a standard failover, and that can handle conflict resolution at the application layer (since concurrent writes to the same rows across writers will conflict).

### Backtrack

Aurora Backtrack lets you **rewind your database to a previous point in time** without restoring from a snapshot. Instead of spinning up a new cluster from a backup (which takes time), Backtrack rewinds the existing cluster in-place — typically in minutes. You define a backtrack window of up to 72 hours. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Managing.Backtrack.html)

This is especially useful for recovering from accidental data deletion or a bad migration without the overhead of a full restore. Note that Backtrack is currently supported for Aurora MySQL only.

### Aurora vs RDS

| Feature | Aurora | RDS |
|---|---|---|
| Storage replication | 6 copies, 3 AZs (automatic) | 1 primary + optional replicas |
| Read replicas | Up to 15, ~ms lag | Up to 5, seconds of lag |
| Failover time | Typically ~30 seconds | 1–2 minutes |
| Storage scaling | Automatic, up to 128 TiB | Manual or auto-scaling with limits |
| Serverless option | Yes (v2) | No |
| Cross-region reads | Global Databases (<1s lag) | Cross-region Read Replicas (higher lag) |
| Cost | Higher per-instance cost | Lower cost for small/predictable workloads |
| Engine compatibility | MySQL, PostgreSQL only | MySQL, PostgreSQL, MariaDB, Oracle, SQL Server |

**When to choose Aurora:** you need high availability, low replication lag, fast failover, or global distribution — and you're on MySQL or PostgreSQL. Aurora is the right default for production workloads at scale.

**When to choose standard RDS:** you need Oracle or SQL Server, you have a small/predictable workload where Aurora's cost premium isn't justified, or you have an existing RDS setup with no pressing reason to migrate.