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

{{< qcm >}}
[
{
"question": "A company stores years of application logs in Amazon S3. A developer needs to run occasional SQL queries against this data without provisioning any infrastructure. Which AWS service is best suited for this requirement?",
"answers": [
{
"answer": "Amazon Athena",
"isCorrect": true,
"explanation": "Athena is a serverless interactive query service that lets you run SQL directly against S3 data with no infrastructure to manage. It is ideal for ad hoc queries on S3-stored data."
},
{
"answer": "Amazon Redshift",
"isCorrect": false,
"explanation": "Redshift requires provisioning a cluster (or using Serverless), making it more appropriate for a persistent data warehouse workload rather than occasional ad hoc queries on raw S3 data."
},
{
"answer": "AWS Glue ETL",
"isCorrect": false,
"explanation": "Glue ETL is used to transform and move data, not to interactively query it with SQL."
},
{
"answer": "Amazon EMR",
"isCorrect": false,
"explanation": "EMR can run SQL-like queries but requires provisioning and managing a cluster, which contradicts the no-infrastructure requirement."
}
]
},
{
"question": "What query engine is Amazon Athena built on?",
"answers": [
{
"answer": "Apache Spark",
"isCorrect": false,
"explanation": "Apache Spark is a separate distributed compute engine. While Athena now supports a Spark-based notebook experience, the core SQL query engine is Presto."
},
{
"answer": "Presto",
"isCorrect": true,
"explanation": "Athena's interactive SQL query engine is built on Presto, an open-source distributed SQL query engine designed for fast analytics on large datasets."
},
{
"answer": "Apache Hive",
"isCorrect": false,
"explanation": "Athena uses Hive-compatible DDL syntax and can read Hive-partitioned data, but its query engine is Presto, not Hive."
},
{
"answer": "Apache Flink",
"isCorrect": false,
"explanation": "Flink is a stream-processing engine, not the basis for Athena's SQL query execution."
}
]
},
{
"question": "Which service does Amazon Athena use as its metastore to store table definitions and schema information?",
"answers": [
{
"answer": "AWS Glue Data Catalog",
"isCorrect": true,
"explanation": "Athena uses the AWS Glue Data Catalog as its metastore. Table definitions, column types, and S3 data locations are stored there and shared with other services like EMR and Redshift Spectrum."
},
{
"answer": "Amazon DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is a NoSQL key-value/document database and is not used by Athena as a metastore."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "RDS is a managed relational database service. Athena does not use RDS to store its catalog metadata."
},
{
"answer": "AWS Lake Formation",
"isCorrect": false,
"explanation": "Lake Formation sits on top of the Glue Data Catalog and adds fine-grained access control, but the underlying metastore Athena reads from is the Glue Data Catalog itself."
}
]
},
{
"question": "A data engineering team wants to automate schema discovery for files landing in S3 and populate the Glue Data Catalog without writing DDL manually. Which approach should they use?",
"answers": [
{
"answer": "AWS Glue Crawler",
"isCorrect": true,
"explanation": "A Glue Crawler automatically inspects S3 data, infers the schema, and registers table definitions in the Glue Data Catalog, eliminating the need to write CREATE TABLE statements manually."
},
{
"answer": "MSCK REPAIR TABLE",
"isCorrect": false,
"explanation": "MSCK REPAIR TABLE registers existing partitions for a table already defined in the catalog. It does not discover or create table schemas from scratch."
},
{
"answer": "ALTER TABLE ADD PARTITION",
"isCorrect": false,
"explanation": "This command manually adds a specific partition to an existing table definition. It does not automate schema discovery."
},
{
"answer": "AWS Lambda function with PutItem to DynamoDB",
"isCorrect": false,
"explanation": "Athena does not use DynamoDB as a catalog. Schema must be registered in the Glue Data Catalog."
}
]
},
{
"question": "Amazon Athena charges $5 per terabyte of data scanned. A query scans only 3 MB of data. How much data will the customer be billed for?",
"answers": [
{
"answer": "3 MB",
"isCorrect": false,
"explanation": "Athena has a minimum billing unit of 10 MB per query, so 3 MB of actual data scanned is still billed as 10 MB."
},
{
"answer": "10 MB",
"isCorrect": true,
"explanation": "Athena rounds up to the nearest 10 MB with a minimum of 10 MB per query. Even if only 3 MB is scanned, you are billed for 10 MB."
},
{
"answer": "1 GB",
"isCorrect": false,
"explanation": "Athena does not have a 1 GB minimum. The minimum billing unit is 10 MB per query."
},
{
"answer": "Nothing — queries under 1 MB are free",
"isCorrect": false,
"explanation": "There is no free tier based on data scanned. The minimum charge is 10 MB per query (except for DDL statements and failed queries, which are not charged)."
}
]
},
{
"question": "Which of the following Athena queries will NOT be charged?",
"answers": [
{
"answer": "A SELECT query that returns zero rows",
"isCorrect": false,
"explanation": "A SELECT query that scans data but returns no rows still incurs a data-scanned charge."
},
{
"answer": "A CREATE TABLE DDL statement",
"isCorrect": true,
"explanation": "DDL statements such as CREATE TABLE, DROP TABLE, and ALTER TABLE are not charged in Athena."
},
{
"answer": "A failed query due to a syntax error",
"isCorrect": true,
"explanation": "Failed queries are not charged. If Athena cannot execute a query, no data-scanned fee is applied."
},
{
"answer": "A SELECT query that scans 500 MB of Parquet data",
"isCorrect": false,
"explanation": "Any successful SELECT query that scans data is billed at $5 per TB, regardless of the file format."
}
]
},
{
"question": "A developer is running Athena queries against a table that contains three years of daily log files in S3. Queries always filter on a specific date range but Athena scans all the data each time, resulting in high costs. What is the MOST effective solution?",
"answers": [
{
"answer": "Convert the files to JSON format",
"isCorrect": false,
"explanation": "JSON is a row-based format and does not reduce the data scanned when filtering by date. It would not address the cost problem."
},
{
"answer": "Partition the S3 data by date and update the query to filter on the partition columns",
"isCorrect": true,
"explanation": "Partitioning organizes data into S3 prefixes by partition key (e.g., year/month/day). Athena prunes irrelevant partitions when the query includes a filter on those columns, dramatically reducing data scanned and cost."
},
{
"answer": "Increase the Athena workgroup query scan limit",
"isCorrect": false,
"explanation": "The scan limit cancels queries that exceed a threshold; it does not reduce the amount of data scanned or lower cost."
},
{
"answer": "Run the queries during off-peak hours",
"isCorrect": false,
"explanation": "Athena pricing is based on data scanned, not time of day. Running queries at night does not reduce cost."
}
]
},
{
"question": "A partitioned Athena table was updated with new S3 objects following the existing Hive-style partition layout. Queries against the new partitions return no data. Which commands can be used to register the new partitions in the Glue Data Catalog? (Select TWO)",
"answers": [
{
"answer": "MSCK REPAIR TABLE",
"isCorrect": true,
"explanation": "MSCK REPAIR TABLE scans the S3 location of the table and automatically adds any new Hive-compatible partitions found to the Glue Data Catalog."
},
{
"answer": "ALTER TABLE ADD PARTITION",
"isCorrect": true,
"explanation": "ALTER TABLE ADD PARTITION explicitly registers one or more specific partitions in the catalog, giving you precise control over which partitions are added."
},
{
"answer": "CREATE TABLE AS SELECT",
"isCorrect": false,
"explanation": "CTAS creates a new table from query results. It does not register partitions in an existing table's metadata."
},
{
"answer": "DROP TABLE and recreate it",
"isCorrect": false,
"explanation": "Dropping and recreating the table would lose all existing partition metadata and is not the recommended approach for adding new partitions."
}
]
},
{
"question": "A team manages an Athena table with thousands of date-based partitions that grows continuously. They observe that queries are slow to start because Athena spends significant time reading partition metadata from the Glue Data Catalog. What feature can eliminate this overhead?",
"answers": [
{
"answer": "Athena Workgroups",
"isCorrect": false,
"explanation": "Workgroups provide cost controls and result isolation but do not address the performance overhead of reading partition metadata from the catalog."
},
{
"answer": "Partition Projection",
"isCorrect": true,
"explanation": "Partition projection allows Athena to infer partition values from a configuration (e.g., a date range and format) rather than querying the Glue Data Catalog. This eliminates metadata lookup overhead and scales much better for high-cardinality partition sets."
},
{
"answer": "Converting data to CSV format",
"isCorrect": false,
"explanation": "CSV is a row-based format and would actually increase data scanned. It has no impact on partition metadata overhead."
},
{
"answer": "Increasing the Glue Crawler frequency",
"isCorrect": false,
"explanation": "Running the crawler more often keeps the catalog up to date but does not reduce the time Athena spends reading partition metadata at query time."
}
]
},
{
"question": "Which file formats should a developer choose when storing data in S3 to minimize Athena query costs and maximize performance? (Select TWO)",
"answers": [
{
"answer": "CSV",
"isCorrect": false,
"explanation": "CSV is row-based and uncompressed by default. Athena must scan entire rows even when only a few columns are needed, making it inefficient and expensive for large datasets."
},
{
"answer": "Parquet",
"isCorrect": true,
"explanation": "Parquet is a columnar format. Athena reads only the columns referenced in the query, and combined with compression, it can reduce data scanned by 60–90% compared to CSV."
},
{
"answer": "JSON",
"isCorrect": false,
"explanation": "JSON is row-based and verbose. It does not support column pruning, so Athena must read entire records even for single-column queries."
},
{
"answer": "ORC",
"isCorrect": true,
"explanation": "ORC is also a columnar format with compression, offering similar cost and performance benefits to Parquet. It is particularly well-suited for Hive-based pipelines."
},
{
"answer": "Avro",
"isCorrect": false,
"explanation": "Avro is a row-based format optimized for streaming ingestion, not analytical queries. It does not provide the column-pruning benefits of Parquet or ORC."
}
]
},
{
"question": "A company stores raw event data as JSON in S3. A developer wants to reduce Athena query costs by 80%. What is the MOST effective transformation to apply before querying with Athena?",
"answers": [
{
"answer": "Compress the JSON files with gzip",
"isCorrect": false,
"explanation": "Compression reduces file size and can help, but JSON remains row-based. Athena still scans every field in a row even when only a few columns are needed, limiting the savings compared to columnar formats."
},
{
"answer": "Convert the JSON files to Parquet using AWS Glue or Lambda",
"isCorrect": true,
"explanation": "Converting to Parquet (or ORC) enables column pruning — Athena only reads the columns referenced in the query — and compression, which together can reduce data scanned by 60–90%, achieving the target cost reduction."
},
{
"answer": "Split the JSON files into smaller files",
"isCorrect": false,
"explanation": "Splitting files can improve parallelism slightly but does not reduce the total bytes scanned. It does not provide meaningful cost reduction on its own."
},
{
"answer": "Move the data from S3 to Amazon EFS so Athena can access it faster",
"isCorrect": false,
"explanation": "Athena only queries data stored in Amazon S3. It cannot query data in Amazon EFS."
}
]
},
{
"question": "A company has three teams — data engineering, BI analysts using Amazon QuickSight, and developers doing ad hoc exploration — all using Amazon Athena. The platform team wants to ensure each team's query results are stored separately, costs are tracked per team, and runaway queries are prevented. What Athena feature addresses these requirements?",
"answers": [
{
"answer": "Separate Athena tables per team",
"isCorrect": false,
"explanation": "Separate tables control data access, not query result storage, cost attribution, or per-query scan limits."
},
{
"answer": "Athena Workgroups",
"isCorrect": true,
"explanation": "Workgroups allow separate S3 result locations per team, per-query data-scanned limits to prevent runaway queries, CloudWatch-based cost alerts, and IAM-based access control — covering all stated requirements."
},
{
"answer": "AWS Cost Explorer tags",
"isCorrect": false,
"explanation": "Cost Explorer can help visualize costs after the fact but cannot enforce per-query scan limits or isolate query result locations."
},
{
"answer": "S3 bucket policies",
"isCorrect": false,
"explanation": "S3 bucket policies control access to S3 objects but do not provide Athena-level query cost controls or per-query scan limits."
}
]
},
{
"question": "Which of the following AWS services can share the same table definitions stored in the AWS Glue Data Catalog with Amazon Athena? (Select TWO)",
"answers": [
{
"answer": "Amazon EMR",
"isCorrect": true,
"explanation": "Amazon EMR can read table definitions from the Glue Data Catalog, allowing it to work with the same tables and schemas already defined for Athena."
},
{
"answer": "Amazon Redshift Spectrum",
"isCorrect": true,
"explanation": "Redshift Spectrum can reference the Glue Data Catalog to query S3 data using the same table definitions as Athena, avoiding duplication of metadata."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "Amazon RDS manages its own schema internally and does not integrate with the Glue Data Catalog."
},
{
"answer": "Amazon ElastiCache",
"isCorrect": false,
"explanation": "ElastiCache is an in-memory caching service and has no integration with the Glue Data Catalog."
}
]
},
{
"question": "A developer wants to enforce that no single Athena query in a workgroup can scan more than 1 GB of data, in order to protect against accidental full-table scans. How should this be configured?",
"answers": [
{
"answer": "Set a per-query data scanned limit in the Athena workgroup configuration",
"isCorrect": true,
"explanation": "Athena workgroups support per-query data-scanned limits. If a query would exceed the configured threshold, it is cancelled before execution, preventing runaway costs."
},
{
"answer": "Add a LIMIT clause to every query",
"isCorrect": false,
"explanation": "LIMIT restricts the number of rows returned but does not limit the amount of data scanned. Athena may still scan the full dataset before applying the row limit."
},
{
"answer": "Create an S3 bucket policy that denies reads larger than 1 GB",
"isCorrect": false,
"explanation": "S3 bucket policies cannot limit data scanned per query. This is not a valid mechanism for controlling Athena scan costs."
},
{
"answer": "Enable AWS Budgets with a $5 alert",
"isCorrect": false,
"explanation": "AWS Budgets can send alerts when costs are exceeded but cannot proactively cancel an individual query before it scans too much data."
}
]
},
{
"question": "An AWS Cost and Usage Report (CUR) is automatically exported to an S3 bucket. A finance team wants to query this data using SQL without building any ETL pipeline. What is the recommended solution?",
"answers": [
{
"answer": "Load the CUR data into Amazon RDS and query it with a BI tool",
"isCorrect": false,
"explanation": "Loading data into RDS requires an ETL pipeline and ongoing infrastructure management, which contradicts the no-ETL requirement."
},
{
"answer": "Use Amazon Athena to query the CUR data directly from S3",
"isCorrect": true,
"explanation": "AWS Cost and Usage Reports are exported to S3 in a format that Athena can query directly. This is a documented and common use case that requires no ETL or additional infrastructure."
},
{
"answer": "Use AWS Glue ETL to transform the CUR data and load it into Redshift",
"isCorrect": false,
"explanation": "This approach involves building an ETL pipeline and provisioning a data warehouse, contradicting the no-ETL requirement."
},
{
"answer": "Enable Amazon QuickSight SPICE to import the CUR data",
"isCorrect": false,
"explanation": "SPICE imports data into QuickSight's in-memory store, which involves a data ingestion step. The simpler approach is to connect QuickSight to Athena, which queries the S3 data directly."
}
]
},
{
"question": "A developer writes an Athena query that selects only 2 out of 50 columns from a large table. Which file format stored in S3 will result in the LEAST data scanned?",
"answers": [
{
"answer": "CSV",
"isCorrect": false,
"explanation": "CSV is row-based. Athena must read entire rows to extract any column, meaning all 50 columns worth of data are scanned even when only 2 are needed."
},
{
"answer": "JSON",
"isCorrect": false,
"explanation": "JSON is also row-based. Like CSV, Athena reads full records and cannot skip unreferenced columns, resulting in high data scanned."
},
{
"answer": "Parquet",
"isCorrect": true,
"explanation": "Parquet is columnar. Athena reads only the 2 referenced columns from disk, skipping the other 48. This column pruning dramatically reduces data scanned compared to row-based formats."
},
{
"answer": "Avro",
"isCorrect": false,
"explanation": "Avro is row-based and optimized for streaming ingestion. It does not support column pruning, so Athena reads full rows regardless of how many columns are selected."
}
]
},
{
"question": "Which of the following are valid use cases for Amazon Athena? (Select THREE)",
"answers": [
{
"answer": "Querying VPC Flow Logs stored in S3 to investigate network traffic",
"isCorrect": true,
"explanation": "Application and service logs (CloudTrail, VPC Flow Logs, ALB access logs) stored in S3 are a primary Athena use case. No pipeline is needed — you define a table and query directly."
},
{
"answer": "Running transactional INSERT and UPDATE operations on customer records",
"isCorrect": false,
"explanation": "Athena is an analytical query service designed for read-heavy SQL queries on S3 data. It is not designed for OLTP transactional workloads with frequent INSERT/UPDATE operations."
},
{
"answer": "Feeding Amazon QuickSight dashboards with analytics on S3 data",
"isCorrect": true,
"explanation": "QuickSight can connect directly to Athena as a data source, enabling self-service BI dashboards powered by S3 data without loading it into a separate database."
},
{
"answer": "Ad hoc exploration of CSV files dropped into S3 by an external vendor",
"isCorrect": true,
"explanation": "Athena excels at ad hoc data exploration. You can define a table over the vendor's CSV files in S3 and immediately start querying without building any pipeline."
},
{
"answer": "Serving low-latency API responses to a mobile application",
"isCorrect": false,
"explanation": "Athena query latency ranges from seconds to minutes depending on data volume. It is not suitable for serving sub-millisecond API responses to end users."
}
]
}
]
{{< /qcm >}}