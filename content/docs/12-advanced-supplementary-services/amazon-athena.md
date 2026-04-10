---
title: "43. Amazon Athena"
type: docs
weight: 6
---

## Amazon Athena

Amazon Athena is a serverless, interactive query service that lets you analyze data stored in Amazon S3 using standard SQL. It exists to solve a very specific and common problem: you have large volumes of data sitting in S3 — logs, exports, event archives — and you need to query it without first loading it into a database, building an ETL pipeline, or provisioning any infrastructure. You point Athena at your S3 data, define a schema, and run SQL. You pay only for the data scanned.

This makes Athena particularly useful for ad hoc analysis, log investigation, cost reporting, and data exploration scenarios where standing up a full data warehouse would be overkill. [🔗](https://docs.aws.amazon.com/athena/latest/ug/what-is.html)

### How Athena Works

Athena is built on [Presto](https://prestodb.io/) and uses the **Glue Data Catalog** as its metastore. The catalog holds the table definitions — column names, data types, and the S3 location of the underlying data. When you run a query, Athena reads those definitions, scans the relevant S3 objects, and returns results — typically within seconds to minutes depending on data volume.

Because Athena is serverless, there are no clusters to launch or resize. Queries run in parallel automatically, and you can execute multiple queries concurrently without any capacity planning.

### Supported File Formats

Athena can query data in a variety of formats stored in S3 [🔗](https://docs.aws.amazon.com/athena/latest/ug/supported-serdes.html):

- **CSV / TSV** — simple and widely used, but inefficient for large-scale queries
- **JSON** — flexible, but also row-based and verbose
- **Avro** — row-based, good for streaming ingestion use cases
- **ORC and Parquet** — columnar formats; these are the preferred choice for performance and cost (covered below)

### Glue Data Catalog Integration

Rather than maintaining a separate metadata store, Athena uses the **AWS Glue Data Catalog** to store table and database definitions [🔗](https://docs.aws.amazon.com/athena/latest/ug/glue-athena.html). You can define tables manually in the Athena console using `CREATE TABLE` DDL, or you can use a **Glue Crawler** to automatically infer schema from your S3 data and populate the catalog.

This integration also means the same catalog is shared with other services — AWS Glue ETL jobs, Amazon EMR, and Amazon Redshift Spectrum can all reference the same table definitions, avoiding duplication of metadata.

### Partitioning for Cost Optimization

Every query in Athena is billed at **$5 per terabyte of data scanned**. If a table has years of data and you only need last week's logs, Athena will still scan everything unless you use **partitioning**.

Partitioning works by organizing S3 data into prefixes that correspond to partition keys — typically date-based (e.g., `s3://my-bucket/logs/year=2024/month=11/day=15/`). When a query includes a filter on the partition column (`WHERE year = '2024' AND month = '11'`), Athena prunes all other partitions and only scans the relevant data. This can reduce both cost and query time dramatically. [🔗](https://docs.aws.amazon.com/athena/latest/ug/partitions.html)

Partitions must be registered in the Glue Data Catalog. You can do this with `MSCK REPAIR TABLE`, by running `ALTER TABLE ADD PARTITION`, or automatically via Glue Crawlers. For high-volume pipelines, **partition projection** [🔗](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html) is a more scalable alternative — it infers partition values from a configuration rather than reading them from the catalog, which avoids metadata overhead.

### Columnar Formats: Parquet and ORC

If you have control over how data lands in S3, storing it in **Parquet** or **ORC** format is one of the highest-leverage optimizations you can make for Athena. Both are columnar, meaning Athena only reads the specific columns referenced in a query rather than entire rows. Combined with compression, this can reduce the data scanned — and therefore cost — by 60–90% compared to CSV.

- **Parquet** is widely supported across the ecosystem (Spark, Glue, Flink) and is the most common choice.
- **ORC** performs similarly and is well-suited for Hive-based pipelines.

A typical pattern is to use AWS Glue or a Lambda function to convert raw JSON or CSV data to Parquet as it arrives in S3, and point Athena at the converted data.

### Athena Workgroups

Workgroups let you isolate query execution, enforce controls, and track costs across different teams or use cases [🔗](https://docs.aws.amazon.com/athena/latest/ug/manage-queries-control-costs-with-workgroups.html). Each workgroup can have:

- A **separate query result location** in S3, so different teams write results to different buckets
- **Per-query data scanned limits** — a query that would scan more than a configured threshold is cancelled before it runs, preventing runaway costs
- **Workgroup-level cost alerts** using CloudWatch metrics
- **IAM-based access control**, so only authorized users can run queries in a given workgroup

In practice, you might have one workgroup for your data engineering team, one for a BI tool like Amazon QuickSight, and one for ad hoc developer queries — each with its own result location and scan limits.

### Cost Model

Athena charges **$5 per TB of data scanned**, rounded up to the nearest 10 MB per query, with a 10 MB minimum. DDL statements and failed queries are not charged. There is no charge for idle time since there is no infrastructure to keep running. [🔗](https://aws.amazon.com/athena/pricing/)

The practical implication is that cost optimization is entirely about reducing bytes scanned — through partitioning, columnar formats, compression, and well-written queries that select only the columns they need.

### Typical Use Cases

- **Application log analysis** — Query CloudTrail, ALB access logs, or VPC Flow Logs stored in S3 without loading them anywhere
- **Cost and usage reporting** — AWS exports Cost and Usage Reports (CUR) to S3 in a format Athena can query directly
- **Ad hoc data exploration** — Inspect CSV or JSON datasets dropped into S3 by an external process without building a pipeline
- **Feeding BI dashboards** — Connect Amazon QuickSight or other tools to Athena for self-service analytics on S3 data