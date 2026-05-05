---
title: "Macie Sensitive Data Discovery for RDS Databases and DynamoDB: Extending Beyond S3"
---

## Macie Sensitive Data Discovery for RDS Databases and DynamoDB: Extending Beyond S3

When organizations think about sensitive data discovery, many immediately picture Amazon S3 buckets. After all, that's where Amazon Macie made its name—automatically finding personally identifiable information, payment card data, and credentials lurking in cloud storage. But here's what often gets overlooked: many organizations store equally sensitive data in relational databases and NoSQL datastores that fly under the radar of typical security audits. That's where Macie's expanded capabilities come in. Over the past few years, AWS extended Macie's discovery engine to scan Amazon RDS databases and DynamoDB tables, bringing the same intelligent, automated scanning to the data stores that often contain your most critical information.

This article explores how to leverage Macie for comprehensive sensitive data discovery across your entire data landscape. We'll walk through the mechanics of setting up database scanning, understanding how Macie identifies sensitive data in structured environments, interpreting the findings, and—crucially—navigating the real-world trade-offs that come with scanning production databases.

### Why Database Scanning Matters

Before diving into the technical details, it's worth understanding why this capability exists at all. In many organizations, databases are the source of truth for customer data, financial records, and operational intelligence. Unlike S3 buckets—which often hold backups, logs, and semi-structured data—databases are actively managed, regularly accessed, and deeply integrated into application logic. Yet they're also more difficult to audit. You can't simply enable a setting and point Macie at "all databases"; instead, you need explicit network connectivity, credentials, and permissions.

The challenge is particularly acute for organizations managing multiple data stores. A company might have RDS instances in development, staging, and production environments, several DynamoDB tables handling different workloads, and legacy databases running on different database engines. Without automated discovery, understanding what sensitive data actually exists across these systems requires manual effort—querying schema, reviewing column names, and often making educated guesses.

Macie changes this equation. By scanning the actual structure and, in some cases, sampling the contents of your databases, it can identify sensitive information patterns and alert you to tables and columns that require special handling, encryption, or access controls. For many organizations, this is the difference between a vague awareness that sensitive data exists somewhere and a concrete, actionable inventory of what needs protection.

### Supported Data Stores and Engines

Macie's database scanning isn't universal across all AWS data services, so understanding what's supported is the first practical step. On the relational database side, Macie works with Amazon RDS instances running MySQL, PostgreSQL, Oracle, and SQL Server. This covers the majority of traditional relational workloads in AWS. If you're running an RDS instance with one of these engines, Macie can scan it.

For NoSQL, Macie supports Amazon DynamoDB tables. This is particularly valuable because DynamoDB's flexible schema makes it easy to accidentally store sensitive data in attributes without proper governance. Unlike RDS databases with their fixed schema and explicit column names, DynamoDB's document-oriented nature can obscure what data actually lives in your tables.

It's important to note what Macie doesn't support. Amazon Aurora (though built on MySQL or PostgreSQL engines) works through standard RDS APIs, so the distinction is mainly academic. However, other data stores like Amazon Redshift, Elasticache, DocumentDB, and managed Cassandra environments fall outside Macie's current scope. If you need sensitive data discovery across those services, you'll need alternative approaches—typically a combination of custom scripts, third-party tools, or manual audits.

### Setting Up Database Discovery Jobs: Prerequisites and Network Connectivity

Creating a Macie discovery job for a database is more involved than initiating an S3 scan. S3 is integrated into the AWS API plane; Macie has native permission to list buckets and read objects through IAM. Databases, by contrast, are typically isolated in VPCs, protected by security groups, and accessed through database-specific protocols. Before Macie can scan anything, you need to establish connectivity.

For RDS instances, this means the Macie service needs a network path to your database. In most production environments, RDS instances live in private subnets within your VPC, with no public internet access. Macie, as an AWS-managed service, doesn't have persistent compute resources you can "place" in your VPC the way you might deploy an EC2 instance. Instead, AWS Macie uses a service-linked role and communicates with your RDS instance through a VPC endpoint or, less ideally, by routing through a bastion host or VPN tunnel.

The practical implication is this: if your RDS instance is in a private subnet, you have a few options. One approach is to temporarily allow inbound traffic from Macie's service security group or from a specific CIDR range to your database security group. AWS documentation provides the specific security group IDs for each region. A more robust approach is to create a custom VPC endpoint that Macie can use to reach your database without exposing it to the broader internet.

DynamoDB is somewhat simpler because it's a fully managed service with no traditional network isolation. You don't need to worry about VPC routing or security groups in the same way. However, you still need to ensure Macie has the appropriate IAM permissions.

Speaking of permissions, both RDS and DynamoDB require that Macie can authenticate. For RDS, this means creating database user accounts with appropriate read-level permissions. For MySQL and PostgreSQL, you'd typically create a user with SELECT and SHOW privileges on the schemas and tables you want to scan. For Oracle and SQL Server, the principles are similar—a read-only account with visibility into the structure and contents of the target data.

Here's a practical example for PostgreSQL:

```sql
CREATE USER macie_scanner WITH PASSWORD 'strong_random_password';
GRANT CONNECT ON DATABASE your_database TO macie_scanner;
GRANT USAGE ON SCHEMA public TO macie_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO macie_scanner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO macie_scanner;
```

This user can read table structures and sample data but cannot modify anything—a principle of least privilege applied to database scanning. You'd store these credentials securely, typically in AWS Secrets Manager, and reference them when configuring the Macie discovery job.

For DynamoDB, the permission model is IAM-based. Macie needs an IAM role with permissions to describe table metadata and, depending on sampling settings, to read item data. A minimal policy would grant `dynamodb:DescribeTable`, `dynamodb:ListTables`, and `dynamodb:GetItem` or `dynamodb:Scan` on the target tables.

### How Macie Analyzes Database Structure and Content

Once connectivity and authentication are in place, Macie's discovery process unfolds in stages. First, it connects to your database and enumerates the schema—for RDS, this means listing tables and columns; for DynamoDB, it means identifying table names and their attribute structures.

This schema enumeration is where Macie's intelligent naming analysis kicks in. Macie maintains a vast library of patterns associated with sensitive data types: column names like `ssn`, `credit_card_number`, `password`, `api_key`, and `auth_token` are obvious red flags, but Macie also recognizes variations and contextual clues. A column named `customer_id` in a customers table is different from `customer_id` in a transaction log, and Macie's analysis accounts for this context.

Beyond naming, Macie examines data types. A column typed as `text` or `varchar` containing what looks like a 16-digit number in a regular payment card pattern is suspicious. A numeric column with dates that align to birth dates is a signal. These heuristics, combined with machine learning models trained on millions of real-world datasets, help Macie identify sensitive data without being told explicitly, "this column contains credit card numbers."

The second phase of analysis involves sampling actual data. Here's where things get pragmatic. Macie doesn't read your entire database. Instead, it samples rows from each table—the exact number depends on your configuration, but typically it's enough to identify patterns without imposing excessive load. For very large tables, this sampling is crucial; scanning a billion-row transaction log would be prohibitive, but sampling tens of thousands of rows usually captures the patterns present in the full dataset.

For DynamoDB specifically, Macie uses the Scan operation, but with limits to prevent scanning your entire table and incurring massive read capacity units. You configure a sampling limit—say, 100MB of scanned data per table—and Macie respects that boundary. This makes Macie practical even for production DynamoDB tables, though as we'll discuss, there are still performance considerations.

The analysis produces findings that categorize sensitive data by type: personally identifiable information (names, addresses, dates of birth), financial data (credit card numbers, bank account numbers), credentials (passwords, API keys, access tokens), and custom patterns you've defined within your organization. For each finding, Macie reports which tables and columns contain the sensitive data, how many instances were detected, and the confidence level of the detection.

### Interpreting Macie Findings for Databases

When you review Macie findings for an RDS database, the report structure differs slightly from S3 findings. Instead of reporting findings organized by bucket and object, database findings are organized by table and column. A report might indicate that the `customers` table has a `ssn` column with high confidence of containing personally identifiable information, or that the `users` table's `password` column contains plaintext credentials.

These findings are actionable starting points. If Macie identifies a column named `password` with high-entropy string values, that's a strong signal that credentials are stored in plaintext—a serious security issue requiring immediate remediation, whether through encryption, hashing, or architectural redesign.

However, it's crucial to remember that Macie findings require human judgment. A column named `address` containing what looks like text data might be legitimate customer address information (sensitive, but appropriate for a customer database), or it might be unstructured free-text data you didn't realize was there. Macie surfaces these findings; your security and data governance teams interpret their significance.

False positives are inevitable. A column containing sequences that match a credit card regex pattern might actually be random identifiers used internally. A date column with values matching birth date patterns might be completely innocuous. The confidence scores Macie assigns help separate likely true positives from marginal cases, but they're not deterministic.

This is where DynamoDB scanning adds complexity. Unlike RDS tables with fixed schemas, DynamoDB items can have arbitrary attributes. Macie scans attribute names and sampled values, looking for patterns. You might have a DynamoDB table where some items contain `user_pii` and others don't, or where sensitive data is nested multiple levels deep in a JSON structure. Macie's findings for DynamoDB reflect this complexity, reporting attributes rather than columns, and sometimes flagging entire items as suspicious based on their structure.

### Understanding Limitations and Trade-offs

The expanded database scanning capability is powerful, but it comes with real constraints that organizations need to understand upfront.

Performance impact is the first and most obvious limitation. When Macie scans an RDS database, it's running SELECT queries against your tables. Even with sampling, these queries consume CPU, I/O, and potentially network resources. On a lightly used development database, this is usually negligible. On a production database running high-volume transactional workloads, introducing additional I/O and lock contention can cause problems. This is why the best practice—which we'll explore more in the next section—is to schedule discovery jobs during maintenance windows when production impact is minimized.

For DynamoDB, the limitation is read capacity units. Scanning a table consumes read capacity, and for large tables, even with sampling, the RCU consumption can be significant. A table consuming 1,000 RCUs during normal operation might see spikes if Macie initiates a scan during peak hours. AWS Macie does implement backpressure and rate limiting to prevent completely overwhelming a table, but you still need to account for this.

The second major limitation is sampling bias. Macie can't inspect every row, so if sensitive data is concentrated in specific rows or follows patterns that don't appear in the sample, Macie might miss it. For example, if your database has a million users, and sensitive data only appears in recently added rows, Macie's random sampling might not capture those rows. This isn't a flaw in Macie; it's a fundamental constraint of working with large datasets. The practical implication is that Macie findings are "known sensitive data" but the absence of findings doesn't mean sensitive data isn't present.

Schema and sampling limits also apply to large tables. If a single table is exceptionally wide—say, hundreds of columns—Macie focuses on analyzing the most relevant columns based on naming heuristics. Similarly, very wide items in DynamoDB might be sampled partially rather than in their entirety. This design choice keeps the scanning process tractable but means some data might not be thoroughly inspected.

There's also the matter of encryption at rest. If you've encrypted your RDS database using AWS KMS or if your DynamoDB table uses encryption at rest, Macie can still read the decrypted data during analysis. But if you've implemented application-level encryption—encrypting values within the database before storing them—Macie sees ciphertext and can't analyze the underlying sensitive data. In some ways, this is good (it means your encryption is working), but it also means Macie's effectiveness is limited to data it can actually read.

Finally, there's the question of data residency and compliance. When Macie scans your database, it reads data into the Macie service for analysis. This data is processed and typically discarded, but the act of reading customer or regulated data outside of its intended boundary can raise compliance concerns in some organizations. If you're subject to data localization requirements or have agreements restricting where data can be read, database scanning might require additional review or approval.

### Best Practices for Safe and Effective Database Scanning

Given these constraints, the following practices help ensure Macie database scanning is effective and safe.

**Schedule during maintenance windows.** This is foundational. Coordinate with your database and operations teams to run discovery jobs during periods of low or no production traffic. Many organizations implement weekly or monthly scans during scheduled maintenance windows. AWS Macie allows you to define schedules for recurring discovery jobs, so once you've configured a job, you can automate the timing entirely. This reduces operational overhead and ensures scanning happens when impact is tolerated.

**Use dedicated read-only accounts.** Create database accounts specifically for Macie scanning, with the minimum necessary permissions. Don't reuse general-purpose service accounts or admin credentials. This principle of least privilege limits the blast radius if credentials are accidentally exposed and makes your audit logs clearer—you can specifically track what Macie accessed versus other services.

**Test in non-production environments first.** Before scanning a critical production database, run your Macie jobs against development or staging databases with similar structure and volume. This lets you understand the performance impact, validate the network connectivity and credentials work, and review the kinds of findings Macie generates in your specific environment. It's also an excellent way to calibrate sampling parameters and understand false positive rates before they affect production.

**Implement appropriate IAM policies.** Use resource-based IAM policies to restrict which Macie service principals can access which databases. While Macie is an AWS-managed service you're invoking through your own account, AWS accounts have multiple principals and roles. Explicitly granting Macie access to specific RDS instances or DynamoDB tables ensures that compromise of one account component doesn't automatically grant Macie access throughout your infrastructure.

**Monitor Macie job execution.** AWS CloudWatch and AWS CloudTrail both capture Macie discovery job activity. Set up CloudWatch alarms to notify you if a discovery job fails—perhaps because credentials have changed or network connectivity has degraded. Logging and monitoring help you catch issues quickly and maintain an audit trail of what Macie has scanned and when.

**Address findings promptly.** Macie generates findings, but findings without action are merely data. Establish a process for triaging findings, determining whether they represent genuine sensitive data that needs protection, and planning remediation. Some organizations integrate Macie findings into ticketing systems or security dashboards, ensuring findings get reviewed and aren't lost in the noise.

**Consider impact on scaling systems.** If you use auto-scaling for RDS read replicas or DynamoDB autoscaling, be aware that Macie's scanning load might trigger scaling events. This can be expensive (read replicas and autoscaled capacity incur costs) and might cause cascading performance issues if scaling thresholds are too aggressive. Consider temporarily adjusting scaling policies or disabling autoscaling during planned Macie scans.

### Practical Setup Example

Let's walk through a concrete example of setting up Macie scanning for an RDS PostgreSQL database. Assume you have an RDS PostgreSQL instance named `prod-customers-db` in the `us-east-1` region containing customer and transaction data, and you want Macie to scan it for sensitive information.

First, you'd create a database user for Macie:

```sql
CREATE USER macie_scanner WITH PASSWORD 'GenerateSecureRandomPassword123!';
GRANT CONNECT ON DATABASE customer_db TO macie_scanner;
GRANT USAGE ON SCHEMA public TO macie_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO macie_scanner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO macie_scanner;
```

Next, you'd store these credentials in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name macie/rds/prod-customers-db \
  --secret-string '{"username":"macie_scanner","password":"GenerateSecureRandomPassword123!"}' \
  --region us-east-1
```

Then, you'd ensure the RDS security group allows inbound connections from Macie. Look up the Macie service security group for your region in AWS documentation, and add an inbound rule:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --source-group sg-macie-service-sg-us-east-1 \
  --region us-east-1
```

Finally, you'd navigate to the Macie console, create a new discovery job, select the RDS database as the data source, reference your Secrets Manager secret for credentials, configure sampling parameters (e.g., sample 100 MB of data per table), set a schedule (e.g., weekly on Sundays at 2 AM), and save the job. Macie would then execute the job on your schedule, and findings would appear in the Macie dashboard and can be exported for further analysis.

### DynamoDB Scanning Specifics

While the general workflow is similar for DynamoDB, there are some important differences. DynamoDB tables don't have usernames and passwords; instead, Macie uses the IAM role or credentials configured for the Macie service. This means you're relying on IAM permissions rather than database-level credentials.

A typical IAM policy for Macie to scan a DynamoDB table might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:ListTables"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/customers",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    }
  ]
}
```

This policy grants Macie the ability to describe tables and list them, but restricts actual data reading (GetItem and Scan) to a specific table. When you create the Macie discovery job for DynamoDB, you specify the table(s) to scan, and Macie respects the IAM permissions defined in the role you've configured.

For DynamoDB, the sampling considerations are slightly different. Instead of a time-based sampling (scanning for a duration), you configure a data size limit. Macie might scan up to 100 MB of your DynamoDB table, regardless of the number of items. For a table with small items, this might mean scanning thousands of items; for a table with very large items, it might be far fewer. Understanding this helps set realistic expectations about coverage.

### Interpreting and Acting on DynamoDB Findings

DynamoDB findings are often more ambiguous than RDS findings because of the flexibility of the NoSQL model. An RDS finding saying "the `password` column contains plaintext credentials" is clear-cut. A DynamoDB finding saying "attribute named `config` sometimes contains API credentials" requires more interpretation—does the `config` attribute legitimately contain configuration including credentials? Is this an architectural choice you've made, or an oversight?

DynamoDB findings often highlight attributes you weren't explicitly aware of. Items in a DynamoDB table might have attributes added over time by different teams or services, and a Macie scan can surface dormant or experimental attributes containing sensitive data. This informational value—understanding what actually exists in your tables—is one of Macie's key contributions for DynamoDB.

### Integrating Macie Findings into Your Security Program

Macie is one component of a broader data protection and security program. The findings it generates should integrate into your existing workflows and tools.

Many organizations route Macie findings to Amazon EventBridge, enabling automated or semi-automated responses. A finding might trigger a Lambda function that creates a ticket in your security ticketing system, posts a notification to a Slack channel, or even initiates automated remediation for certain classes of findings.

For compliance and audit purposes, Macie findings can be exported and archived in S3 or analyzed using Amazon Athena. This supports audit trails required by frameworks like HIPAA, PCI DSS, or GDPR.

The combination of Macie findings across S3, RDS, and DynamoDB builds a comprehensive inventory of sensitive data in your AWS environment. Organizations often use this inventory to drive security improvements: implementing encryption, restricting access, implementing data masking, or redesigning applications to minimize sensitive data exposure.

### Conclusion

Amazon Macie's expansion beyond S3 to include RDS databases and DynamoDB tables brings automated sensitive data discovery to the data stores where information is most actively used and, often, most critical. By automating the discovery of personally identifiable information, payment card data, credentials, and other sensitive information across these systems, Macie helps organizations move from vague awareness to concrete inventory and actionable findings.

The capability comes with real considerations: network connectivity requirements, performance impact on production systems, sampling limitations, and the need for human judgment in interpreting findings. But when deployed thoughtfully—using read-only credentials, scheduling during maintenance windows, and integrating findings into your security workflows—Macie becomes an essential tool for organizations serious about data protection and compliance.

As you begin implementing Macie database scanning in your environment, start small, test thoroughly in non-production systems, and scale carefully. The insights you gain will likely reveal surprising stores of sensitive data and provide a foundation for meaningful security improvements across your entire data landscape.
