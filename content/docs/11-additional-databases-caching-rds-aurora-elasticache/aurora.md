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

{{< qcm >}}
[
{
"question": "A company runs a MySQL-compatible database on Amazon Aurora. The primary instance unexpectedly fails. Which statement BEST describes what happens during the failover process?",
"answers": [
{
"answer": "Aurora promotes a read replica to primary; the replica must first replay transaction logs before serving writes.",
"isCorrect": false,
"explanation": "This describes standard RDS failover behavior. Aurora replicas share the same underlying storage volume as the primary, so no log replay is needed."
},
{
"answer": "Aurora promotes a read replica to primary; because all replicas share the same storage volume, the new primary can immediately serve reads and writes.",
"isCorrect": true,
"explanation": "Aurora's shared distributed storage layer means a promoted replica already has access to the exact same data. No data sync is required, which is why Aurora failover typically completes in ~30 seconds versus 1–2 minutes for standard RDS."
},
{
"answer": "Aurora automatically launches a new DB instance from the latest snapshot and restores it as the new primary.",
"isCorrect": false,
"explanation": "Restoring from a snapshot is not part of Aurora's automatic failover. Aurora promotes an existing replica instantly thanks to its shared storage architecture."
},
{
"answer": "The writer endpoint becomes unavailable until a manual failover is triggered by the database administrator.",
"isCorrect": false,
"explanation": "Aurora failover is fully automatic. The writer endpoint DNS record is updated to point to the newly promoted primary without any manual intervention."
}
]
},
{
"question": "How many times is data replicated across how many Availability Zones in an Aurora cluster?",
"answers": [
{
"answer": "3 copies across 3 Availability Zones (1 copy per AZ).",
"isCorrect": false,
"explanation": "Aurora replicates data 6 times, not 3. There are 2 copies per AZ across 3 AZs."
},
{
"answer": "6 copies across 3 Availability Zones (2 copies per AZ).",
"isCorrect": true,
"explanation": "Aurora automatically maintains 6 copies of your data across 3 AZs. This built-in replication is transparent to the user and allows Aurora to tolerate the loss of 2 copies without impacting writes and 3 copies without impacting reads."
},
{
"answer": "6 copies across 6 Availability Zones (1 copy per AZ).",
"isCorrect": false,
"explanation": "Aurora uses 3 AZs, not 6, and stores 2 copies per AZ for a total of 6 copies."
},
{
"answer": "2 copies across 2 Availability Zones, with a standby in a third AZ.",
"isCorrect": false,
"explanation": "This more closely describes standard RDS Multi-AZ. Aurora uses 6 copies spread across 3 AZs."
}
]
},
{
"question": "An Aurora cluster has 4 read replicas. The primary instance fails. Which mechanism determines which replica is promoted to the new primary?",
"answers": [
{
"answer": "Aurora always promotes the replica with the lowest replication lag.",
"isCorrect": false,
"explanation": "Since all Aurora replicas share the same storage volume, replication lag is not a differentiating factor. Aurora uses failover priority tiers to determine promotion order."
},
{
"answer": "The failover priority tier (0–15) assigned to each replica — the replica with the lowest tier number is promoted first.",
"isCorrect": true,
"explanation": "You can assign a priority tier from 0 to 15 to each Aurora Replica. Aurora promotes the replica with the lowest tier number first. If tiers are equal, Aurora picks based on size and other factors."
},
{
"answer": "Aurora promotes the replica that was created first (oldest replica).",
"isCorrect": false,
"explanation": "Creation order is not the failover selection criterion. Failover priority tiers (0–15) assigned by the administrator control which replica is promoted."
},
{
"answer": "Promotion is random among all available replicas.",
"isCorrect": false,
"explanation": "Failover in Aurora is deterministic based on the priority tier you assign to each replica, not random."
}
]
},
{
"question": "A developer is building a web application backed by an Aurora cluster with multiple read replicas. They want read traffic to be automatically distributed across all available replicas without changing the application connection string when replicas are added or removed. Which endpoint type should they use?",
"answers": [
{
"answer": "Writer endpoint",
"isCorrect": false,
"explanation": "The writer endpoint always points to the current primary instance and is intended for write traffic, not load-balanced reads."
},
{
"answer": "Reader endpoint",
"isCorrect": true,
"explanation": "The reader endpoint load-balances connections across all available Aurora Replicas and automatically adjusts when replicas are added or removed, requiring no connection string changes in the application."
},
{
"answer": "Custom endpoint",
"isCorrect": false,
"explanation": "Custom endpoints target a defined subset of instances, which is useful for routing specific workloads (e.g., analytical queries to larger instances) but requires manual configuration of which instances belong to the subset."
},
{
"answer": "Instance endpoint",
"isCorrect": false,
"explanation": "Instance endpoints connect directly to a specific DB instance and do not provide automatic load balancing or adjust when the cluster topology changes."
}
]
},
{
"question": "A company has an Aurora cluster with replicas of different instance sizes. They want to route heavy analytical queries to the largest instances while sending lighter OLTP reads elsewhere. Which Aurora feature enables this routing strategy?",
"answers": [
{
"answer": "Reader endpoint with weighted routing",
"isCorrect": false,
"explanation": "The standard reader endpoint load-balances across all replicas but does not support routing based on query type or instance size."
},
{
"answer": "Custom endpoints",
"isCorrect": true,
"explanation": "Custom endpoints allow you to define a subset of Aurora instances to target. You can create one custom endpoint pointing to large instances for analytical workloads and another for lighter reads, giving you fine-grained traffic control."
},
{
"answer": "Aurora Multi-Master",
"isCorrect": false,
"explanation": "Aurora Multi-Master enables multiple writer instances for high write availability. It does not address routing read queries to specific instance sizes."
},
{
"answer": "Writer endpoint with read-after-write consistency",
"isCorrect": false,
"explanation": "The writer endpoint is for writes only. It does not route analytical queries to specific read replicas."
}
]
},
{
"question": "A SaaS startup is launching a new product with highly unpredictable traffic patterns. They want a database solution that scales compute automatically without over-provisioning and charges only for what is used. They are using PostgreSQL. Which Aurora option is MOST suitable?",
"answers": [
{
"answer": "Aurora with provisioned instances and Auto Scaling read replicas",
"isCorrect": false,
"explanation": "Auto Scaling read replicas helps with read traffic but still requires a provisioned primary instance, which means you must choose a fixed instance size and may over-provision."
},
{
"answer": "Aurora Serverless v2",
"isCorrect": true,
"explanation": "Aurora Serverless v2 scales compute instantly in 0.5 ACU increments, charges per second based on consumed capacity, and supports PostgreSQL. It is designed exactly for unpredictable or spiky workloads where over-provisioning would be wasteful."
},
{
"answer": "Aurora Serverless v1",
"isCorrect": false,
"explanation": "Aurora Serverless v1 also offers automatic scaling but has significant limitations: it does not support Multi-AZ, read replicas, or Global Databases, making it less suitable for production use compared to v2."
},
{
"answer": "Standard RDS PostgreSQL with storage Auto Scaling",
"isCorrect": false,
"explanation": "RDS storage auto-scaling handles disk growth but does not dynamically scale compute. You would still need to choose and pay for a fixed instance type regardless of actual load."
}
]
},
{
"question": "Which of the following statements about Aurora Serverless v2 are correct? (Select TWO)",
"answers": [
{
"answer": "It supports Multi-AZ deployments and read replicas.",
"isCorrect": true,
"explanation": "Unlike v1, Aurora Serverless v2 supports Multi-AZ, read replicas, and Global Databases, making it production-ready."
},
{
"answer": "It scales compute in increments of 0.5 ACUs up to a maximum of 128 ACUs.",
"isCorrect": true,
"explanation": "Aurora Serverless v2 scales granularly in 0.5 ACU increments between a user-defined minimum and a maximum of 128 ACUs, with scaling happening in seconds."
},
{
"answer": "It requires the database to pause and resume, causing cold start delays.",
"isCorrect": false,
"explanation": "Cold starts and pause/resume behavior are characteristics of Aurora Serverless v1, not v2. Serverless v2 scales instantly without pausing."
},
{
"answer": "It charges a flat hourly rate regardless of actual usage.",
"isCorrect": false,
"explanation": "Aurora Serverless v2 charges per second based on the actual ACU capacity consumed, not a flat hourly rate."
}
]
},
{
"question": "A global e-commerce company has its primary Aurora cluster in us-east-1. They want to serve European customers with low-latency reads and be able to recover from a full regional outage within a minute. Which Aurora feature addresses BOTH requirements?",
"answers": [
{
"answer": "Aurora Read Replicas in eu-west-1",
"isCorrect": false,
"explanation": "Standard cross-region read replicas can serve local reads but have higher replication lag than Global Databases and do not offer sub-minute regional failover capabilities."
},
{
"answer": "Aurora Global Database",
"isCorrect": true,
"explanation": "Aurora Global Database spans multiple AWS regions with cross-region replication latency under 1 second. It supports up to 5 secondary read-only regions for low-latency reads, and a secondary region can be promoted to primary in under a minute for disaster recovery."
},
{
"answer": "Aurora Multi-Master spanning multiple regions",
"isCorrect": false,
"explanation": "Aurora Multi-Master supports multiple writer instances but operates within a single region. It does not provide cross-region replication or disaster recovery across regions."
},
{
"answer": "Aurora Serverless v2 with a Global Database",
"isCorrect": false,
"explanation": "While Aurora Serverless v2 does support Global Databases, selecting just 'Aurora Global Database' is the precise and sufficient answer. The serverless aspect is unrelated to the global distribution requirement described."
}
]
},
{
"question": "What is the typical cross-region replication latency for an Aurora Global Database?",
"answers": [
{
"answer": "Under 1 second",
"isCorrect": true,
"explanation": "Aurora Global Database replicates data at the storage level, achieving typical cross-region latency of under 1 second, which is significantly lower than standard cross-region RDS Read Replicas."
},
{
"answer": "1–5 seconds",
"isCorrect": false,
"explanation": "This is closer to the latency of standard cross-region RDS Read Replicas. Aurora Global Database achieves sub-second replication."
},
{
"answer": "Single-digit milliseconds",
"isCorrect": false,
"explanation": "Single-digit millisecond lag describes replication between Aurora Replicas within the same cluster and region, not cross-region Global Database replication."
},
{
"answer": "It depends on the distance between regions and can be several minutes.",
"isCorrect": false,
"explanation": "Aurora Global Database replication happens at the storage layer and is engineered for consistency under 1 second regardless of inter-region distance."
}
]
},
{
"question": "An application requires continuous write availability even if a single writer instance fails, with absolutely no failover interruption. Which Aurora feature should be used?",
"answers": [
{
"answer": "Aurora Global Database",
"isCorrect": false,
"explanation": "Aurora Global Database provides cross-region disaster recovery and low-latency global reads, but only one region handles writes at a time. Promoting a secondary region takes under a minute — not zero downtime."
},
{
"answer": "Aurora with 15 read replicas and priority tiers",
"isCorrect": false,
"explanation": "Priority tiers speed up replica promotion, but a standard Aurora cluster still undergoes a brief failover period (~30 seconds) when the primary fails. This does not eliminate the failover interruption."
},
{
"answer": "Aurora Multi-Master",
"isCorrect": true,
"explanation": "Aurora Multi-Master allows multiple writer instances within the same cluster. If one writer fails, the other writers continue handling traffic immediately with no failover delay. This is designed for applications that cannot tolerate any write interruption."
},
{
"answer": "Aurora Serverless v2",
"isCorrect": false,
"explanation": "Aurora Serverless v2 automatically scales compute but still operates with a primary writer. It does not inherently eliminate write-path failover interruptions."
}
]
},
{
"question": "A developer accidentally deleted a large batch of records from an Aurora MySQL table 30 minutes ago. The team wants to recover the data as quickly as possible without provisioning a new cluster. Which Aurora feature is MOST appropriate?",
"answers": [
{
"answer": "Restore from the latest automated snapshot to a new cluster.",
"isCorrect": false,
"explanation": "Restoring from a snapshot creates a new cluster and takes significant time. The question specifically asks for recovery without provisioning a new cluster and as quickly as possible."
},
{
"answer": "Aurora Backtrack",
"isCorrect": true,
"explanation": "Aurora Backtrack rewinds the existing cluster in-place to a point in time within the backtrack window (up to 72 hours), typically completing in minutes. No new cluster is needed. Note: Backtrack is supported on Aurora MySQL only."
},
{
"answer": "Aurora Point-in-Time Restore to an existing cluster.",
"isCorrect": false,
"explanation": "Point-in-Time Restore always creates a new DB cluster; it cannot restore data in-place to an existing cluster."
},
{
"answer": "Promote an Aurora Read Replica and query the replica's data.",
"isCorrect": false,
"explanation": "All Aurora replicas share the same storage volume as the primary. The deletion would already be reflected on all replicas — promoting one would not recover the deleted data."
}
]
},
{
"question": "Which database engines are supported by Amazon Aurora? (Select TWO)",
"answers": [
{
"answer": "MySQL",
"isCorrect": true,
"explanation": "Aurora is fully compatible with MySQL, meaning existing MySQL drivers, tools, and queries work without modification."
},
{
"answer": "PostgreSQL",
"isCorrect": true,
"explanation": "Aurora is fully compatible with PostgreSQL, providing the same compatibility guarantee as with MySQL."
},
{
"answer": "Oracle",
"isCorrect": false,
"explanation": "Oracle is supported by Amazon RDS but not by Aurora. Aurora supports only MySQL and PostgreSQL-compatible engines."
},
{
"answer": "Microsoft SQL Server",
"isCorrect": false,
"explanation": "SQL Server is available on Amazon RDS but not Aurora. Aurora is limited to MySQL and PostgreSQL compatibility."
},
{
"answer": "MariaDB",
"isCorrect": false,
"explanation": "MariaDB is supported as an RDS engine but not as a native Aurora engine. Aurora supports MySQL and PostgreSQL only."
}
]
},
{
"question": "What is the maximum number of read replicas supported within a single Aurora cluster?",
"answers": [
{
"answer": "5",
"isCorrect": false,
"explanation": "5 read replicas is the limit for standard RDS, not Aurora. Aurora supports significantly more replicas."
},
{
"answer": "15",
"isCorrect": true,
"explanation": "An Aurora cluster supports up to 15 read replicas. All replicas read from the shared storage layer, with replication lag typically in the single-digit milliseconds."
},
{
"answer": "10",
"isCorrect": false,
"explanation": "10 is not the Aurora limit. Aurora supports up to 15 read replicas within a single cluster."
},
{
"answer": "Unlimited",
"isCorrect": false,
"explanation": "Aurora has a defined limit of 15 read replicas per cluster, not an unlimited number."
}
]
},
{
"question": "A company's application uses an Aurora cluster. After a failover event, the operations team notices that the application had to be reconfigured to point to the new primary instance. What should have been implemented to avoid this?",
"answers": [
{
"answer": "The application should use the individual instance endpoint of each replica and implement retry logic.",
"isCorrect": false,
"explanation": "Using instance endpoints requires the application to be aware of cluster topology and update connection strings when the primary changes — exactly the problem to avoid."
},
{
"answer": "The application should use the Aurora writer endpoint.",
"isCorrect": true,
"explanation": "The writer endpoint always resolves to the current primary instance. After a failover, Aurora automatically updates the DNS record behind the writer endpoint, so the application connection string remains valid without any reconfiguration."
},
{
"answer": "The application should use the Aurora reader endpoint for all traffic.",
"isCorrect": false,
"explanation": "The reader endpoint is designed for read traffic distribution across replicas. Sending write traffic to the reader endpoint is incorrect and would cause errors."
},
{
"answer": "Enable Aurora Multi-Master so there is no primary failover.",
"isCorrect": false,
"explanation": "While Aurora Multi-Master eliminates write-path failover interruptions, it does not address the problem of an application hardcoding instance endpoints. The correct solution is to use the writer endpoint."
}
]
},
{
"question": "How does Aurora storage scale to accommodate growing data?",
"answers": [
{
"answer": "You must manually resize the storage volume during a maintenance window.",
"isCorrect": false,
"explanation": "Aurora storage scaling is automatic and requires no manual intervention or downtime. This describes a limitation of traditional RDS setups, not Aurora."
},
{
"answer": "Storage automatically grows in 10 GiB increments up to 128 TiB with no downtime.",
"isCorrect": true,
"explanation": "Aurora's shared distributed storage layer auto-scales transparently in 10 GiB increments as data grows, up to a maximum of 128 TiB, without any maintenance window or downtime."
},
{
"answer": "You provision a maximum storage size at cluster creation; Aurora cannot exceed it.",
"isCorrect": false,
"explanation": "Aurora does not require pre-provisioning a maximum storage size. It expands automatically as needed up to 128 TiB."
},
{
"answer": "Storage scales automatically but requires a cluster reboot to apply the new allocation.",
"isCorrect": false,
"explanation": "Aurora storage scaling is seamless and continuous, with no reboot or disruption required."
}
]
},
{
"question": "Which of the following scenarios is Aurora Backtrack NOT able to address?",
"answers": [
{
"answer": "Recovering from an accidental DROP TABLE executed 2 hours ago.",
"isCorrect": false,
"explanation": "Backtrack can rewind the cluster to a point before the DROP TABLE was executed (within the 72-hour window), making this a valid use case for Backtrack."
},
{
"answer": "Rewinding a database after a bad data migration to restore the pre-migration state.",
"isCorrect": false,
"explanation": "Backtrack is ideal for undoing a bad migration quickly in-place, as long as the event occurred within the backtrack window."
},
{
"answer": "Recovering an Aurora PostgreSQL cluster from accidental data deletion.",
"isCorrect": true,
"explanation": "Aurora Backtrack is currently supported for Aurora MySQL only. It is not available for Aurora PostgreSQL clusters. For PostgreSQL, you would need to use Point-in-Time Restore."
},
{
"answer": "Rewinding the cluster to a point 48 hours ago.",
"isCorrect": false,
"explanation": "The backtrack window supports up to 72 hours, so rewinding 48 hours is within the supported range."
}
]
},
{
"question": "A team is deciding between Amazon Aurora and Amazon RDS for a new workload running Microsoft SQL Server. Which option should they choose?",
"answers": [
{
"answer": "Aurora, because it offers better performance and availability than RDS.",
"isCorrect": false,
"explanation": "While Aurora generally offers superior performance and availability, it only supports MySQL and PostgreSQL. SQL Server is not a supported Aurora engine, so Aurora is not an option here."
},
{
"answer": "RDS, because Aurora does not support Microsoft SQL Server.",
"isCorrect": true,
"explanation": "Aurora supports only MySQL and PostgreSQL-compatible engines. Microsoft SQL Server is only available on Amazon RDS, making RDS the only valid choice for this workload."
},
{
"answer": "Aurora Serverless v2, which supports any relational engine including SQL Server.",
"isCorrect": false,
"explanation": "Aurora Serverless v2 is limited to Aurora MySQL and Aurora PostgreSQL. It does not support SQL Server or any other engine."
},
{
"answer": "Either Aurora or RDS; both support SQL Server with equivalent features.",
"isCorrect": false,
"explanation": "Aurora does not support SQL Server at all. Only RDS supports SQL Server, Oracle, MariaDB, MySQL, and PostgreSQL."
}
]
},
{
"question": "Which of the following are advantages of Aurora over standard RDS? (Select THREE)",
"answers": [
{
"answer": "Aurora supports up to 15 read replicas with single-digit millisecond replication lag, compared to RDS's 5 replicas with seconds of lag.",
"isCorrect": true,
"explanation": "Aurora's shared storage architecture enables up to 15 replicas with very low replication lag, whereas standard RDS supports only up to 5 read replicas with asynchronous replication that can introduce seconds of lag."
},
{
"answer": "Aurora failover typically completes in ~30 seconds versus 1–2 minutes for RDS.",
"isCorrect": true,
"explanation": "Because Aurora replicas share the same storage volume, promotion requires no data sync. This makes Aurora failover significantly faster than RDS failover."
},
{
"answer": "Aurora supports a wider range of database engines, including Oracle and SQL Server.",
"isCorrect": false,
"explanation": "It is RDS, not Aurora, that supports Oracle and SQL Server. Aurora is limited to MySQL and PostgreSQL."
},
{
"answer": "Aurora offers a Serverless v2 option that automatically scales compute, which is not available on RDS.",
"isCorrect": true,
"explanation": "Aurora Serverless v2 provides automatic, granular compute scaling. Standard RDS has no equivalent serverless compute option."
},
{
"answer": "Aurora is always cheaper than RDS for any workload size.",
"isCorrect": false,
"explanation": "Aurora has a higher per-instance cost than RDS. For small or predictable workloads, standard RDS may be more cost-effective. Cost depends on workload characteristics."
}
]
}
]
{{< /qcm >}}