---
title: "EBS Snapshots: Incremental Backups, Cross-Region Copy, and Fast Snapshot Restore"
---

## EBS Snapshots: Incremental Backups, Cross-Region Copy, and Fast Snapshot Restore

If you've spent any time managing infrastructure on AWS, you've likely realized that data durability and disaster recovery aren't optional luxuries—they're fundamental requirements. Amazon EBS snapshots are one of the most powerful yet misunderstood tools in the AWS ecosystem. Many developers treat them as simple point-in-time backups, but the reality is far richer. Understanding how snapshots work under the hood, how to orchestrate them intelligently, and how to leverage advanced features like Fast Snapshot Restore can be the difference between a bulletproof backup strategy and a fragile one.

In this article, we'll explore EBS snapshots from first principles through advanced use cases. We'll demystify how they're stored, learn practical techniques for automating their creation and management, discover how to safely share them across boundaries, and see how Fast Snapshot Restore can eliminate performance penalties when restoring volumes. By the end, you'll have a comprehensive mental model that translates directly into production-ready implementations.

### Understanding EBS Snapshots: More Than Just Backups

An EBS snapshot is a point-in-time copy of an EBS volume stored in Amazon S3. But here's the crucial part that many people miss: snapshots are *incremental by design*. This means that after you create an initial snapshot, each subsequent snapshot only stores the blocks that have changed since the previous snapshot. This incremental approach is what makes snapshots practical for frequent backups without prohibitive storage costs.

Think of it like version control for your data. The first snapshot captures everything—the full state of the volume. When you take a second snapshot, AWS identifies which blocks have changed and stores only those deltas. A third snapshot then stores only what's changed since the second, and so on. This efficiency is baked into the architecture.

However, there's an important caveat: from a user perspective, each snapshot appears to be a complete, independent backup. If you delete an older snapshot, AWS is intelligent enough to preserve the data chains so that newer snapshots remain valid and restorable. You don't need to keep every snapshot in sequence; AWS manages the complexity behind the scenes.

The magic of this incremental storage happens at the block level. EBS volumes are made up of blocks (typically 8 KB), and AWS tracks which blocks have been modified since the last snapshot. Only those modified blocks are included in the new snapshot. This is why the first snapshot of a volume is larger than subsequent snapshots of an actively changing volume, and why snapshots of largely static volumes consume very little additional storage over time.

### The Storage Engine: Where Snapshots Actually Live

Snapshots are stored in S3, but not in a way you can directly access them through the S3 API. Instead, AWS manages a dedicated, internal S3 bucket structure for each region. This abstraction is deliberate—it gives AWS the flexibility to optimize storage, implement versioning and deduplication, and manage lifecycle without exposing the complexity to you.

What this means practically is that snapshot storage is billed separately from regular EBS volume storage. When you check your AWS bill, you'll see line items for "EBS Snapshot Storage" measured in gigabyte-months. The first snapshot typically costs more (since it's nearly the full volume size), but subsequent snapshots cost significantly less because they're mostly incremental data.

This architecture also explains why snapshots are durable and region-specific. A snapshot exists in a particular region's S3 infrastructure until you explicitly copy it to another region. This regional isolation provides data residency compliance and serves as a foundation for disaster recovery strategies.

### Automating Snapshot Creation with Data Lifecycle Manager

Taking snapshots manually is tedious and error-prone. The AWS Data Lifecycle Manager (DLM) is the professional tool for automating snapshot creation and retention. Rather than setting up cron jobs or Lambda functions, DLM lets you define lifecycle policies that automatically create snapshots on a schedule and delete old ones according to rules you specify.

A DLM policy works by tagging. You apply a specific tag to your EBS volumes—for example, a tag key called `Backup` with a value of `Daily`—and then create a DLM policy that targets volumes with that tag. The policy defines how often snapshots are created (hourly, daily, weekly, monthly), what time they're taken, and how many snapshots to retain.

Here's a practical example: imagine you want to back up a critical database volume every day at 2 AM UTC, retaining the last 30 days of snapshots. You'd create a DLM policy with the following characteristics:

The policy targets volumes with a specific tag, runs on a daily schedule at your chosen time, and has a retention rule that keeps 30 snapshots before automatically deleting older ones. DLM then handles the entire operation—no Lambda, no manual intervention. If a snapshot creation fails, DLM automatically retries; it also creates a CloudWatch event that you can monitor for failures.

One subtle but important detail: DLM creates snapshots with a standardized naming convention that includes a timestamp. This makes it easy to identify exactly when a snapshot was taken by looking at its name. Additionally, DLM can tag the snapshots it creates, making it simple to filter and track them programmatically.

A common pattern in enterprise environments is layered retention: daily snapshots kept for 30 days, weekly snapshots kept for 90 days, and monthly snapshots kept for a year. You can achieve this with multiple DLM policies, each with different schedules and retention rules, all targeting volumes with the same tag. This gives you granular backup coverage without manual effort.

### Copying Snapshots Across Regions and Accounts

Snapshots are region-specific resources. If your volume exists in us-east-1, its snapshots are stored in us-east-1. If you need disaster recovery capability in us-west-2, you must explicitly copy snapshots to that region. The snapshot copy operation reads the snapshot from the source region and writes it to the destination region, creating a new snapshot object in the destination.

Copying a snapshot is straightforward via the AWS CLI. The basic operation looks like:

```
aws ec2 copy-snapshot \
  --source-region us-east-1 \
  --source-snapshot-id snap-1234567890abcdef0 \
  --destination-region us-west-2 \
  --description "Disaster recovery backup"
```

When you copy a snapshot, the operation is incremental if a chain of related snapshots already exists in the destination region. This means that copying additional snapshots from the same source chain to the destination is faster and cheaper after the first copy. However, the first copy is essentially a full data transfer, and for large snapshots, this can take some time and incur data transfer costs.

You can also copy snapshots across AWS accounts. This is particularly useful in enterprise environments where you have separate accounts for development, staging, and production. The process requires the source account to grant permissions to the destination account, and the destination account must accept the shared snapshot. From there, the destination account can copy the snapshot into its own region for restoration.

Here's a practical scenario: your production account needs to share a volume snapshot with your disaster recovery account in a different region. In the production account, you'd modify the snapshot's permissions to allow the DR account to access it. In the DR account, you'd initiate a copy of that snapshot to your preferred region. Once the copy completes, you have a standalone snapshot in the DR account that you can use to create a volume independently, without any ongoing dependency on the source account.

### Sharing Encrypted Snapshots and KMS Considerations

When you create a snapshot of an encrypted EBS volume, the snapshot is encrypted with the same KMS key that encrypts the source volume. This is a security feature—your data remains encrypted at rest in S3. However, it introduces complexity when sharing snapshots across accounts.

Suppose you want to share an encrypted snapshot from your production account with your disaster recovery account. Simply sharing the snapshot isn't enough; the DR account also needs access to the KMS key. Without key permissions, the DR account can see the snapshot exists but cannot restore it to a new volume.

The solution requires two permissions: first, the source account must grant the destination account permission to copy the snapshot; second, the source account must grant the destination account permission to use the KMS key. In the key policy, you'd add a statement that allows the destination account's principal (the user or role) to use the key for encryption and decryption operations.

A common approach is to create a customer-managed KMS key specifically for sharing encrypted snapshots. This key has a policy that explicitly allows your disaster recovery account to use it. When you encrypt volumes with this key, any snapshots created from those volumes can be shared with the DR account without additional configuration.

Alternatively, you can re-encrypt the snapshot with a key that the destination account owns. In the destination account, you'd use the AWS Backup service or manual operations to copy the snapshot, and during the copy process, specify a KMS key in the destination account to re-encrypt it. This approach gives the destination account full ownership and autonomy over the encrypted data.

Here's a practical consideration: if you're using AWS Backup for cross-account disaster recovery, it handles much of this complexity automatically. AWS Backup manages key permissions and snapshot encryption transparently, making it easier than managing snapshots manually. However, understanding the underlying mechanisms helps you troubleshoot when things don't work as expected.

### Creating AMIs from Snapshots

Once you have a snapshot, you can create an Amazon Machine Image (AMI) from it. An AMI is a template that contains the software configuration, operating system, and application code needed to launch an EC2 instance. Creating an AMI from a snapshot is the foundation for infrastructure-as-code practices and disaster recovery workflows.

When you create an AMI from a snapshot, you're not copying the snapshot data; instead, you're creating metadata that references the snapshot. The AMI stores information about the boot device volume (the snapshot), the architecture, the virtualization type, and other configuration details. When you launch an instance from the AMI, EC2 creates a new volume based on the snapshot and attaches it to the instance.

Creating an AMI from a snapshot is useful in several scenarios. In a disaster recovery context, you might snapshot a fully configured application server, create an AMI from that snapshot, and use that AMI to quickly launch replacement instances in a different region. In a development workflow, you might create an AMI from a "golden" snapshot that contains your base operating system and common tools, then use that AMI as a foundation for launching development instances.

One important nuance: the snapshot must contain a bootable filesystem. If you're creating an AMI from a snapshot of a data volume (a volume that doesn't contain an operating system), the resulting AMI won't be launchable. The snapshot must be from the root device of a previously running instance, or you must carefully prepare it with the necessary boot configuration.

You can also create a multi-volume AMI by creating snapshots of multiple volumes and then creating an AMI that references all those snapshots. This is useful for applications that span multiple volumes—for example, a database server with data on a separate volume from the operating system. When you launch an instance from this AMI, EC2 creates and attaches all the referenced volumes.

### Fast Snapshot Restore: Eliminating Cold-Cache Latency

Here's a problem you encounter in real-world disaster recovery scenarios: you restore a volume from a snapshot, but the first I/O operations are slow. This happens because the volume starts in a "warming" state where data blocks are loaded from S3 on-demand. Until the blocks are loaded, you experience latency that can significantly impact application startup time.

Fast Snapshot Restore (FSR) solves this problem by pre-staging snapshots to the EBS infrastructure. When you enable FSR on a snapshot, AWS prepares the snapshot's data for rapid restoration. Instead of loading blocks on-demand from S3, the volume is immediately available for full-speed I/O from the moment it's created.

Enabling FSR on a snapshot is a one-time operation:

```
aws ec2 enable-fast-snapshot-restores \
  --availability-zones us-east-1a \
  --source-snapshot-id snap-1234567890abcdef0
```

Notice that you specify not just the snapshot, but also the availability zones. FSR is per-zone, which reflects the underlying architecture. AWS pre-stages the snapshot data in specific zones, so you must enable FSR for each zone where you plan to restore the snapshot.

The tradeoff with FSR is cost. Enabling FSR on a snapshot incurs an additional charge per gigabyte per month. For critical snapshots where rapid recovery is essential, this cost is usually justified. For infrequently-used backup snapshots, FSR might not make sense.

A practical pattern is selective FSR: enable FSR on your most recent and critical snapshots (perhaps the last few days of daily backups), but leave older snapshots without FSR enabled. This balances cost and recovery capability. If you need to restore from an older snapshot, you'll accept a slightly longer recovery window; if you need to restore from recent backups, you get near-instant performance.

FSR is particularly valuable in these scenarios: multi-region disaster recovery where you need guaranteed RPOs and RTOs, infrastructure-as-code deployments where you're launching fully pre-configured instances and can't tolerate initialization delays, and mission-critical applications where any latency during recovery is unacceptable.

One important consideration: FSR has regional limitations. Check the AWS documentation for your region to ensure FSR is available where you plan to use it. Additionally, FSR only benefits volumes created from that specific snapshot; if you copy the snapshot to another region, you must separately enable FSR in that region.

### Practical Disaster Recovery Workflow

Let's tie these concepts together into a realistic disaster recovery scenario. Imagine you have a production application in us-east-1 and need to maintain disaster recovery capability in us-west-2.

Your strategy: first, you tag all critical volumes with `DisasterRecovery: Enabled`. You create a DLM policy that targets these volumes, creates daily snapshots at 2 AM UTC, and retains 30 snapshots. This ensures that you always have up to 30 days of backup points. Next, you create an automated process (perhaps a Lambda function triggered by CloudWatch Events) that copies snapshots to us-west-2 within one hour of creation. You enable FSR on the snapshots in us-west-2 for the last seven days, ensuring rapid recovery if needed.

When a critical incident occurs in us-east-1, you head to us-west-2, select a recent snapshot, create a volume from it (which completes almost instantly because of FSR), attach it to a pre-launched instance (or launch a new instance with an AMI you created from a backup snapshot), and bring the application online. Your RPO might be one hour (the age of the most recent snapshot) and your RTO might be 15 minutes (the time to create a volume and restart the application). These are realistic targets for many applications.

This workflow is achievable without writing a line of code for snapshot management—DLM handles scheduling, the copy operation can be fully automated, and FSR handles performance. The operational overhead is minimal compared to the protection you gain.

### Monitoring and Best Practices

Effective snapshot management requires visibility. AWS provides several tools for monitoring snapshots. CloudWatch Metrics shows snapshot creation duration and success rates; CloudWatch Events can trigger notifications when snapshots are created or fail; and the EBS API provides detailed information about all your snapshots across regions.

A best practice is to regularly audit your snapshots. Snapshots that are no longer needed should be deleted to reduce storage costs. Tags are invaluable here—if you consistently tag snapshots (either manually or through DLM, which supports snapshot tagging), you can easily query and filter them. A common tagging strategy includes the application name, backup type (daily, weekly, monthly), and creation timestamp.

Another important practice: periodically test your disaster recovery snapshots. Don't assume that a snapshot is restorable without actually testing the restore in your non-production environment. Create a volume from a backup snapshot, verify that the data is correct, and confirm that applications can boot and run correctly. This testing catches issues early and builds confidence in your backup strategy.

For encryption, document which KMS keys protect each snapshot, and ensure that the key policies are maintained. If you delete a KMS key without understanding which snapshots it protects, you can inadvertently render those snapshots unrestorable.

Finally, consider your retention policies carefully. Regulatory requirements, business continuity objectives, and cost constraints all influence how many snapshots you keep. DLM's retention rules make it easy to implement these policies consistently, but they require upfront thought about what your retention strategy should be.

### Conclusion

EBS snapshots are far more sophisticated than they might initially appear. Their incremental nature makes frequent backups practical and cost-effective. Data Lifecycle Manager removes the operational burden of manual snapshot scheduling. Cross-region and cross-account copying enables disaster recovery and infrastructure sharing. Understanding KMS key permissions ensures secure sharing of encrypted snapshots. Creating AMIs from snapshots accelerates infrastructure provisioning. And Fast Snapshot Restore eliminates performance penalties that could otherwise undermine your recovery objectives.

When you understand how these pieces fit together—the incremental storage model, the automation capabilities, the sharing mechanisms, and the performance optimization features—you can build backup and disaster recovery strategies that are both robust and efficient. The foundation is solid architectural understanding; the execution is straightforward tooling and consistent practices. Start with DLM for scheduling, add cross-region copying for resilience, enable FSR for critical snapshots, and regularly test your recovery procedures. With that approach, you'll have the confidence that your data is protected and recoverable, no matter what happens.
