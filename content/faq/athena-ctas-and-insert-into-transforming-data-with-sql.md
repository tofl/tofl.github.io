---
title: "Athena CTAS and INSERT INTO: Transforming Data with SQL"
---

## Athena CTAS and INSERT INTO: Transforming Data with SQL

Data transformation is the bread and butter of any analytics workflow, but setting up a full-fledged ETL pipeline can feel like overkill when you just need to convert some CSV files to Parquet or filter a dataset. Amazon Athena offers a surprisingly elegant solution: you can write standard SQL queries that don't just analyze data, but actually write the results back to Amazon S3 in optimized formats. This approach—powered by CREATE TABLE AS SELECT (CTAS) and INSERT INTO statements—gives you lightweight, serverless data transformation without the overhead of traditional ETL tools.

In this article, we'll explore how to use these SQL statements in Athena to build efficient data pipelines, understand their constraints and best practices, and learn when they make sense as an alternative to more heavyweight solutions like AWS Glue.

### Understanding CTAS: Create, Transform, Store in One Statement

CREATE TABLE AS SELECT is one of Athena's most powerful features. Instead of creating an empty table schema and then loading data into it separately, CTAS lets you define a table, query some data, and write the results to S3 all in a single statement.

Here's a simple example. Imagine you have CSV files sitting in S3 containing sales data:

```sql
CREATE TABLE sales_parquet
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/transformed/sales/'
)
AS SELECT
  order_id,
  customer_id,
  order_date,
  amount
FROM csv_sales
WHERE order_date >= '2024-01-01';
```

This statement does several things at once. It reads from the `csv_sales` table (which Athena's Glue Catalog already knows how to parse as CSV), applies a filter for orders from 2024 onward, and writes the results as Parquet files to the specified S3 location. The new table `sales_parquet` becomes immediately queryable, and you've automatically converted your data to a columnar format that's more efficient for analytics queries.

The real value of CTAS becomes apparent when you're dealing with large datasets or complex transformations. Instead of writing data to a staging area and then processing it elsewhere, you can do the transformation in-place using SQL you already know.

### Why Format Conversion Matters

You might wonder why format conversion is such a big deal. CSV is human-readable and easy to work with, so what's the catch? The issue is efficiency. When Athena queries a CSV file, it has to parse every single row and column, even if you only need a handful of columns. CSV is also row-oriented, meaning data for a single row is scattered across the file sequentially.

Parquet, by contrast, is a columnar format. All values for a given column are stored together, which means Athena can skip entire columns if your query doesn't need them. On top of that, Parquet supports compression out of the box, so your files take up less space on S3. For a dataset with hundreds of columns, this difference can be transformative—we're talking about 10x or even 100x faster queries, depending on your access patterns.

ORC is another columnar option Athena supports, offering similar benefits with slightly different compression characteristics. For most use cases, Parquet has become the standard due to broad ecosystem support and predictable performance.

### Partitioning Your Output Data

One of the most important optimizations you can apply with CTAS is partitioning. Partitioning organizes data into virtual subdirectories based on column values, which allows Athena to skip entire partitions when filtering on those columns.

Here's how to partition output from a CTAS statement:

```sql
CREATE TABLE sales_by_month
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/transformed/sales_by_month/',
  partitioned_by = ARRAY['year', 'month']
)
AS SELECT
  order_id,
  customer_id,
  amount,
  year(order_date) AS year,
  month(order_date) AS month
FROM csv_sales;
```

When you specify `partitioned_by`, Athena will organize the S3 output into a directory structure like `s3://my-bucket/transformed/sales_by_month/year=2024/month=1/`, `s3://my-bucket/transformed/sales_by_month/year=2024/month=2/`, and so on. This is incredibly powerful because now when you query this table and filter by year and month, Athena doesn't have to scan files from other months—it only reads the relevant partition directories.

Partitioning works best when you choose columns with moderate cardinality. If you partition by customer_id and you have a million unique customers, you'll end up with millions of tiny files, which is inefficient. A good rule of thumb is to partition by columns that divide your data into anywhere from tens to hundreds of partitions. Date columns (year, month, day) are classic examples of good partition keys.

### Bucketing for Advanced Optimization

Beyond partitioning, Athena supports bucketing through the `bucketed_by` property. Bucketing is a more granular sorting and organization mechanism where rows are distributed into a fixed number of "buckets" based on a hash of one or more columns.

```sql
CREATE TABLE user_events
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/transformed/user_events/',
  bucketed_by = ARRAY['user_id'],
  bucket_count = 50
)
AS SELECT
  event_id,
  user_id,
  event_timestamp,
  event_type
FROM raw_events;
```

In this example, rows are distributed into 50 buckets based on the hash of `user_id`. This is particularly useful when you frequently join tables on specific columns or perform aggregations grouped by the bucketing column. Bucketing can reduce the amount of data shuffled during these operations.

The trade-off is that bucketing adds complexity and overhead during the CTAS write operation. Use bucketing when you have specific query patterns that benefit from it, not as a default optimization strategy. For most analytical workloads, partitioning alone is sufficient.

### The 100-Partition Limit: A Critical Constraint

Here's something that catches many developers off guard: Athena has a hard limit of 100 partitions per CTAS operation. This is a real constraint you need to understand because it can derail your transformation pipeline if you're not careful.

Imagine you're trying to partition sales data by `year`, `month`, and `day` across five years of historical data. That's 5 × 12 × 31 = over 1,800 potential partitions. If your data actually spans that many day-month-year combinations, your CTAS will fail.

The solution is to rethink your partitioning strategy. Instead of partitioning by year, month, *and* day, you might partition by just year and month. Or, if you need finer granularity, you might split the operation into multiple CTAS statements, each handling a subset of the data. For instance:

```sql
-- First CTAS for 2022 and 2023
CREATE TABLE sales_2022_2023
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/transformed/sales_2022_2023/',
  partitioned_by = ARRAY['year', 'month']
)
AS SELECT * FROM csv_sales
WHERE year(order_date) IN (2022, 2023);

-- Second CTAS for 2024
CREATE TABLE sales_2024
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/transformed/sales_2024/',
  partitioned_by = ARRAY['year', 'month']
)
AS SELECT * FROM csv_sales
WHERE year(order_date) = 2024;
```

Or, you could avoid the issue entirely by not partitioning at the day level if your queries don't require that granularity. Always estimate your partition count before running the CTAS—multiply the distinct values for each partition column and make sure the total is under 100.

### INSERT INTO: Writing to Existing Tables

While CTAS creates a new table and populates it in one go, INSERT INTO works with existing tables and adds new data to them. This is useful for incremental loads or appending fresh data to a table you've already created.

```sql
INSERT INTO sales_parquet
SELECT
  order_id,
  customer_id,
  order_date,
  amount
FROM csv_sales
WHERE order_date = current_date;
```

This statement takes today's new orders from the CSV source and appends them to the existing `sales_parquet` table. The new data gets written to the external location specified when the table was created.

One important thing to note: INSERT INTO respects the table's existing format and partitioning scheme. If you created the table as Parquet with year and month partitions, the INSERT will write new data in the same format and will create new partition directories as needed. This makes INSERT INTO ideal for building incremental ETL workflows where you regularly add fresh data to an analytical table.

### Building Lightweight ETL Pipelines

The combination of CTAS and INSERT INTO can replace simple to moderately complex ETL workflows that might otherwise require AWS Glue or Apache Spark. Here's a realistic example:

You have raw JSON event logs landing in S3 every hour. You want to clean them up, convert to Parquet, and partition by date so your analytics team can query efficiently.

```sql
-- Initial bulk transformation
CREATE TABLE events_transformed
WITH (
  format = 'PARQUET',
  external_location = 's3://my-bucket/analytics/events/',
  partitioned_by = ARRAY['event_date']
)
AS SELECT
  event_id,
  user_id,
  event_timestamp,
  cast(event_timestamp as date) as event_date,
  event_type,
  properties
FROM raw_json_events
WHERE event_timestamp >= date_format(current_timestamp - interval '90' day, '%Y-%m-%d');

-- Then, run this daily to capture new events
INSERT INTO events_transformed
SELECT
  event_id,
  user_id,
  event_timestamp,
  cast(event_timestamp as date) as event_date,
  event_type,
  properties
FROM raw_json_events
WHERE cast(event_timestamp as date) = current_date;
```

You can orchestrate these statements using AWS Lambda, Step Functions, or any workflow scheduler that can invoke Athena queries. The beauty of this approach is that you're using SQL, which your team probably already knows, and you're not paying for long-running Spark clusters. You only pay for the data scanned by Athena.

### Performance Considerations and Best Practices

When running CTAS or INSERT INTO, keep a few things in mind for optimal performance and cost efficiency.

**Data compression is your friend.** Athena automatically compresses Parquet and ORC output using appropriate algorithms. This reduces both storage costs and query latency. You can explicitly control compression by specifying `parquet_compression = 'SNAPPY'` (or other algorithms like GZIP) in the WITH clause, though the defaults are usually sensible.

**Consider data skew.** If your transformation results in very uneven partition sizes—for example, one month has 100GB of data and another has 1MB—Athena will still have to process them all. When possible, try to create relatively balanced partitions.

**Be mindful of small files.** If your CTAS produces thousands of tiny files, subsequent queries will be slower because Athena has to manage many file metadata operations. This typically happens when you have too many partitions relative to your data volume. If you notice this problem, consolidate partitions or reduce partition granularity.

**Monitor your costs.** Athena charges per terabyte of data scanned. A CTAS statement that scans 100GB of CSV data costs the same whether you write 10GB or 90GB of output—you're paying for the input scan, not the output write. However, larger output files do mean more S3 storage costs over time, so there's a trade-off between compression and long-term storage economics.

### Common Pitfalls to Avoid

Beyond the 100-partition limit, there are a few other gotchas worth knowing about.

**Schema mismatches between source and destination.** If you're using INSERT INTO on a table and the source data has different column types or ordering, the insert will fail. Always verify that your SELECT query returns columns in the same order and with compatible types as the target table.

**Forgetting to handle NULL values.** SQL NULL handling can be subtle. If your source data has nulls in columns that the target table expects to be non-null, your INSERT will fail. Use COALESCE or CASE statements to provide defaults where appropriate.

**Running CTAS with the same external_location.** If you try to create a new table with an external location that already contains data from a previous CTAS, Athena will fail because the directory isn't empty. Either clean up the old data first or use a new location.

**Not testing partition keys.** Before running a CTAS on a large dataset, test your partition key selection on a smaller subset. This helps you catch issues like excessive cardinality or unexpected null values early.

### When to Use Athena Transformation Versus AWS Glue

Athena CTAS and INSERT INTO are powerful, but they're not always the right tool. Use Athena transformation when your needs are straightforward and your data volumes are manageable. You're doing a format conversion, applying filters, or reshaping columns—nothing exotic.

Reach for AWS Glue when you need more sophisticated operations like complex joins across multiple data sources, machine learning transformations, streaming ingestion, or when you need to manage dependencies across many transformations. Glue also handles schema evolution more gracefully and provides better tooling for monitoring large-scale ETL workflows.

For a quick rule of thumb: if you can express your transformation as a single or small number of SQL statements, Athena is likely faster to implement and more cost-effective. If your transformation logic spans dozens of steps or requires programming language flexibility, Glue becomes the better choice.

### Conclusion

Athena's CTAS and INSERT INTO capabilities democratize data transformation. You no longer need to provision Spark clusters or write complex application code to convert formats, apply transformations, or partition data. A few lines of SQL can accomplish what once required significant engineering effort.

The key to using these features effectively is understanding their constraints—particularly the 100-partition limit—and designing your partitioning strategies thoughtfully. Start simple with CTAS to do a bulk transformation and format conversion, then maintain your data with incremental INSERT INTO statements. Monitor your query performance and adjust your partitioning if needed.

As you build more sophisticated data workflows, you'll develop an intuition for when Athena's lightweight SQL-based approach is sufficient and when you need to graduate to more powerful tools. Until then, leverage the simplicity and serverless nature of Athena to iterate quickly and get your data into a queryable, optimized state with minimal overhead.
