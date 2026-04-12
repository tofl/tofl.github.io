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

{{< qcm >}}
[
{
"question": "A company runs a production RDS MySQL instance and wants to ensure high availability in case of an Availability Zone failure. They enable Multi-AZ. Which of the following statements about the standby instance are correct? (Select TWO)",
"answers": [
{
"answer": "The standby instance can be used to serve read traffic during normal operations.",
"isCorrect": false,
"explanation": "The standby instance in a Multi-AZ deployment is not accessible for reads. It exists solely for failover purposes. To offload reads, you need Read Replicas."
},
{
"answer": "Data is replicated from the primary to the standby synchronously.",
"isCorrect": true,
"explanation": "Multi-AZ uses synchronous replication — every write is confirmed on the standby before being acknowledged to the application, ensuring zero data loss on failover."
},
{
"answer": "Automated backups are taken from the standby instance, reducing I/O impact on the primary.",
"isCorrect": true,
"explanation": "RDS takes automated backups from the standby in a Multi-AZ setup, which eliminates I/O impact on the primary database during backup windows."
},
{
"answer": "Failover typically completes in under 10 seconds.",
"isCorrect": false,
"explanation": "Multi-AZ failover typically completes in 60–120 seconds, not under 10 seconds. During this time, RDS updates the DNS endpoint to point to the standby."
}
]
},
{
"question": "A development team has a reporting dashboard that runs expensive analytical queries. They are concerned these queries are degrading performance for application users hitting the production RDS PostgreSQL instance. What is the most appropriate solution?",
"answers": [
{
"answer": "Enable Multi-AZ and point the dashboard at the standby instance.",
"isCorrect": false,
"explanation": "The Multi-AZ standby instance is not accessible for reads — it is reserved exclusively for failover. It cannot be used to offload query traffic."
},
{
"answer": "Create a Read Replica and point the reporting dashboard at it.",
"isCorrect": true,
"explanation": "Read Replicas are designed exactly for this use case: scaling read-heavy workloads. The dashboard can query the replica without impacting production database performance."
},
{
"answer": "Enable Storage Auto Scaling on the primary instance.",
"isCorrect": false,
"explanation": "Storage Auto Scaling increases disk capacity automatically when space is low. It does not address query performance or read traffic distribution."
},
{
"answer": "Increase the instance size of the primary RDS instance.",
"isCorrect": false,
"explanation": "Scaling up the primary instance may help temporarily, but it does not isolate reporting workloads from production traffic. A Read Replica is the architecturally correct solution."
}
]
},
{
"question": "Which replication mode does RDS use for Read Replicas, and what is an important implication of this?",
"answers": [
{
"answer": "Synchronous replication; the replica always has up-to-date data.",
"isCorrect": false,
"explanation": "Synchronous replication is used by Multi-AZ deployments, not Read Replicas. Read Replicas use asynchronous replication."
},
{
"answer": "Asynchronous replication; the replica may lag slightly behind the primary.",
"isCorrect": true,
"explanation": "Read Replicas use asynchronous replication, which means there can be a small replication lag. Applications that require strongly consistent reads should not rely on Read Replicas."
},
{
"answer": "Asynchronous replication; the replica is always promoted automatically on primary failure.",
"isCorrect": false,
"explanation": "Read Replicas use asynchronous replication, but they are not automatically promoted on primary failure. Promotion to a standalone instance is a manual action."
}
]
},
{
"question": "A company needs the ability to restore their RDS database to any point in time within the last 30 days. Which backup feature should they use and configure?",
"answers": [
{
"answer": "Manual snapshots with a 30-day retention period.",
"isCorrect": false,
"explanation": "Manual snapshots capture a point-in-time state but do not capture transaction logs, so you cannot restore to any arbitrary second. Point-in-time recovery requires automated backups."
},
{
"answer": "Automated backups with a retention period set to 30 days.",
"isCorrect": true,
"explanation": "Automated backups include daily full snapshots plus transaction logs, enabling point-in-time recovery (PITR) to any second within the retention window (1–35 days). Setting the retention to 30 days satisfies this requirement."
},
{
"answer": "Enable Multi-AZ to keep a synchronized copy in another Availability Zone.",
"isCorrect": false,
"explanation": "Multi-AZ provides high availability through a standby replica, but it does not enable point-in-time recovery. Automated backups are required for PITR."
}
]
},
{
"question": "A developer wants to encrypt an existing unencrypted RDS instance. What is the correct approach?",
"answers": [
{
"answer": "Enable encryption directly on the running instance from the AWS console.",
"isCorrect": false,
"explanation": "You cannot enable encryption on an existing unencrypted RDS instance in place. Encryption must be enabled at creation time."
},
{
"answer": "Take a snapshot of the instance, copy the snapshot with encryption enabled, then restore from the encrypted snapshot.",
"isCorrect": true,
"explanation": "This is the documented workaround. Since encryption cannot be enabled on a live unencrypted instance, you snapshot it, copy the snapshot while enabling encryption, and restore from that encrypted snapshot."
},
{
"answer": "Create an encrypted Read Replica of the unencrypted instance.",
"isCorrect": false,
"explanation": "You cannot create an encrypted Read Replica from an unencrypted source instance. The source instance must itself be encrypted for replicas to be encrypted."
},
{
"answer": "Enable AWS KMS on the instance and restart it.",
"isCorrect": false,
"explanation": "There is no mechanism to attach KMS encryption to an existing unencrypted RDS instance via a restart. The snapshot-copy-restore workflow is required."
}
]
},
{
"question": "A Lambda function needs to connect to an RDS PostgreSQL database. The application is expected to scale to thousands of concurrent invocations. Which combination of features best addresses connection management and credential security? (Select TWO)",
"answers": [
{
"answer": "Use RDS Proxy to pool and multiplex database connections.",
"isCorrect": true,
"explanation": "RDS Proxy maintains a pool of long-lived connections to the database and multiplexes thousands of Lambda invocations across them, preventing connection exhaustion — a common problem in serverless architectures."
},
{
"answer": "Use IAM database authentication so Lambda can authenticate using its execution role without storing credentials.",
"isCorrect": true,
"explanation": "IAM authentication allows Lambda's execution role (granted rds-db:connect) to generate short-lived tokens instead of using static passwords. This eliminates credential storage and rotation concerns."
},
{
"answer": "Enable Multi-AZ to handle the increased number of Lambda connections.",
"isCorrect": false,
"explanation": "Multi-AZ improves availability but does not address connection pooling or the connection exhaustion problem caused by many concurrent Lambda invocations."
},
{
"answer": "Store database credentials in environment variables of the Lambda function.",
"isCorrect": false,
"explanation": "Storing credentials in environment variables is a security anti-pattern. IAM database authentication with RDS Proxy is the recommended approach for serverless-to-RDS connectivity."
}
]
},
{
"question": "What is the validity period of an IAM authentication token used for RDS IAM database authentication?",
"answers": [
{
"answer": "1 hour",
"isCorrect": false,
"explanation": "IAM authentication tokens for RDS are valid for 15 minutes, not 1 hour."
},
{
"answer": "15 minutes",
"isCorrect": true,
"explanation": "RDS IAM authentication tokens are short-lived and valid for 15 minutes. They are generated using the application's IAM credentials and presented in place of a database password."
},
{
"answer": "24 hours",
"isCorrect": false,
"explanation": "RDS IAM tokens are short-lived (15 minutes) by design to minimize the risk of token compromise."
},
{
"answer": "Until the IAM role's session expires",
"isCorrect": false,
"explanation": "The token validity is fixed at 15 minutes regardless of the underlying IAM session duration."
}
]
},
{
"question": "Which RDS storage type should be chosen for an I/O-intensive OLTP workload that requires consistent high throughput and up to 64,000 IOPS?",
"answers": [
{
"answer": "gp2",
"isCorrect": false,
"explanation": "gp2 provides a baseline of 3 IOPS/GB and can burst up to 3,000 IOPS. It is not suitable for workloads that consistently require very high IOPS."
},
{
"answer": "gp3",
"isCorrect": false,
"explanation": "gp3 is cost-effective and allows independent IOPS and throughput provisioning, but it is best suited for general-purpose workloads, not those requiring up to 64,000 IOPS consistently."
},
{
"answer": "io1",
"isCorrect": true,
"explanation": "io1 (Provisioned IOPS SSD) is designed for I/O-intensive workloads requiring consistent high throughput, supporting up to 64,000 IOPS. It is the correct choice for demanding OLTP databases."
},
{
"answer": "Magnetic (standard)",
"isCorrect": false,
"explanation": "Magnetic storage is a legacy option not recommended for production OLTP workloads. It does not offer the performance characteristics required here."
}
]
},
{
"question": "A company stores sensitive data in an encrypted RDS instance. Which of the following are true about encryption for this instance? (Select TWO)",
"answers": [
{
"answer": "All snapshots and Read Replicas of the encrypted instance are also encrypted.",
"isCorrect": true,
"explanation": "When an RDS instance is encrypted, encryption extends to all associated storage, automated backups, snapshots, and Read Replicas automatically."
},
{
"answer": "Encryption is managed by AWS KMS.",
"isCorrect": true,
"explanation": "RDS at-rest encryption uses AWS KMS keys. You can use the default AWS-managed key or a customer-managed KMS key."
},
{
"answer": "Encryption can be enabled or disabled at any time after instance creation.",
"isCorrect": false,
"explanation": "Encryption must be enabled at creation time. You cannot enable or disable encryption on an existing instance in place — the snapshot-copy-restore workaround is required."
},
{
"answer": "Read Replicas of an encrypted instance can optionally be left unencrypted.",
"isCorrect": false,
"explanation": "Read Replicas of an encrypted RDS instance are always encrypted. There is no option to create an unencrypted replica from an encrypted source."
}
]
},
{
"question": "An application team wants to enforce SSL/TLS connections to their RDS MySQL instance so that no unencrypted connections are allowed. Which parameter should they configure?",
"answers": [
{
"answer": "rds.force_ssl",
"isCorrect": false,
"explanation": "rds.force_ssl is the parameter used to enforce SSL for PostgreSQL, not MySQL."
},
{
"answer": "require_secure_transport",
"isCorrect": true,
"explanation": "For MySQL on RDS, setting the require_secure_transport parameter enforces SSL/TLS, rejecting any connection that does not use encryption."
},
{
"answer": "ssl_mode=REQUIRED",
"isCorrect": false,
"explanation": "ssl_mode is a client-side connection string option, not a server-side RDS parameter for enforcing SSL on all connections."
},
{
"answer": "enable_ssl",
"isCorrect": false,
"explanation": "There is no RDS parameter called enable_ssl. The correct MySQL parameter is require_secure_transport."
}
]
},
{
"question": "Which of the following is a benefit of RDS Proxy beyond connection pooling? (Select TWO)",
"answers": [
{
"answer": "RDS Proxy can hold connections during a Multi-AZ failover, reducing application-visible downtime.",
"isCorrect": true,
"explanation": "During a Multi-AZ failover, RDS Proxy maintains connections and handles the transition, significantly reducing the downtime experienced by the application compared to connecting directly to the RDS endpoint."
},
{
"answer": "RDS Proxy supports IAM authentication, allowing Lambda functions to authenticate using their execution role.",
"isCorrect": true,
"explanation": "RDS Proxy integrates with IAM authentication, enabling serverless functions to use their execution role for database authentication instead of storing credentials."
},
{
"answer": "RDS Proxy automatically scales the RDS instance compute when CPU utilization is high.",
"isCorrect": false,
"explanation": "RDS Proxy manages connections between the application and the database but does not auto-scale the underlying RDS instance compute resources."
},
{
"answer": "RDS Proxy enables cross-region replication of database writes.",
"isCorrect": false,
"explanation": "Cross-region replication is handled by cross-region Read Replicas, not RDS Proxy. RDS Proxy is focused on connection management and failover handling."
}
]
},
{
"question": "A team needs to perform a major schema migration on their RDS instance and wants to be able to roll back quickly if something goes wrong. Which backup approach is most appropriate?",
"answers": [
{
"answer": "Rely on the automated backup taken the previous night.",
"isCorrect": false,
"explanation": "An automated backup from the previous night may not capture the exact pre-migration state and would require a PITR restore. A manual snapshot taken immediately before the migration is a more reliable and explicit rollback point."
},
{
"answer": "Take a manual snapshot immediately before the migration.",
"isCorrect": true,
"explanation": "Manual snapshots persist until explicitly deleted and capture the exact state of the database at that moment. This is the recommended practice before major changes, providing a clean restore point."
},
{
"answer": "Enable Storage Auto Scaling before the migration.",
"isCorrect": false,
"explanation": "Storage Auto Scaling manages disk capacity growth automatically but has no bearing on backup or rollback capabilities."
},
{
"answer": "Create a Read Replica and promote it before the migration.",
"isCorrect": false,
"explanation": "Promoting a Read Replica creates a standalone instance, which doesn't serve as a snapshot-based rollback mechanism and incurs additional cost and complexity unnecessarily."
}
]
},
{
"question": "A company uses RDS and anticipates unpredictable database growth over time. They want to avoid manual storage management. Which feature addresses this requirement?",
"answers": [
{
"answer": "Multi-AZ deployment",
"isCorrect": false,
"explanation": "Multi-AZ improves availability by maintaining a standby replica in a different AZ. It does not manage or automatically expand storage capacity."
},
{
"answer": "RDS Storage Auto Scaling",
"isCorrect": true,
"explanation": "Storage Auto Scaling monitors free space and automatically increases storage capacity when it runs low, up to a user-defined maximum. This eliminates the need for manual storage interventions."
},
{
"answer": "Provisioned IOPS (io1) storage",
"isCorrect": false,
"explanation": "io1 provides consistent high IOPS for I/O-intensive workloads but does not automatically scale storage size as data grows."
},
{
"answer": "Read Replicas",
"isCorrect": false,
"explanation": "Read Replicas distribute read traffic but do not address storage scaling for the primary instance."
}
]
},
{
"question": "How many Read Replicas can be created per RDS DB instance?",
"answers": [
{
"answer": "Up to 3",
"isCorrect": false,
"explanation": "RDS supports up to 5 Read Replicas per DB instance, not 3."
},
{
"answer": "Up to 5",
"isCorrect": true,
"explanation": "RDS allows you to create up to 5 Read Replicas per DB instance. They can be in the same region, a different region, or promoted to standalone instances."
},
{
"answer": "Up to 10",
"isCorrect": false,
"explanation": "The limit for standard RDS Read Replicas is 5 per DB instance. Amazon Aurora supports higher replica counts, but that is a separate service."
},
{
"answer": "Unlimited",
"isCorrect": false,
"explanation": "There is a hard limit of 5 Read Replicas per RDS DB instance."
}
]
},
{
"question": "A company's primary RDS region becomes unavailable due to a large-scale outage. Which feature can be used as the foundation for disaster recovery to restore database operations in another region?",
"answers": [
{
"answer": "Multi-AZ standby in the same region",
"isCorrect": false,
"explanation": "Multi-AZ provides high availability within a single region across Availability Zones. If the entire region is unavailable, the Multi-AZ standby is also affected."
},
{
"answer": "Cross-region Read Replicas promoted to standalone instances",
"isCorrect": true,
"explanation": "Cross-region Read Replicas replicate data to another AWS region. In a regional disaster, the replica can be promoted to a standalone primary instance, enabling disaster recovery."
},
{
"answer": "RDS Proxy in a secondary region",
"isCorrect": false,
"explanation": "RDS Proxy handles connection pooling and failover within a region. It does not replicate data to another region or serve as a DR mechanism."
},
{
"answer": "Increasing the automated backup retention period",
"isCorrect": false,
"explanation": "Longer backup retention helps with point-in-time recovery but does not provide a rapidly promotable replica in another region for disaster recovery."
}
]
}
]
{{< /qcm >}}