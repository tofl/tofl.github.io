---
title: "OpenSearch Snapshots: Backup and Restore Strategies on AWS"
---

## OpenSearch Snapshots: Backup and Restore Strategies on AWS

Imagine you've built a critical application on Amazon OpenSearch Service that powers your real-time search and analytics. Your data is growing, your users depend on it, and suddenly you're faced with a troubling question: what happens if something goes wrong? Data corruption, accidental deletion, a misconfigured index, or even a complete domain failure could leave you scrambling to recover hours or days of work. This is where OpenSearch snapshots become your safety net.

Snapshots in Amazon OpenSearch Service are point-in-time backups of your entire domain—indices, settings, mappings, and all. They're one of the most powerful tools at your disposal for disaster recovery and data protection, yet they're often misunderstood or underutilized. Understanding how snapshots work, how to configure them properly, and how to use them strategically can be the difference between a quick recovery and a costly outage.

In this guide, we'll explore the complete snapshot ecosystem in OpenSearch, from the automated backups AWS manages for you to the manual snapshots you control, the configuration required to make it all work, and the practical strategies for keeping your data safe.

### Understanding OpenSearch Snapshots

A snapshot is essentially a complete point-in-time copy of your OpenSearch domain's state. It captures your indices, their data, your mappings, settings, and aliases—everything needed to recreate your domain or portions of it at a later time. Think of it like a photograph of your domain at a specific moment; you can then restore from that photograph to any point in time where you took one.

OpenSearch snapshots operate differently depending on who manages them. AWS maintains one set of snapshots automatically, while you manage another set manually through custom S3 repositories. This dual approach provides both convenience and control, and understanding the distinction is crucial to using snapshots effectively.

The snapshot mechanism in OpenSearch is built on top of the snapshot and restore API, which has been part of Elasticsearch and OpenSearch for years. When you take a snapshot, the domain intelligently compresses and stores only the data that's changed since the last snapshot, making subsequent snapshots efficient and cost-effective. This incremental approach means your first snapshot might be large, but subsequent ones are often much smaller.

### AWS-Managed Snapshots: The Automatic Layer

Every OpenSearch domain in AWS automatically gets a safety net in the form of automated snapshots. AWS takes these snapshots hourly and retains them for fourteen days. This happens entirely behind the scenes with no configuration required on your part—it's baked into the service.

However, there's an important limitation that catches many developers off guard: you cannot directly access or restore from these AWS-managed snapshots yourself. You cannot download them, inspect them, or choose which one to restore from in the traditional sense. AWS uses these automated snapshots exclusively for internal purposes and disaster recovery within their infrastructure. If AWS detects a domain-wide failure or catastrophic data loss, they can use these snapshots to recover your data, but this is a last-resort option handled by AWS support.

The fourteen-day retention window means you're protected against data loss for up to two weeks of history. This is a good baseline protection, but it's not the whole story. If you need longer retention, more control, or the ability to restore snapshots yourself, you need to layer in manual snapshots.

Think of AWS-managed snapshots as a safety net you can rely on but can't directly interact with. They're there if everything falls apart, but for your day-to-day backup strategy, you'll want to take control with manual snapshots.

### Manual Snapshots: Taking Control

This is where the real power of snapshots lies. Manual snapshots are backups that you create, manage, and control. Unlike AWS-managed snapshots, you can restore from manual snapshots anytime, to any domain, and in any region (with the right configuration). You also control the retention policy—snapshots can persist as long as you're willing to pay for the S3 storage.

To use manual snapshots, you first need to register a snapshot repository. A snapshot repository is essentially a configuration that tells OpenSearch where to store snapshots—specifically, an S3 bucket. Once you've registered a repository, you can take snapshots on demand and restore from them whenever needed.

Before you can register a repository, you need to grant OpenSearch permission to read from and write to your S3 bucket. This is where IAM comes in. The OpenSearch domain itself has an execution role (the service-linked role created when you provision the domain), and that role needs a policy that permits the necessary S3 actions.

Here's a minimal IAM policy that allows OpenSearch to work with a snapshot repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-opensearch-snapshots",
        "arn:aws:s3:::my-opensearch-snapshots/*"
      ]
    }
  ]
}
```

This policy grants OpenSearch the ability to get, put, and delete objects in your snapshot bucket, as well as list the bucket contents. The bucket ARN refers to the bucket itself, while the wildcard resource refers to all objects within it.

Once your IAM permissions are in place, you register the repository using the OpenSearch API. You'll typically do this through a REST call or using a client library. Here's a curl example that registers a repository named `my-repository`:

```bash
curl -X PUT "localhost:9200/_snapshot/my-repository" \
  -H 'Content-Type: application/json' \
  -d'{
    "type": "s3",
    "settings": {
      "bucket": "my-opensearch-snapshots",
      "region": "us-east-1"
    }
  }'
```

Note that this command assumes you're connecting to your domain with proper authentication. In practice, you'd likely be using the domain's public endpoint or an application that has network access to it, with proper credential handling.

Once the repository is registered, creating a snapshot is straightforward:

```bash
curl -X PUT "localhost:9200/_snapshot/my-repository/my-snapshot-1" \
  -H 'Content-Type: application/json'
```

This command initiates a snapshot named `my-snapshot-1` in the `my-repository` repository. The operation is asynchronous—it returns immediately, and the snapshot process happens in the background. You can monitor progress with:

```bash
curl -X GET "localhost:9200/_snapshot/my-repository/my-snapshot-1"
```

### Encryption and Security Considerations

When snapshots land in S3, you might be concerned about security. What if someone gains access to your S3 bucket? This is where encryption comes in.

By default, snapshots stored in S3 are not encrypted at rest. If you're storing sensitive data—and in most cases, you are—you should enable encryption. The most common approach is to use AWS Key Management Service (KMS) to encrypt the snapshot objects in S3.

To enable KMS encryption for your snapshots, you update your repository configuration to include KMS details:

```bash
curl -X PUT "localhost:9200/_snapshot/my-repository" \
  -H 'Content-Type: application/json' \
  -d'{
    "type": "s3",
    "settings": {
      "bucket": "my-opensearch-snapshots",
      "region": "us-east-1",
      "server_side_encryption": true,
      "ssekms_key_id": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }'
```

The `server_side_encryption` flag enables encryption, and `ssekms_key_id` specifies the KMS key to use. Make sure the OpenSearch domain's execution role has permissions to use this KMS key. You'll need to add a KMS policy statement that allows the role to call `kms:Decrypt` and `kms:GenerateDataKey` on the specified key.

Encryption at rest protects your data if someone gains access to your S3 bucket, but remember that in transit, the data between your domain and S3 flows through AWS infrastructure. For additional security in sensitive environments, you might also consider putting your OpenSearch domain in a VPC with private subnets and using VPC endpoints for S3 access, though that's beyond the scope of snapshots themselves.

### Restoring from Snapshots

The real test of a backup strategy is the restore. OpenSearch makes restoring snapshots flexible and powerful, supporting several different scenarios.

The simplest restore operation brings an index or set of indices back to the same domain. If a developer accidentally deleted an index or you need to roll back to an earlier state, you can restore specific indices from a snapshot:

```bash
curl -X POST "localhost:9200/_snapshot/my-repository/my-snapshot-1/_restore" \
  -H 'Content-Type: application/json' \
  -d'{
    "indices": "my-index-1,my-index-2"
  }'
```

This command restores only the specified indices from the snapshot. The operation happens in the background, and existing indices with the same name are not overwritten by default. If you want to replace existing indices, you'd need to delete them first or use index renaming during the restore.

Restoring to a different domain is equally important for disaster recovery scenarios. If your primary domain fails completely, you might restore to a new domain in the same region or a different region. The process is nearly identical, except you're running the restore command against the destination domain:

```bash
curl -X POST "https://destination-domain-endpoint:9200/_snapshot/my-repository/my-snapshot-1/_restore" \
  -H 'Content-Type: application/json' \
  -d'{
    "indices": "my-index-1"
  }'
```

The key requirement here is that the destination domain also has access to the same S3 repository. If you're restoring to a domain in a different AWS region, the destination domain needs IAM permissions to access the S3 bucket and, if the bucket is in another region, appropriate cross-region access configured.

For more sophisticated restore scenarios, OpenSearch supports renaming indices during restore. This is useful when you want to restore data alongside existing data without overwriting it:

```bash
curl -X POST "localhost:9200/_snapshot/my-repository/my-snapshot-1/_restore" \
  -H 'Content-Type: application/json' \
  -d'{
    "indices": "my-index-1",
    "rename_pattern": "my-index-(.+)",
    "rename_replacement": "restored-my-index-$1"
  }'
```

This example uses a regex pattern to rename `my-index-1` to `restored-my-index-1` during the restore, allowing you to keep both versions and compare them before deciding which to use.

### Cross-Region Disaster Recovery

One of the most compelling use cases for manual snapshots is cross-region disaster recovery. If an entire AWS region experiences an outage, having your data replicated to another region through snapshots can be a lifesaver.

The architecture for cross-region snapshot-based DR involves storing snapshots in an S3 bucket that's replicated across regions or accessible from multiple regions. One common pattern is to use S3 cross-region replication, where objects written to an S3 bucket in one region are automatically replicated to a bucket in another region.

Here's the typical flow: your primary OpenSearch domain in `us-east-1` takes snapshots to an S3 bucket in the same region. S3 replication automatically copies those snapshots to a bucket in `us-west-2`. If the primary region fails, you spin up a new OpenSearch domain in `us-west-2`, register a repository pointing to the replicated snapshots, and restore your data.

The time to recovery depends on several factors: how quickly you can provision a new domain, the size of your data, and network throughput. For most domains, bringing up a new domain and restoring a few gigabytes of data might take 15-30 minutes, while larger domains could take longer. This is why understanding your Recovery Time Objective (RTO) and Recovery Point Objective (RPO) is crucial.

Your RPO is determined by how frequently you take snapshots. If you take snapshots every hour, your maximum data loss is approximately one hour of data. If you take snapshots every fifteen minutes, your RPO is tighter. Your RTO is determined by how quickly you can provision infrastructure and restore data—typically measured in tens of minutes.

### Practical Snapshot Strategy

So how do you build a real-world snapshot strategy? Here's a practical approach that balances protection, cost, and complexity.

First, rely on AWS-managed snapshots as your baseline safety net. They're automatic and free, protecting you for fourteen days with no configuration.

Second, implement manual snapshots at a frequency that matches your RPO requirements. For most applications, daily snapshots are reasonable, while high-throughput or critical applications might benefit from hourly snapshots. You can automate snapshot creation using AWS Lambda, which invokes the OpenSearch API on a schedule, or by using a CI/CD system that you already have in place.

Third, consider your retention policy. How far back do you need to be able to restore? For compliance reasons, some organizations retain snapshots for months or years. Others keep only the last few days. Your retention policy directly impacts S3 storage costs, so balance protection with budget.

Fourth, test your restore process regularly. A backup that's never been tested is just hope—you don't truly know if it works until you've restored from it. Create a test domain periodically, restore a snapshot, and verify the data. This not only validates your backups but also helps you understand how long the restore process actually takes in your environment.

Fifth, for critical applications, implement cross-region snapshots. This adds complexity and cost but provides protection against regional outages. Consider whether your business can tolerate being down for hours while a regional outage is resolved, or whether you need the ability to failover to another region within minutes.

### Monitoring and Maintenance

OpenSearch provides APIs to monitor your snapshots. You can list all snapshots in a repository, check their status, and identify incomplete or failed snapshots:

```bash
curl -X GET "localhost:9200/_snapshot/my-repository/_all"
```

This returns a list of all snapshots in the repository, including their status (SUCCESS, IN_PROGRESS, FAILED, INCOMPATIBLE, or PARTIAL), creation time, and size. Monitoring this regularly helps you catch failed snapshots before you need them.

Failed snapshots can occur for various reasons: insufficient S3 permissions, network connectivity issues, or transient errors. If you see failed snapshots, investigate the OpenSearch logs and S3 access logs to understand what went wrong. Many failures are transient and resolve themselves on a retry.

Snapshots also consume S3 storage, and that storage costs money. Over time, as you accumulate snapshots, your S3 bill grows. Implement a retention policy that deletes old snapshots automatically. You can do this using S3 lifecycle policies, which automatically delete objects older than a certain number of days, or you can build a Lambda function that periodically deletes old snapshots based on your retention requirements.

### Snapshot Limitations to Keep in Mind

While snapshots are powerful, they have limitations worth understanding. Snapshots are only as current as the last one taken—if you take daily snapshots, you can't restore to an arbitrary point within a day. If you need point-in-time recovery with minute-level granularity, snapshots alone won't get you there; you'd need to implement a more sophisticated approach like transaction logs or dual writes to another system.

Additionally, snapshots don't protect against all types of data loss. If malicious code or a buggy application modifies data in your indices, those corruptions are captured in snapshots too. Snapshots are a great defense against infrastructure failures and accidental deletion, but they're not a substitute for data validation and application-level safeguards.

Lastly, snapshot operations can consume resources. Taking a snapshot requires CPU and disk I/O on the domain. If you're taking very frequent snapshots on a domain that's already under heavy load, you might see performance degradation. In most cases, this is minimal and acceptable, but it's worth testing in your environment.

### Integration with Your Disaster Recovery Plan

Snapshots fit into a broader disaster recovery strategy. They're excellent for protecting against data loss, but they're not a complete DR solution by themselves. A complete DR strategy also considers things like infrastructure as code (so you can quickly rebuild your domain configuration), network configuration (VPC, security groups, endpoints), monitoring and alerting (so you know something's wrong), and documented runbooks (so you know exactly what to do when disaster strikes).

OpenSearch snapshots handle the data side of DR. Combined with proper infrastructure management and well-rehearsed procedures, they become a critical component of a robust system.

### Conclusion

OpenSearch snapshots provide a straightforward yet powerful mechanism for protecting your data and enabling disaster recovery. AWS-managed snapshots offer automatic baseline protection for fourteen days, while manual snapshots to S3 give you complete control over retention, restore timing, and cross-region capabilities. By understanding the distinction between these two layers, properly configuring IAM and KMS permissions, and implementing a snapshot strategy that matches your business requirements, you create a safety net that transforms potential disasters into manageable recovery scenarios.

The key to effective snapshot usage is treating it as part of a larger strategy: automate snapshot creation, test restores regularly, monitor for failures, and integrate snapshots into your broader infrastructure and disaster recovery planning. When you do this, snapshots stop being an afterthought and become the reliable foundation that keeps your OpenSearch deployments resilient.
