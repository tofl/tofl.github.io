---
title: "Athena Query Performance Tuning: Beyond Partitioning and Columnar Formats"
---

## Athena Query Performance Tuning: Beyond Partitioning and Columnar Formats

When you first start using Amazon Athena, the wins come quickly. You switch from CSV to Parquet, add a few partition columns, and suddenly your queries run orders of magnitude faster while costing a fraction of what they did before. But then you hit a plateau. Your queries are still slower than you'd like, or your bills aren't dropping as much as you expected. At this point, you've mastered the basics—now it's time to go deeper.

Athena's true performance ceiling isn't reached through simple architectural choices alone. The difference between a competent Athena setup and an optimized one often lies in understanding how query engines consume data at a granular level, how file organization affects I/O patterns, and how to write queries that play nicely with Athena's distributed execution model. This article explores the advanced techniques that separate good Athena deployments from great ones.

### Understanding the Cost-Performance Tradeoff

Before diving into specific techniques, it's worth thinking about what we're really optimizing for. In Athena, you pay per byte of data scanned, not per second of compute time. A query that scans 10GB of data costs the same whether it finishes in five seconds or five minutes. This fundamental truth changes how you think about optimization.

Traditional databases often encourage you to minimize query execution time at nearly any cost—add an index, materialize a view, accept higher storage overhead. With Athena, your primary lever is reducing the amount of data you scan. Faster execution time is almost a side effect of scanning less data. Once you internalize this, your optimization strategies naturally shift toward techniques that eliminate unnecessary data at the source, before the query engine even sees it.

### The Small Files Problem: Why It's Worse Than You Think

Most developers understand that Athena performs better with fewer, larger files than with many small files. The conventional wisdom is "don't create thousands of tiny files." But this guidance often undersells just how severely small files degrade performance.

Here's what happens behind the scenes: when Athena executes a query against S3, it needs to list objects, compute statistics, and eventually read data. Each file carries a per-file overhead. That overhead includes network latency, metadata processing, and coordination across multiple worker nodes. When files are small—say, 1MB each—those overheads start consuming a significant portion of your query's execution time and cost. You're not scanning 10GB of useful data plus overhead; you're scanning 10GB of data while incurring the overhead cost of processing tens of thousands of separate files.

The sweet spot for Athena file sizes sits around 128MB per file, though this isn't a hard rule. Why 128MB? It aligns well with typical S3 partition sizes and allows modern processors to chunk and process the data efficiently. More importantly, it represents a practical balance: files are large enough to amortize the per-file overhead across substantial amounts of data, yet not so large that a single file becomes a processing bottleneck for a worker node.

Consider a concrete scenario. You have a data pipeline that writes 10GB of data daily to S3. If your pipeline writes one file per hour, you'd create 24 files—roughly 400MB each. That's perfectly fine. But if your pipeline writes one file per minute, you'd create 1,440 files of roughly 7MB each. The same 10GB of data now incurs 1,440 times more per-file overhead instead of just 24 times.

To quantify the impact: that same 10GB query might scan at 50GB-per-second with well-sized files (20 seconds, $0.25 cost) but only 10GB-per-second with thousands of tiny files (100 seconds, $0.25 cost). You pay the same amount but wait five times longer. Or consider the reverse: if you need to keep queries under 30 seconds, tiny files force you to add aggressive partitioning, which introduces its own complexity.

The solution depends on your pipeline architecture. If you control the writing process, configure your batch jobs or streaming applications to buffer data and emit fewer, larger files. If data comes from third-party sources, use AWS Glue or Lambda to combine small files into larger objects. Many teams implement a nightly compaction job that reads partitions worth of small files and rewrites them as properly-sized Parquet files. The cost of that rewrite job is invariably offset by the query performance gains within days.

### Bucketing for Join Optimization

Joins are expensive in any distributed query engine. When Athena needs to join two tables, it typically has to shuffle data across the network so that matching rows end up on the same worker node. With large datasets, that shuffle can be prohibitively expensive.

Bucketing is a technique that can eliminate or drastically reduce this shuffle. The idea is simple but powerful: organize both tables so that rows with matching join keys are guaranteed to be in the same bucket number, allowing Athena to perform a local join without moving data across the network.

Here's how it works. Suppose you have a `customers` table with millions of rows and an `orders` table with billions of rows, and you frequently join them on `customer_id`. You'd create both tables with bucketing on `customer_id`:

```sql
CREATE TABLE customers (
  customer_id BIGINT,
  name STRING,
  email STRING
)
STORED AS PARQUET
CLUSTERED BY (customer_id) INTO 256 BUCKETS
LOCATION 's3://my-bucket/customers/';

CREATE TABLE orders (
  order_id BIGINT,
  customer_id BIGINT,
  amount DECIMAL(10,2),
  order_date DATE
)
STORED AS PARQUET
CLUSTERED BY (customer_id) INTO 256 BUCKETS
LOCATION 's3://my-bucket/orders/';
```

With both tables bucketed on the same column into the same number of buckets, Athena knows that all customer_id = 12345 rows in customers are in a specific bucket file, and all customer_id = 12345 rows in orders are in the corresponding bucket file. The join can then proceed without a shuffle.

The catch is that bucketing only works if the underlying data is actually written according to the bucketing specification. Simply creating a table with CLUSTERED BY doesn't retroactively bucket your existing data; it only describes how future data should be organized. You need to populate bucketed tables through INSERT INTO ... SELECT statements that respect the bucketing, typically from an Apache Spark job or an AWS Glue ETL script.

```sql
-- This writes data according to the bucketing specification
INSERT INTO customers
SELECT customer_id, name, email FROM source_customers;
```

Bucketing is most valuable when you have a few dominant join patterns in your workloads. If you consistently join orders with customers, bucketing makes sense. If you join orders with customers some queries, with products other queries, and with regions in others, bucketing becomes a compromise that helps some queries but not others. The tradeoff is usually worth it for the most common join patterns.

Bucketing also requires that you bucket both sides of the join on the same column and with the same bucket count. Mismatches mean Athena can't use the bucketing optimization and falls back to shuffling. This rigidity is why bucketing is less common in Athena than in Hive or Spark—modern distributed engines have become quite good at optimizing joins without explicit bucketing—but for truly enormous datasets where shuffle cost is prohibitive, bucketing remains a valuable tool.

### Predicate Pushdown: Let Filters Do the Heavy Lifting

Predicate pushdown is a query optimization technique where filters are applied as early as possible in the query execution plan, ideally before data is even read from storage. Athena's query engine supports predicate pushdown, but you need to write your queries in a way that allows it to happen.

The key principle is straightforward: filters on partitioned columns should appear in the WHERE clause where the query engine can see them before listing files. Consider this example:

```sql
-- Good: partition column filter can be pushed down to file listing
SELECT user_id, event_name, event_time
FROM events
WHERE year = 2024 AND month = 3 AND event_name = 'purchase'
ORDER BY event_time DESC;
```

This query filters on partitioned columns (`year` and `month`) before touching any data files. Athena sees the partition constraints and lists only the files under `s3://my-bucket/events/year=2024/month=3/`. It then applies the `event_name = 'purchase'` filter while reading that data. The result is that you scan maybe 50GB instead of 2TB.

Now consider a problematic variant:

```sql
-- Bad: partition column filter is buried in a subquery
SELECT user_id, event_name, event_time
FROM (
  SELECT user_id, event_name, event_time
  FROM events
  WHERE event_name = 'purchase'
) filtered
WHERE year = 2024 AND month = 3
ORDER BY event_time DESC;
```

In this case, the query engine may not recognize that the outer WHERE clause is a partition filter until after it's already decided which files to read. The query might scan all events across all years and months, filter them in memory, and only then apply the partition constraint. You're now reading 2TB instead of 50GB.

The fix is to ensure partition column filters appear as top-level WHERE conditions:

```sql
-- Better: partition filters at the top level
SELECT user_id, event_name, event_time
FROM events
WHERE year = 2024 AND month = 3
  AND event_name = 'purchase'
ORDER BY event_time DESC;
```

Athena's query planner is reasonably sophisticated and can sometimes push predicates through subqueries, but explicit top-level filters are more reliable. When you need complex filtering logic, consider using CTEs (Common Table Expressions) with partition filters first, then applying other conditions.

Beyond partition columns, predicate pushdown also applies to regular columns in columnar formats like Parquet. Because Parquet stores column statistics in file metadata, Athena can sometimes skip entire files or file sections if the statistics prove that no matching rows could exist. For instance, if a Parquet file contains order amounts from $100 to $500, and your WHERE clause is `amount > $1000`, Athena can skip that file entirely. This optimization happens automatically, but it reinforces the importance of writing filters directly in the WHERE clause rather than filtering results after projection.

### Projection Pushdown in Parquet: Only Read What You Need

Parquet's columnar storage makes it practical for Athena to read only the columns you explicitly SELECT, skipping the rest. This sounds obvious until you consider how easy it is to defeat this optimization.

```sql
-- Good: only read the columns you need
SELECT user_id, email
FROM customers
WHERE country = 'US';
```

Athena sees that you're selecting `user_id` and `email`, and filtering on `country`. It reads only those three columns from each Parquet file, ignoring phone_number, address, billing_info, and any other columns. If your Parquet files are 500MB each but only 30MB of that is the three columns you need, you're scanning 30MB instead of 500MB.

Now the problematic version:

```sql
-- Bad: selecting all columns with wildcard
SELECT *
FROM customers
WHERE country = 'US';
```

The wildcard forces Athena to read every column, even if your downstream application only cares about three of them. If this query runs hourly and your customers table is partitioned by country, you're scanning three times more data than necessary over the course of a day.

The solution seems trivial—just list the columns you need—but it's easy to overlook when you're exploring data or when you're writing a view that gets used in multiple downstream queries. A good practice is to avoid SELECT * in any view, materialized query, or regularly-executed analysis. Instead, explicitly list the columns. If you find yourself writing select_all views for convenience, consider instead using a schema documentation tool to discover available columns, or create narrowly-scoped views for specific use cases.

This principle extends to nested columns in Parquet. If you have a complex object with many fields, you can project only the fields you need:

```sql
-- Only read the 'value' field from nested 'metadata'
SELECT user_id, metadata.value
FROM events
WHERE year = 2024;
```

Athena reads the `user_id` column and just the `metadata.value` nested field, not the entire `metadata` object.

### ORDER BY and LIMIT: The Deceptive Query

ORDER BY is seductive in Athena because it's familiar. You've sorted results in SQL for years. But in a distributed query engine, ORDER BY has a hidden cost that's easy to underestimate.

Athena executes queries across multiple worker nodes in parallel. Each node processes a portion of the data independently. When you add ORDER BY, Athena must collect all results from all nodes and sort them globally. That's a shuffle operation—data moves across the network from workers to a coordinator node, gets sorted, and then sent to the client. For multi-terabyte queries, this shuffle is expensive and slow.

```sql
-- This shuffles all results to a single node for sorting
SELECT user_id, event_name, event_time
FROM events
WHERE year = 2024
ORDER BY event_time DESC;
```

If your events table has billions of rows in 2024, Athena has to shuffle billions of rows to perform the sort. If you only need the top 100 results, you've just shuffled a billion rows to discard all but 100.

LIMIT does not push down into the sorting step. Athena sorts the entire result set, then applies LIMIT. So ORDER BY ... LIMIT N is particularly expensive when N is small.

That said, sometimes you genuinely need sorted output. The key is to be intentional about it. Some scenarios where ORDER BY makes sense: when you're building a report that will be consumed in sorted order, or when you're exporting data to a system that expects sorted input. If you're just curious about the top 100 events, consider using approximate methods or analytical approaches that don't require global sorting.

One workaround when you want top-K results: use window functions with LIMIT instead of ORDER BY LIMIT. Window functions can compute rankings per partition, and if your data is already partitioned, the computation can be more efficient:

```sql
-- More efficient top-K: compute rank per partition
WITH ranked AS (
  SELECT user_id, event_name, event_time,
         ROW_NUMBER() OVER (PARTITION BY year, month ORDER BY event_time DESC) as rn
  FROM events
  WHERE year = 2024 AND month >= 3
)
SELECT user_id, event_name, event_time
FROM ranked
WHERE rn <= 100;
```

This approach computes the top 100 per partition, then you can further limit if needed. The shuffle is much smaller because you're only shuffling the top 100 per partition, not the entire dataset.

### Approximate Aggregations for Massive Datasets

When you need a rough answer quickly and cheaply, approximate aggregations are powerful tools. The classic example is approximate distinct counts.

```sql
-- Exact count of distinct users: slow, expensive
SELECT COUNT(DISTINCT user_id)
FROM events
WHERE year = 2024;

-- Approximate count of distinct users: fast, cheap
SELECT APPROX_DISTINCT(user_id)
FROM events
WHERE year = 2024;
```

APPROX_DISTINCT uses the HyperLogLog algorithm, which estimates the number of distinct values in a dataset with remarkable accuracy (typically within a few percent) while scanning the data only once. An exact COUNT(DISTINCT ...) has to track every single unique value, which requires more memory and more shuffling for the aggregation step.

For a table with 10 billion events, APPROX_DISTINCT might return 45 million as the answer with microseconds to spare, while COUNT(DISTINCT ...) might take tens of seconds. The approximate answer is usually accurate enough for dashboards, capacity planning, and exploratory analysis.

Athena supports other approximate functions too, like APPROX_PERCENTILE for estimating percentiles without sorting the entire dataset. These functions are invaluable when you're analyzing trends or building interactive dashboards where perfect precision is less important than responsiveness.

The tradeoff is obviously accuracy. APPROX_DISTINCT won't give you an exact count, and there's always some margin of error. For mission-critical metrics where absolute precision is required, you'd stick with exact aggregations. But for most analytical workloads, the speed and cost savings justify the small accuracy loss.

### Using EXPLAIN to Inspect Query Plans

Understanding what your query actually does requires looking at the query plan. Athena supports EXPLAIN, which shows you how the query engine intends to execute your query.

```sql
EXPLAIN
SELECT COUNT(*)
FROM events
WHERE year = 2024 AND event_name = 'purchase';
```

The output shows each step of the plan: which tables are scanned, where filters are applied, how aggregations are performed, and what shuffles occur. Here's a simplified example of what you might see:

```
- Aggregate[COUNT(*)]
  - Filter[event_name = 'purchase']
    - TableScan[events] {year = 2024}
```

This tells you that Athena will scan the events table with the partition filter on year, then filter the results for event_name, then count them. The partition filter is pushed down to the table scan, which is good.

Compare that to a suboptimal version:

```
- Aggregate[COUNT(*)]
  - Filter[event_name = 'purchase' AND year = 2024]
    - TableScan[events]
```

This plan shows the partition filter being applied after the scan, not during. Athena scans all years, then filters. The scan line has no partition constraint listed.

EXPLAIN ANALYZE goes further: it actually executes the query and shows you real statistics like how many rows were scanned at each step, how much time each step took, and where bottlenecks exist.

```sql
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM events
WHERE year = 2024 AND event_name = 'purchase';
```

This is invaluable for debugging slow queries. If you see that a join is incredibly slow, EXPLAIN ANALYZE shows you whether the shuffle is huge (meaning your join strategy is poor) or whether one side of the join is unexpectedly large (meaning your filtering isn't working as expected).

Developing the habit of reading query plans before and after optimization changes saves enormous amounts of time and money. When a query runs slower than expected, EXPLAIN often reveals the issue in seconds. When you're optimizing a complex query, running EXPLAIN helps you validate that your changes are actually doing what you intended.

### Caching and Materialization: When to Store Results

Sometimes the best way to optimize a query is to not run it at all—or to run it less frequently. Athena's query results can be cached automatically, but understanding when to rely on caching versus materialization is important.

Athena caches query results in S3. If the same query is run again within a certain window (default is 60 seconds per query result), Athena returns the cached result instead of re-executing. This is transparent and automatic, but the cache is shallow: only exact query matches hit the cache. A slightly different WHERE clause, even a different column order in the result, creates a cache miss.

For truly expensive queries that you run repeatedly, consider materialized views: periodically run the query and store the results in a dedicated table. For example, if you're computing daily user cohorts—a potentially expensive operation—you might materialize the result once per day rather than computing it fresh on every request:

```sql
-- Run this once per day, e.g., via EventBridge + Lambda
CREATE TABLE user_cohorts AS
SELECT user_id,
       DATE_TRUNC('day', first_event_time) as cohort_date,
       COUNT(*) as events_in_first_day
FROM events
WHERE first_event_time >= DATE_ADD('day', -1, CURRENT_DATE)
GROUP BY user_id, DATE_TRUNC('day', first_event_time);
```

Now downstream queries hit the much smaller materialized table instead of scanning the full events table:

```sql
-- Fast: queries against materialized view
SELECT cohort_date, COUNT(DISTINCT user_id) as users
FROM user_cohorts
WHERE cohort_date >= '2024-01-01'
GROUP BY cohort_date;
```

The tradeoff is freshness versus cost. If you can tolerate results being a few hours old, materialization can reduce your Athena spend dramatically. If you need real-time accuracy, materialization isn't an option, and you'll need to optimize the queries themselves.

### Concurrency and Query Limits

Athena allows you to run multiple queries concurrently, but there are practical limits. Each query uses memory and CPU on the worker nodes, and if too many queries run simultaneously, they contend for resources, causing all of them to slow down.

The exact limit depends on your workload and data characteristics, but a general guideline is to keep concurrent queries below 10-20 unless you have enormous data and worker pools. If you're building a dashboard that fires 50 queries simultaneously, you'll see better overall performance by queueing them or limiting concurrency.

Athena doesn't enforce concurrency limits by default, so it's up to you to manage them via application logic or a query orchestration tool. For dashboards, consider prefetching expensive queries and caching results rather than running them on-demand for every page view.

### Putting It Together: A Real-World Example

Imagine you're optimizing a dashboard that shows user engagement metrics. The dashboard runs this query hourly:

```sql
SELECT
  user_id,
  COUNT(*) as event_count,
  COUNT(DISTINCT event_name) as event_types,
  MIN(event_time) as first_event,
  MAX(event_time) as last_event
FROM events
WHERE year = YEAR(CURRENT_DATE)
  AND month = MONTH(CURRENT_DATE)
  AND day = DAY(CURRENT_DATE)
GROUP BY user_id;
```

This query scans today's events, grouped by user. It's straightforward but expensive: for a large user base with millions of daily events, this query might scan 50GB and take 30 seconds.

Applying the techniques in this article, you might optimize as follows:

First, ensure partition pruning works by using explicit partition columns in WHERE, which you already have—good.

Second, check your file sizes. If your events table is written via a streaming pipeline, you likely have many small files. Implement a nightly compaction job that consolidates daily events into 128MB-ish Parquet files. Alone, this might cut your query time in half.

Third, switch from COUNT(DISTINCT ...) to APPROX_DISTINCT for event_types. You're calculating this for a dashboard, so a few percent of error is acceptable:

```sql
SELECT
  user_id,
  COUNT(*) as event_count,
  APPROX_DISTINCT(event_name) as event_types,
  MIN(event_time) as first_event,
  MAX(event_time) as last_event
FROM events
WHERE year = YEAR(CURRENT_DATE)
  AND month = MONTH(CURRENT_DATE)
  AND day = DAY(CURRENT_DATE)
GROUP BY user_id;
```

Fourth, materialize the result since this dashboard hits the same query hourly anyway:

```sql
INSERT INTO user_daily_summary
SELECT
  user_id,
  COUNT(*) as event_count,
  APPROX_DISTINCT(event_name) as event_types,
  MIN(event_time) as first_event,
  MAX(event_time) as last_event,
  CURRENT_DATE as summary_date
FROM events
WHERE year = YEAR(CURRENT_DATE)
  AND month = MONTH(CURRENT_DATE)
  AND day = DAY(CURRENT_DATE)
GROUP BY user_id;
```

Run this query once per day. The dashboard then queries the materialized table, which has far fewer rows and is much faster.

Fifth, if the dashboard needs to show top users by event count, avoid ORDER BY LIMIT. Instead, compute deciles or use APPROX_PERCENTILE to identify the top tier without global sorting.

The combined effect of these changes might reduce query cost by 70% and execution time by 80%, transforming the dashboard from a concern into a rounding error on your Athena bill.

### Conclusion

Advanced Athena optimization goes far beyond partitioning and file format choices. The techniques in this article—managing file sizes, understanding predicate and projection pushdown, avoiding expensive operations like global sorting, using approximate aggregations, and inspecting query plans—are what separate efficient from bloated Athena deployments.

The unifying principle is this: in a pay-per-byte model, every byte you scan costs money and time. Your optimization strategy should be relentless in reducing scan scope. Write filters that let Athena skip entire files. Select only the columns you need. Use approximate methods where precision isn't critical. Materialize expensive computations that run repeatedly. Run EXPLAIN to validate that your query is executing as intended.

Athena is remarkably good at scaling transparently, making it easy to forget that you're not working with unlimited resources. Developers who internalize these optimization principles build systems that are faster, cheaper, and far easier to operate as they grow.
