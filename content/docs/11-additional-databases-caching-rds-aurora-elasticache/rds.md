---
title: "35. RDS"
type: docs
weight: 1
---

## RDS

Amazon Relational Database Service (RDS) is a managed service that runs relational databases in the cloud. The problem it solves is operational: running a production-grade relational database requires provisioning hardware, installing software, configuring backups, applying patches, and managing failover — none of which is differentiated work for most applications. RDS handles all of that, so you interact with a standard SQL database engine while AWS takes care of the infrastructure underneath. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)

### Supported Engines

RDS supports six database engines: **MySQL**, **PostgreSQL**, **MariaDB**, **Oracle**, **SQL Server**, and **Amazon Aurora** (covered separately in the next section). For the exam, you don't need deep engine-specific knowledge — focus on how RDS behaves as a managed platform, regardless of engine.

### Multi-AZ Deployments

Multi-AZ is RDS's high-availability mechanism. When enabled, AWS provisions a **standby replica** in a different Availability Zone and keeps it in sync via **synchronous replication** — every write to the primary is confirmed on the standby before being acknowledged to the application. If the primary fails (hardware issue, AZ outage, or a manual reboot with failover), RDS automatically updates the DNS endpoint to point to the standby. Failover typically completes in 60–120 seconds.

A few important exam points:
- The standby instance is **not accessible for reads** — it exists solely for failover. If you want to offload read traffic, use Read Replicas instead.
- Multi-AZ is about **availability**, not performance.
- Automated backups are taken from the standby, eliminating I/O impact on the primary.

[🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)

### Read Replicas

Read Replicas serve a different purpose: **scaling read-heavy workloads**. Replication here is **asynchronous**, meaning the replica may lag slightly behind the primary. You can create up to 5 Read Replicas per DB instance, and they can be in the same region, a different region (cross-region Read Replicas), or even promoted to standalone instances if needed.

Common use case: a reporting dashboard that runs expensive queries. Rather than hammering the production database, you point the dashboard at a Read Replica, keeping production performance unaffected.

Cross-region Read Replicas also serve as a foundation for disaster recovery — you can promote a replica in another region if the primary region becomes unavailable. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)

### Automated Backups and Snapshots

RDS provides two backup mechanisms:

- **Automated backups** are enabled by default and include daily full snapshots plus transaction logs, allowing **point-in-time recovery (PITR)** to any second within your retention window (1–35 days). Backups are stored in S3 and deleted when the retention period expires or the instance is deleted (unless you opt to retain them).
- **Manual snapshots** are user-initiated and persist until you explicitly delete them. They're useful before major schema changes or deployments.

[🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)

### RDS Storage

RDS uses EBS volumes for storage, and you choose the volume type at creation:

- **gp2** — General Purpose SSD; baseline 3 IOPS/GB, bursting up to 3,000 IOPS. Legacy choice.
- **gp3** — Newer generation; allows you to provision IOPS and throughput independently from storage size. More cost-effective than gp2 for most workloads.
- **io1** — Provisioned IOPS SSD; for I/O-intensive workloads requiring consistent high throughput (up to 64,000 IOPS).

RDS also supports **Storage Auto Scaling**, which automatically increases capacity when free space runs low, up to a maximum you define — useful for unpredictable growth without manual intervention. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.StorageTypes.html)

### RDS Proxy

Lambda functions are stateless and can scale to thousands of concurrent invocations rapidly. Each invocation opening its own database connection quickly exhausts the connection limit of most relational databases — this is the classic **connection exhaustion problem** in serverless architectures.

RDS Proxy sits between your application (or Lambda functions) and the RDS instance, maintaining a **pool of long-lived connections** to the database and multiplexing application requests across them. This dramatically reduces the number of actual database connections and improves resiliency during traffic spikes.

Additional benefits:
- Supports **IAM authentication**, so Lambda functions can authenticate to RDS using their execution role rather than embedding credentials.
- Automatic failover handling — the proxy holds connections during a Multi-AZ failover, reducing application-visible downtime.
- Works with MySQL and PostgreSQL engines (including Aurora).

[🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)

### Encryption

**At rest**: RDS supports encryption using **AWS KMS**. Encryption must be enabled at creation time — you cannot encrypt an existing unencrypted instance in place. The workaround is to take a snapshot, copy it with encryption enabled, and restore from the encrypted snapshot. All storage, backups, snapshots, and replicas of an encrypted instance are also encrypted.

**In transit**: RDS supports **SSL/TLS** for encrypting data between your application and the database endpoint. You can enforce SSL connections by setting the `rds.force_ssl` parameter (PostgreSQL) or the `require_secure_transport` parameter (MySQL).

[🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)

### IAM Authentication

Instead of using a static database username and password, RDS supports **IAM database authentication** for MySQL and PostgreSQL. With this enabled, an application generates a short-lived **authentication token** (valid for 15 minutes) using its IAM credentials and presents it in place of a password. The database validates the token against IAM.

This is particularly useful for Lambda and ECS workloads — the execution role can be granted `rds-db:connect` permission, and no database password needs to be stored or rotated. Combined with RDS Proxy, this pattern is the recommended approach for serverless-to-RDS connectivity. [🔗](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)