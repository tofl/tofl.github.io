---
title: "S3 Storage Lens and S3 Inventory: Visibility Into Your Buckets at Scale"
---

## S3 Storage Lens and S3 Inventory: Visibility Into Your Buckets at Scale

Managing Amazon S3 buckets at scale presents a unique challenge. You might have dozens of buckets spread across multiple AWS accounts, containing millions of objects with varying access patterns and storage classes. How do you know which buckets are consuming the most money? Where are your unencrypted objects? Which files haven't been accessed in months? Without the right visibility tools, these questions remain unanswered until your bill arrives.

Amazon S3 provides two complementary tools designed to solve exactly this problem: S3 Storage Lens and S3 Inventory. Together, they form a comprehensive visibility solution that helps you optimize costs, enforce security policies, and understand your storage patterns. This article walks you through how each tool works, when to use them, and how to combine them for maximum insight into your S3 infrastructure.

### Understanding S3 Storage Lens: Your Dashboard to S3 Analytics

S3 Storage Lens is AWS's answer to the need for organization-wide visibility into storage usage and activity. Think of it as a real-time, multi-dimensional dashboard that aggregates metrics from all your S3 buckets—whether they're in a single AWS account or distributed across your entire organization.

When you enable Storage Lens, AWS begins collecting and analyzing over 28 different metrics across your buckets. These metrics fall into several categories: storage metrics tell you how much data you're storing and in which storage classes; activity metrics reveal request patterns and access frequency; and advanced metrics provide cost optimization insights and data protection details. The breadth of this data collection means you can answer complex questions about your S3 usage without running custom scripts or piecing together information from multiple sources.

The Storage Lens dashboard itself is the interface where all this data comes to life. You'll see visualizations showing your largest buckets by storage volume, trends in request counts over time, and comparisons between different AWS accounts if you're using it at the organization level. The dashboard updates daily with metrics from the previous day, giving you a consistent rhythm for monitoring your infrastructure.

S3 Storage Lens comes in two tiers: the free tier and the advanced tier. The free tier provides enough foundational metrics and a 14-day retention period to help most teams understand their basic storage patterns. It covers essential metrics like total bytes, request counts, and storage class distribution. If your organization operates at significant scale or needs deeper historical analysis, the advanced tier extends retention to 735 days (about two years), adds premium metrics for cost optimization and data protection, and enables prefix-level aggregation so you can drill down into specific folders within your buckets.

The advanced tier is particularly valuable for large organizations because it allows you to create configuration filters that focus metrics on specific account or bucket subsets. Imagine you're a platform engineering team managing S3 storage for multiple product teams. With advanced Storage Lens, you can create separate metric dashboards for each team, each filtered to show only their relevant buckets. This keeps reporting clean and accountability clear.

### S3 Inventory: Detailed Object-Level Reporting

While Storage Lens excels at high-level trends and aggregated metrics, S3 Inventory takes the opposite approach. It provides a comprehensive, detailed list of every single object in your bucket, including metadata for each one. This is your forensic tool—the place you turn when you need to know exactly which objects meet specific criteria.

S3 Inventory generates reports on a schedule you define: either daily or weekly. When the report generation runs, AWS scans your entire bucket and produces an output file (or multiple files, depending on bucket size) containing information about every object. For each object, the inventory includes the object key, size, last modified date, storage class, encryption status, and several other fields. You choose the output format—CSV, ORC, or Apache Parquet—and specify where the report should be delivered, typically to another S3 bucket.

The beauty of S3 Inventory lies in its completeness and queryability. Because the output is a structured data file, you can load it into tools like Amazon Athena and write SQL queries against it. This opens up possibilities that would be tedious or impossible with the dashboard-style Storage Lens interface.

Consider a practical scenario: your security team needs to verify that all objects in a critical bucket are encrypted with a specific customer-managed KMS key. Rather than manually checking buckets, you can configure an S3 Inventory report to include encryption metadata, load the CSV into Athena, and run a query to identify any objects that don't meet the encryption requirement. The entire process takes minutes instead of hours.

### Setting Up S3 Storage Lens

Getting started with Storage Lens is straightforward. In the AWS Management Console, navigate to the S3 service and look for the Storage Lens section. You'll create a new dashboard configuration, and the first choice is whether to collect metrics at the bucket level or the organization level. For most individual teams, bucket-level is sufficient. But if you're an AWS Organization administrator responsible for governance across multiple accounts, the organization-level dashboard provides unified visibility across everything.

Once you've selected the scope, you'll choose your tier: free or advanced. The free tier requires no additional configuration beyond enabling it. If you opt for advanced, you'll have additional options to customize exactly which metrics you want AWS to track. There's no need to monitor every metric if you don't need them; this flexibility helps keep costs reasonable.

One decision you'll need to make is whether to store aggregated metrics in a bucket, which enables the ability to query historical data directly. This is optional, but if you want to perform custom analysis beyond what the dashboard provides, having access to the raw metrics data is invaluable. AWS stores these metrics in Parquet format in a bucket you specify.

After you've created the configuration, Storage Lens begins collecting metrics immediately. The first dashboard will appear within 24 hours. From that point forward, metrics update daily, and you'll have a consistent view of your storage patterns.

### Setting Up S3 Inventory

Configuring S3 Inventory requires navigating to a specific bucket's properties and adding an inventory configuration. You'll need to specify several key details:

First, choose the destination bucket where reports will be written. This is almost always a different bucket from the source to avoid confusion and to enable proper access control and archival. If you're managing inventory reports from multiple source buckets, routing them all to a centralized reporting bucket keeps things organized.

Second, select your output format. CSV is the most straightforward and works with any analysis tool. Parquet is the most storage-efficient and queries faster in Athena. ORC is a middle ground, offering good compression and reasonable query performance. Unless you have a specific reason to use ORC, CSV or Parquet are the most common choices.

Third, configure the frequency. Daily reports provide the freshest data but generate more files and cost slightly more in terms of S3 operations. Weekly reports reduce overhead and are sufficient for most use cases where you're not chasing minute-to-minute changes in your bucket contents.

Finally, decide which object metadata fields to include. You can include basics like key, size, and last modified date, or expand to encryption details, storage class, replication status, and more. Including more fields makes reports larger but gives you richer information for analysis.

Here's a realistic example configuration for a source bucket called `company-data-lake`:

```
Inventory Name: data-lake-weekly-inventory
Source Bucket: company-data-lake
Destination Bucket: company-inventory-reports
Format: Parquet
Frequency: Weekly
Include Fields:
  - Size
  - Last Modified Date
  - Storage Class
  - ETag
  - Is Multipart Uploaded
  - Replication Status
  - Encryption Status
```

Once configured, your first inventory report will be generated according to the schedule you specified. Subsequent reports follow the same pattern, usually landing in your destination bucket within hours of the scheduled generation time.

### Querying Inventory Reports with Athena

The real power of S3 Inventory emerges when you pair it with Amazon Athena, which allows you to run SQL queries directly against data stored in S3. This transforms your static inventory reports into an interactive analytical resource.

Before you can query an inventory report, you need to set up an Athena table that understands the structure of your inventory data. If you're using Parquet format, AWS provides a pre-built CloudFormation template that automates most of this setup. For CSV-based inventories, you'll define the table schema manually, specifying each column name and data type to match your inventory output.

Once your table is created, you can write queries to answer specific questions about your bucket contents. Here are a few practical examples:

To find all objects larger than 1 GB that might be candidates for archival or deletion:

```sql
SELECT bucket, key, size
FROM s3_inventory
WHERE size > 1073741824
ORDER BY size DESC;
```

To identify all objects that haven't been accessed (last modified) in the past year:

```sql
SELECT bucket, key, last_modified_date, size
FROM s3_inventory
WHERE last_modified_date < date_format(current_date - interval '365' day, '%Y-%m-%dT%H:%i:%sZ')
ORDER BY last_modified_date ASC;
```

To check for unencrypted objects that might violate your security policy:

```sql
SELECT bucket, key, size
FROM s3_inventory
WHERE encryption_status = '' OR encryption_status IS NULL;
```

To find multipart uploads that might indicate large file activity:

```sql
SELECT bucket, key, size, is_multipart_uploaded
FROM s3_inventory
WHERE is_multipart_uploaded = 'true'
ORDER BY size DESC;
```

Each of these queries typically completes in seconds, even against inventories of hundreds of millions of objects. Athena charges based on the amount of data scanned, and because you're scanning structured data in S3 (rather than querying a database), costs are remarkably low.

### Storage Lens Metrics: What You're Actually Seeing

Understanding what S3 Storage Lens is measuring helps you interpret the dashboard correctly and draw accurate conclusions. The free tier includes metrics organized into a few core categories:

**Storage metrics** show the total bytes stored in your bucket, broken down by storage class (Standard, Standard-IA, Glacier, etc.). These metrics help you understand whether your data mix aligns with your access patterns. If you're paying for Standard storage for data you rarely access, there's likely an opportunity to transition older data to cheaper storage classes.

**Request metrics** count the number of GET, PUT, POST, and DELETE operations against your bucket. These metrics reveal whether a bucket is actively used or dormant. A bucket that receives thousands of requests per day is very different from one that receives a handful per week, and this distinction affects both performance considerations and cost optimization strategies.

**Advanced metrics**, available only in the advanced tier, include cost optimization and data protection insights. Cost optimization metrics identify candidates for lifecycle transitions, show which buckets could benefit from storage class analysis, and highlight opportunities to enable intelligent tiering. Data protection metrics reveal the percentage of encrypted objects, replication status, and whether versioning is enabled.

One of the most valuable advanced metrics is the **All Requests** metric broken down by request type. This helps you identify buckets that might be straining your API rate limits or consuming unexpected data transfer costs. If you see an unusual spike in DELETE requests, for example, you might investigate whether a data cleanup job ran unexpectedly.

### Using Storage Lens and Inventory Together for Cost Optimization

While each tool is powerful independently, they become transformative when used together. Storage Lens gives you the big picture and highlights anomalies; Inventory lets you drill into the details and identify specific objects.

Here's a realistic workflow:

You're reviewing your Storage Lens dashboard and notice that your `legacy-archive` bucket has grown significantly this month. The total storage is now 5 TB, and the bulk of it is in the Standard storage class, which costs more than Glacier. You suspect much of this data hasn't been accessed in years and could be transitioned to cheaper storage. But before you set up a lifecycle policy to transition everything to Glacier, you want to verify.

You pull the most recent Inventory report for the `legacy-archive` bucket and run an Athena query to find objects older than two years:

```sql
SELECT COUNT(*) as object_count, 
       SUM(size) as total_bytes,
       MIN(last_modified_date) as oldest_object
FROM legacy_archive_inventory
WHERE last_modified_date < date_format(current_date - interval '730' day, '%Y-%m-%dT%H:%i:%sZ')
  AND storage_class = 'STANDARD';
```

The results show 2.1 million objects totaling 4.2 TB, with the oldest object from 2019. This is the perfect candidate for transitioning to Glacier. You now have the confidence to configure a lifecycle policy that automatically moves objects to Glacier after 90 days of inactivity.

In another scenario, you're tracking data protection compliance. Storage Lens shows that your `sensitive-data` bucket has 500 GB of unencrypted objects. You need to identify which objects these are so you can apply encryption retroactively. An Athena query against the inventory reveals the specific object keys, and you can use that list to programmatically apply encryption through the AWS SDK or console.

### Storage Lens Pricing Considerations

Storage Lens is not free at scale, so understanding the pricing helps you make informed decisions. The free tier has no additional cost beyond your standard S3 storage charges. However, it's limited in scope—only 14 days of data retention and a more limited set of metrics.

The advanced tier charges based on the number of metrics monitored and the number of objects in your monitored buckets. For most organizations with thousands to millions of objects, the advanced tier costs between $50 and $200 per month, depending on scale. Given that this visibility often leads to cost savings measured in thousands of dollars through better storage class transitions and lifecycle management, the ROI is typically strong.

If you're using Storage Lens at the organization level with multiple AWS accounts, remember that the pricing applies to the entire organization, not per account. This actually makes organization-level Storage Lens more cost-effective than enabling it separately in each account.

### Inventory Costs and Considerations

S3 Inventory itself has minimal cost. You pay for the bucket operations required to generate the reports (usually negligible—a few cents per report) and for the storage of the reports themselves. Since these reports are typically compressed and archived, they rarely consume significant storage space.

The main cost consideration with Inventory is downstream: once you've generated reports and loaded them into Athena, you pay for the Athena queries you run. A single query against a Parquet-formatted inventory report might scan 100 MB of data, costing a fraction of a cent. Even if you run dozens of analytical queries per week, the costs remain extremely reasonable.

### Best Practices and Common Patterns

When implementing Storage Lens and Inventory, a few patterns emerge as particularly effective:

**Set up a centralized reporting infrastructure.** If you're managing multiple AWS accounts, create a dedicated account for reporting. Route all inventory reports to a centralized S3 bucket in that account, and set up Athena tables that reference all inventories across all accounts. This gives you a single place to run organization-wide analytical queries.

**Schedule regular reviews.** Storage Lens dashboards are most effective when you actually look at them regularly. Set a calendar reminder to review your Storage Lens dashboard weekly or biweekly, and keep an eye out for unexpected changes in metrics. A sudden spike in storage or requests often indicates something worth investigating.

**Combine Inventory with tagging.** If your objects include S3 tags, Inventory reports can include tag information. Use this to slice your queries by business unit, cost center, or data classification. This transforms Inventory from a technical tool into something that supports business and financial reporting.

**Automate responses to Inventory findings.** Once you've identified patterns through Inventory queries, automate the response. If you find thousands of unencrypted objects, write a Lambda function that encrypts them. If you find objects that should be deleted, automate the deletion rather than trying to do it manually.

**Use Storage Lens filters strategically in advanced tier.** If you're paying for advanced Storage Lens, use prefix or account filters to create focused dashboards for different teams or projects. A dashboard filtered to show only objects with a specific prefix is more actionable than trying to understand aggregate metrics for a mixed-purpose bucket.

### Limitations and When These Tools Fall Short

While Storage Lens and Inventory are powerful, understanding their limitations helps you avoid relying on them inappropriately.

Storage Lens metrics are aggregated and delayed. You won't see real-time metrics; instead, metrics update once per day. If you need minute-by-minute monitoring of bucket activity, you should use CloudWatch metrics or CloudTrail logging instead. Similarly, Storage Lens is great for trends but less useful if you need to react immediately to sudden changes.

Inventory reports have inherent staleness. If you generate an inventory report weekly, your data is always at least a few days old by the time you query it. This is fine for capacity planning and compliance auditing, but not suitable for real-time operational dashboards.

Neither tool easily answers questions about object access patterns at a granular level. If you need to know which specific objects were accessed on a specific date, you need S3 access logging or CloudTrail, not Storage Lens or Inventory. These tools tell you *how many* objects were accessed, not *which* objects.

Finally, querying large inventory reports in Athena can become expensive if done carelessly. A query that scans your entire inventory multiple times will add up in costs. Write efficient queries, partition your data intelligently (by date when possible), and consider using tools like Athena's query optimization features to keep costs under control.

### Moving Forward with Confidence

S3 Storage Lens and S3 Inventory are not exotic, cutting-edge features. They're mature, reliable tools that should be part of your standard S3 management practice. The combination of high-level dashboards and low-level detailed reporting gives you visibility that's nearly impossible to achieve any other way.

Start by enabling the free tier of Storage Lens immediately. The cost is zero, and the insight is immediate. If your organization manages significant S3 storage, invest in a few inventory reports configured for your critical buckets. Within a week, you'll have enough data to answer important questions about your infrastructure. From there, decide whether the advanced tier of Storage Lens is justified for your use case.

The strongest benefit of these tools isn't in the metrics themselves—it's in the confidence you gain that you understand your S3 infrastructure. That confidence enables better decision-making, faster troubleshooting, and ultimately, more optimized and secure storage practices.
