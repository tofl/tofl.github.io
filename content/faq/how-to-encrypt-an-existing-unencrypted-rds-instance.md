---
title: "How to Encrypt an Existing Unencrypted RDS Instance"
---

## How to Encrypt an Existing Unencrypted RDS Instance

If you've launched an Amazon RDS instance without encryption enabled, you've discovered one of RDS's less forgiving design decisions: AWS doesn't support encrypting an existing unencrypted database in place. There's no toggle, no in-place transformation, no magic button. The only supported path forward is to create an encrypted copy of your data and migrate to it. While this workflow sounds tedious, understanding *why* this limitation exists and how to execute the migration smoothly is essential knowledge for anyone managing databases on AWS.

This guide walks you through the complete process—from taking your first snapshot to cutting over your application traffic—while addressing the real-world complications that often catch teams off guard.

### Understanding the Encryption Limitation

Before we dive into the mechanics, it's worth understanding why AWS doesn't support in-place encryption for RDS. The answer lies in how RDS implements encryption at rest using AWS Key Management Service (KMS).

RDS encryption is tightly integrated with the KMS master key used during instance creation. The encryption key, storage layer, backup process, and read replicas are all bound together at launch time. Retrofitting encryption onto an existing unencrypted instance would require AWS to re-encrypt terabytes of data on disk while the database remains running—a technically complex operation that could introduce consistency issues or degrade performance unpredictably. Rather than build that machinery, AWS mandates the snapshot-and-restore workflow, which is safer and gives you explicit control over the cutover process.

The constraint applies universally: whether you're running MySQL, PostgreSQL, MariaDB, Oracle, or SQL Server on RDS, the encryption path is the same.

### The Core Workflow: Snapshot, Copy, Restore

The standard migration process follows three distinct steps. Let's break down each one in detail.

#### Step 1: Create a Snapshot of Your Unencrypted Instance

Start by taking a snapshot of your current RDS instance. This is a full point-in-time backup that captures the entire database state.

```bash
aws rds create-db-snapshot \
  --db-instance-identifier my-unencrypted-db \
  --db-snapshot-identifier my-db-snapshot-20240115
```

The snapshot creation is non-blocking for read traffic, but write performance may degrade slightly while AWS captures the data. For busy production databases, consider scheduling this during a maintenance window if you want to avoid any risk of user impact.

Monitor the snapshot's progress via the AWS Management Console or the CLI:

```bash
aws rds describe-db-snapshots \
  --db-snapshot-identifier my-db-snapshot-20240115 \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,Status,PercentProgress]'
```

The status will move from `creating` to `available`. Depending on your instance size and storage volume, this may take several minutes to hours. Don't proceed to the next step until the snapshot status shows `available`.

#### Step 2: Copy the Snapshot with KMS Encryption Enabled

Once your snapshot is available, you copy it—and this is where encryption enters the picture. During the copy operation, you specify a KMS master key, and AWS encrypts the snapshot data using that key.

```bash
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier my-db-snapshot-20240115 \
  --target-db-snapshot-identifier my-db-snapshot-encrypted \
  --kms-key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

A few important details here:

If you don't specify a KMS key explicitly, RDS will use your account's default RDS KMS key (if one exists). While this works, it's often better to specify the key explicitly so you have clear control and can easily track which key encrypts which resource.

The copy operation itself doesn't require downtime—your unencrypted instance keeps running. However, the copy takes time proportional to the snapshot size. For a 500 GB database, expect the copy to take 10–30 minutes depending on KMS API throttling and other factors.

You can monitor the copy's progress the same way:

```bash
aws rds describe-db-snapshots \
  --db-snapshot-identifier my-db-snapshot-encrypted \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,Status,Encrypted]'
```

Confirm that the `Encrypted` field shows `true` before moving forward.

#### Step 3: Restore from the Encrypted Snapshot

Now you restore a new RDS instance from the encrypted snapshot. This new instance will be encrypted and will use the KMS key you specified during the copy.

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier my-encrypted-db \
  --db-snapshot-identifier my-db-snapshot-encrypted \
  --db-instance-class db.t3.medium
```

The restore process does require downtime—your application cannot connect to a new instance until it's fully available and has completed parameter group setup and other initialization. The restore typically takes 10–15 minutes for small to medium instances, though it can stretch longer for larger databases with complex parameter groups.

During restore, RDS applies the parameter group, option group, and other settings from the original instance. However, some settings—particularly network configuration—may differ. We'll address cutover strategy next.

### Managing Downtime and Cutover

The restore phase introduces downtime because your application must switch from the old unencrypted instance to the new encrypted one. The length of downtime depends on your application's architecture and how quickly you can update connection strings.

#### Minimizing Application Downtime

The cleanest approach is to drain existing connections from your old instance before switching traffic. Most applications maintain a connection pool, and you can typically stop accepting new connections while allowing existing ones to finish their work, then gracefully close the pool and reconnect to the new endpoint.

For a web application, this might look like:

1. Set the old RDS instance to read-only (to prevent further writes while connections drain).
2. Stop your application or put it into a maintenance mode that allows existing requests to complete but rejects new ones.
3. Wait a few seconds for connection pools to empty.
4. Update your application's database connection string to point to the new encrypted instance's endpoint.
5. Restart application traffic.

The total outage is typically measured in seconds to a couple of minutes, not hours.

#### Using DNS-Based Cutover

A cleaner strategy, if your application architecture supports it, is to use a DNS alias or CNAME record that points to the RDS endpoint. Instead of hardcoding the endpoint in your application, you point to a DNS name that you control.

For example, your application connects to `db.myapp.internal`, which is a CNAME pointing to the actual RDS endpoint. During the migration, you update the CNAME to point to the new encrypted instance's endpoint. This decouples the cutover from application deployment and allows you to switch endpoints almost instantly.

```bash
# Conceptual example (DNS record update, not an AWS CLI command)
# Before migration:
# db.myapp.internal -> my-unencrypted-db.xxxxx.us-east-1.rds.amazonaws.com

# After migration:
# db.myapp.internal -> my-encrypted-db.xxxxx.us-east-1.rds.amazonaws.com
```

DNS TTL (time-to-live) will cause some clients to continue using the old endpoint briefly, but well-behaved clients will refresh their DNS cache within seconds. If your application caches the endpoint's IP address aggressively, this strategy is less effective.

#### Renaming the Instance (Advanced)

Another approach is to rename the instances to swap their endpoints. RDS instance names are tied to their public endpoint, so if you rename the old instance and then rename the new one to match the old name, you can avoid updating connection strings entirely.

However, this approach carries risk: the rename itself takes a few seconds, and the operation can fail if there are naming conflicts. Use this strategy only if you're comfortable with the operational complexity.

### Handling Read Replicas

If your unencrypted instance has read replicas, you must address them separately. Read replicas inherit the encryption status of their source—if the source is unencrypted, so are the replicas. You cannot create encrypted read replicas from an unencrypted source.

Your options are:

**Option 1: Promote read replicas temporarily.** Before the migration, promote each read replica to a standalone instance. After you've migrated the primary to the encrypted instance, create new encrypted read replicas from the encrypted primary. This works but requires careful orchestration and temporary absence of replication.

**Option 2: Recreate replicas after migration.** Simply delete the read replicas from the unencrypted instance and create new ones from the encrypted instance after the migration completes. If your replicas are for scaling read traffic, the brief period without them may be acceptable during your maintenance window.

**Option 3: Use binlog-based replication externally.** For certain database engines like MySQL, you can set up external replication to another RDS instance or an EC2-hosted database, then switch your application over during the migration. This is more complex but avoids any gap in replicated data.

For most teams, Option 2 is the simplest: accept a brief period without read replicas and recreate them afterward. Read replica creation is fast—typically 5–10 minutes.

### Cross-Region Considerations

If your unencrypted instance lives in one region and you want the encrypted copy in another, the workflow changes slightly. You must copy the snapshot across regions, and KMS introduces an additional layer of consideration.

```bash
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier my-db-snapshot-20240115 \
  --source-region us-east-1 \
  --target-db-snapshot-identifier my-db-snapshot-encrypted \
  --target-region us-west-2 \
  --kms-key-id arn:aws:kms:us-west-2:123456789012:key/87654321-4321-4321-4321-210987654321
```

Notice that the `kms-key-id` references a key in the *target* region (`us-west-2` in this case). If the key doesn't exist in the target region, the copy will fail. You may need to create a KMS key in the target region first, or set up cross-region key replication beforehand.

Cross-region snapshot copies are slower than same-region copies because data travels over the internet. For a 100 GB snapshot, expect 15–45 minutes. The trade-off is worthwhile if you're implementing a disaster recovery strategy or expanding to a new region.

### Database Engine Specifics

The core workflow applies to all RDS engines, but a few details vary:

**MySQL and MariaDB:** Snapshot and restore are straightforward. Parameter groups and option groups are preserved. Automated backups from the encrypted instance will also be encrypted.

**PostgreSQL:** The restore process preserves parameter groups and includes any custom extensions. Ensure that any custom KMS key policies allow your RDS service role to use the key.

**Oracle:** Snapshot encryption works the same way, but note that Oracle backups are part of the snapshot. After restoring, you may need to reconfigure some Oracle-specific features like Data Guard if you were using them.

**SQL Server:** Similar to Oracle—snapshots work the same, but some SQL Server-specific features (like native backup and restore to S3) may require reconfiguration.

For all engines, test the restore in a non-production environment first if possible. This validates that your backups are actually restorable and that your application connects smoothly to the new instance.

### Common Pitfalls and How to Avoid Them

**Pitfall 1: Forgetting to update security groups.** The new encrypted instance has its own RDS endpoint, and if you're running it in a different VPC or availability zone, the security group rules may not match. Before cutover, verify that your application's security group allows outbound access to the new instance's security group, and that the new instance's security group allows inbound traffic on the correct port (3306 for MySQL, 5432 for PostgreSQL, etc.).

**Pitfall 2: Missing parameter group changes.** During the snapshot-to-restore cycle, parameter groups are preserved, but if you customize the new instance's parameter group after restore, make sure those changes are intentional and documented. A common mistake is forgetting to set critical parameters like `max_connections` or `slow_query_log` on the encrypted instance if they differ from defaults.

**Pitfall 3: Assuming automatic failover works across instances.** If you're using RDS Multi-AZ for high availability, note that Multi-AZ deployments create standby replicas, not read replicas. When you migrate to an encrypted instance, you'll need to enable Multi-AZ on the new instance separately if you want continued HA protection.

**Pitfall 4: Losing track of backups.** Automated backups from your unencrypted instance are unencrypted. After you migrate, those old backups remain in your account but cannot be restored to your encrypted instance (they're encrypted with different keys, in a sense). Don't accidentally rely on a week-old unencrypted backup if you've already migrated. Plan your backup retention policy accordingly.

**Pitfall 5: KMS key permission issues.** If you use a customer-managed KMS key for encryption, ensure that the RDS service role in your account has permission to use that key. The role must have `kms:Decrypt`, `kms:GenerateDataKey`, and `kms:CreateGrant` permissions. If these are missing, your encrypted instance won't be able to read the encrypted data.

### Validation and Testing

Before fully committing to the migration, run these validation steps:

**Test the new instance in staging.** Restore the snapshot to a staging environment first, if possible. Verify that your application can connect, run sample queries, and that data integrity looks good. A simple check: compare row counts and checksums of key tables between the old and new instances.

**Monitor encryption status.** Use the AWS Management Console or CLI to confirm that the new instance shows `Encrypted: true` and displays the correct KMS key ARN.

**Check backup encryption.** Create a manual snapshot of the new encrypted instance and verify that it's encrypted as well. Automated backups will inherit the encryption status.

**Verify performance.** Sometimes encryption introduces a small performance overhead due to KMS API calls. In practice, this is negligible for most workloads, but running a load test on the new instance can provide peace of mind.

### Next Steps and Best Practices

Once your migration is complete and traffic is stable on the encrypted instance, consider these follow-up actions:

Enable automated backups on the encrypted instance if they're not already enabled. AWS enables backups by default, but verify the retention period matches your requirements.

Create read replicas from the encrypted instance if you had them before. These will be encrypted automatically, inheriting the primary's encryption settings.

Set up enhanced monitoring and performance insights on the encrypted instance. The overhead is minimal, and having visibility into your database's health is invaluable during the stabilization period after migration.

Document the encryption key and its rotation policy. KMS keys can be rotated annually, and having a rotation schedule ensures that your encryption remains current with your security posture.

Consider enabling encryption by default for all future RDS instances. This prevents the same situation in the future. In the AWS Management Console, you can set encryption as a default when launching new instances, or enforce it via AWS Identity and Access Management (IAM) policies at the organizational level.

### Conclusion

Encrypting an existing unencrypted RDS instance requires taking a snapshot, copying it with KMS encryption, and restoring it as a new instance. While this workflow demands downtime and careful coordination, it's straightforward to execute if you understand the mechanics and plan for the operational details: cutover strategy, read replica handling, security group updates, and KMS permissions. The migration is a one-time effort that yields significant security benefits and is essential for meeting compliance requirements. By following the step-by-step process outlined here and avoiding the common pitfalls, you'll have a fully encrypted, production-ready database in a few hours. The encryption status is permanent once restored, and your encrypted instance will be protected by your chosen KMS key going forward.
