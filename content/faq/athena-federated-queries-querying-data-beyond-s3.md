---
title: "Athena Federated Queries: Querying Data Beyond S3"
---

## Athena Federated Queries: Querying Data Beyond S3

When you first encounter Amazon Athena, it's easy to think of it as a tool exclusively for querying data stored in S3. You set up an external table, write some SQL, and get back results in seconds. But this mental model leaves you missing one of Athena's most powerful and underutilized capabilities: Federated Queries. This feature transforms Athena from an S3-only query engine into a universal SQL interface for virtually any data source you might have—whether it's your RDS database, DynamoDB tables, ElastiCache clusters, or even on-premises data warehouses. In this article, we'll explore how federated queries work, when to use them, and how to build solutions that leverage them effectively.

### Understanding Athena Federated Queries

At its core, a federated query is simply an SQL query that spans multiple data sources. With Athena's federated query capability, you can execute a single SQL statement that joins data from your S3 data lake with your operational database, or queries a DynamoDB table without ever exporting it to S3 first. This is achieved through a clever architecture built on AWS Lambda.

When you submit a federated query to Athena, the query engine doesn't directly connect to your remote data source. Instead, it invokes a Lambda function—called a data source connector—which acts as an intermediary. This connector is responsible for translating Athena's query execution requests into calls that your remote data source understands, retrieving the data, and returning it in a format Athena can process. The query planner pushes down predicates and projections to the connector when possible, minimizing the amount of data that needs to be transferred back to Athena.

This architecture offers several advantages. First, you're not limited to S3. Second, you avoid the complexity and cost of replicating data into your data lake. Third, you gain access to near real-time data from transactional systems without ETL delays. And fourth, you can orchestrate complex multi-source queries using familiar SQL syntax.

### How Federated Query Architecture Works

Let's walk through what happens when you execute a federated query. Suppose you want to find all customers from your RDS database whose recent transactions (stored in DynamoDB) exceeded a certain threshold.

Your SQL might look something like this:

```sql
SELECT c.customer_id, c.name, t.transaction_amount
FROM rds_database.customers c
JOIN dynamodb_database.transactions t
  ON c.customer_id = t.customer_id
WHERE t.transaction_amount > 1000
```

When you execute this query, Athena's query planner analyzes it and determines that it needs to fetch data from two sources: an RDS instance and a DynamoDB table. For each data source, Athena identifies the corresponding Lambda connector. It then invokes these connectors with optimized requests—for example, pushing down the WHERE clause predicate so the RDS connector only retrieves transactions over 1000, rather than fetching all transactions and filtering them in Athena.

The connectors execute the remote queries, retrieve the results, and return them to Athena in Apache Arrow format, a columnar format designed for efficient data transfer. Athena then continues with any remaining operations—such as the join operation itself—and returns the final results to your client.

This architecture matters because it determines both the performance characteristics and the cost profile of your queries. The Lambda functions are doing the real work of connecting and retrieving data, so their configuration, memory allocation, and timeout settings all affect query performance. Similarly, the amount of data transferred between Lambda and Athena is billed separately from your Athena query costs.

### AWS-Provided Data Source Connectors

AWS provides several pre-built connectors that handle the most common data sources. These connectors come ready to deploy and work well for typical use cases, though you'll usually need to configure them with connection details specific to your environment.

**The RDS connector** is perhaps the most commonly used. It supports MySQL, PostgreSQL, and MariaDB databases. You provide the connection details through Secrets Manager, and the connector handles all the SQL translation and result fetching. One important detail: the RDS instance must be accessible from the Lambda function running the connector, which typically means either running Lambda in the same VPC or ensuring network connectivity through a NAT gateway or bastion host.

**The DynamoDB connector** lets you query DynamoDB tables using SQL. This is particularly useful if you've been manually exporting DynamoDB data to S3 for analysis. With the federated connector, you can query directly. Keep in mind that DynamoDB scans are expensive, so you'll want to design your queries to filter as much as possible within the connector itself, reducing the amount of data that needs to be transferred.

**The ElastiCache connector** works with both Redis and Memcached. This is useful when you want to query in-memory caches without disrupting their operational traffic. The connector reads from read replicas when available, protecting your primary instance.

Beyond these, AWS provides connectors for data sources like Amazon DocumentDB, DynamoDB, and third-party systems. Additionally, AWS partners have published connectors for systems like Salesforce, ServiceNow, and various data warehouses. You can discover available connectors through the AWS Serverless Application Repository, where they're published as SAM applications ready for deployment.

To deploy a pre-built connector, you typically use AWS CloudFormation or the Serverless Application Repository console. The deployment creates a Lambda function, sets up IAM roles with appropriate permissions, and stores the function ARN in Athena's connector configuration. Once configured, you reference the connector in your federated query by using a specific database name and schema syntax that maps to the remote data source.

### Building Custom Federated Query Connectors

While the pre-built connectors cover many scenarios, you'll eventually face a situation where you need to query a data source without an official connector. This might be a custom internal database, a specialized analytical system, or a legacy database running on premises. In these cases, you'll build a custom connector.

Writing a federated query connector is fundamentally about implementing a Lambda function that understands Athena's Federated Query protocol. Athena communicates with your Lambda function by passing JSON payloads that describe what data it needs. Your function must parse these requests, fetch the appropriate data from your remote source, and return results formatted as Apache Arrow binary data.

Here's what a simplified custom connector structure looks like in Python:

```python
import json
import logging
from pyarrow import RecordBatch, Schema, field, string, int64
import pyarrow as pa

logger = logging.getLogger()

def lambda_handler(event, context):
    action = event['action']
    
    if action == 'GetTableLayout':
        return handle_get_table_layout(event)
    elif action == 'GetPartitions':
        return handle_get_partitions(event)
    elif action == 'GetSplits':
        return handle_get_splits(event)
    elif action == 'GetRecords':
        return handle_get_records(event)
    else:
        raise ValueError(f"Unknown action: {action}")

def handle_get_table_layout(event):
    """Return schema information about the table"""
    schema_fields = [
        field('customer_id', int64()),
        field('name', string()),
        field('email', string()),
    ]
    schema = Schema.from_fields(schema_fields)
    
    return {
        'schema': schema.to_pandas_dtype().to_dict(),
        'partitions': []
    }

def handle_get_records(event):
    """Fetch actual data from remote source"""
    # Connect to your remote data source
    # Execute query with pushed-down predicates
    # Format results as Apache Arrow
    
    # Example: fetch from your remote database
    records = fetch_from_remote_db(event['filters'])
    
    # Convert to Arrow format
    batch = RecordBatch.from_pylist(records, schema=build_schema())
    
    return {
        'records': batch.to_pandas().to_dict(orient='list')
    }
```

The Athena Federated Query protocol involves four main actions. The first action, `GetTableLayout`, is called when Athena needs to understand the schema of your remote data source. You return field names, types, and partitioning information. The second action, `GetPartitions`, helps Athena understand how your data is partitioned, enabling better query optimization. The third action, `GetSplits`, allows Athena to parallelize data retrieval by asking your connector how to split the remote data into chunks that can be fetched independently. Finally, `GetRecords` is where the actual data retrieval happens.

One critical aspect of building a good connector is implementing predicate pushdown. When Athena encounters a WHERE clause, it should try to communicate that filtering requirement to your connector, so you only fetch matching records from the remote source. This dramatically reduces data transfer and improves performance. Your connector must parse the predicates Athena provides and incorporate them into your remote query execution.

For example, if Athena's query includes `WHERE year >= 2023`, your connector should extract that predicate and pass it to your remote database as part of the SELECT query, rather than fetching all years and filtering in Lambda. This is especially important for remote data sources where bandwidth and latency are costly.

Another important consideration is handling large result sets. Lambda has memory limits (up to 10 GB), but you'll often encounter remote tables far larger than that. Well-designed connectors implement pagination or chunking, returning results in multiple invocations rather than attempting to fetch everything at once. This is where the `GetSplits` action becomes essential—it tells Athena how many parallel invocations it should make to efficiently retrieve the entire dataset.

AWS provides the Athena Query Federation SDK in multiple languages (Java, Python) to simplify connector development. This SDK handles much of the protocol complexity, giving you a cleaner interface to implement. Rather than working directly with JSON payloads, you write handlers for the action types and let the SDK manage serialization and Arrow format conversion.

### Performance Considerations for Federated Queries

Understanding the performance characteristics of federated queries is essential for building responsive applications. Federated queries are inherently slower than native Athena queries against S3 because they introduce additional network hops and depend on the performance of remote data sources.

The first performance consideration is Lambda cold starts. When your connector Lambda hasn't been invoked recently, AWS needs to initialize a new container, which adds latency to your query. For frequently accessed data sources, this is usually negligible after the first few queries. For infrequently accessed sources, you might see initial query latencies in the seconds range. You can mitigate this by provisioning concurrency on your connector Lambda, though this adds to your overall costs.

The second consideration is predicate pushdown efficiency. A well-optimized connector that pushes predicates to the remote source will dramatically outperform a naive connector that fetches everything and filters in Lambda. This means your remote data source's ability to quickly execute filtered queries directly impacts your Athena query performance. If your RDS instance is slow at executing queries with certain predicates, your Athena federated query will be equally slow.

The third consideration is the performance of the remote data source itself. Athena can only retrieve data as fast as your remote system can provide it. If you're querying a busy production RDS database during peak business hours, you're competing with transactional traffic for database resources. This is why it's often recommended to query read replicas or dedicated analytical instances rather than your primary production database. The same principle applies to DynamoDB—read operations consume read capacity units, so high-volume federated queries might impact your application's ability to handle traffic.

Network latency between the Lambda function and your remote data source also matters. If your data source is on premises or in a different region, the network latency per query can become substantial. Each predicate evaluation, each split request, and each records fetch involves a network round trip. Minimizing the number of round trips through efficient connector implementation is crucial.

Data transfer volume is another performance lever. Athena's distributed query engine is optimized for columnar data in Arrow format, but if your remote data source provides data row by row, your connector must serialize that into Arrow format, which involves CPU and memory overhead. Additionally, every byte transferred from Lambda back to Athena consumes bandwidth and increases query latency. Selecting only the columns you need and filtering rows early in the connector reduces the transfer volume.

For performance-critical use cases, you might consider caching strategies. Some teams cache results from slow remote sources in S3, then use a standard Athena query instead of federated queries. This trades real-time data freshness for better query performance. You can automate this caching using Lambda and EventBridge—periodically refresh cached data from remote sources on a schedule that matches your freshness requirements.

### Pricing for Federated Queries

Understanding the cost implications of federated queries is important for budgeting and optimization decisions. Athena's pricing model for federated queries involves multiple components.

First, you pay standard Athena query costs. Athena charges based on the amount of data scanned, typically quoted at $6.25 per terabyte of data scanned (though pricing varies by region). When you run a federated query, the data scanned from S3 follows this pricing model. However, data scanned from remote sources through federated connectors is also billed at this rate. This means a federated query against your RDS database incurs Athena scan charges equivalent to the amount of data your connector returns to Athena.

Second, you pay for the Lambda execution time used by your connector. Each invocation of your connector Lambda function is billed based on the duration and memory allocation. A small connector querying a single record might cost a few cents, while a large parallel federation against a massive remote dataset could involve hundreds or thousands of Lambda invocations, each running for seconds. If your connector Lambda is allocated 3008 MB (near the maximum), each second of execution costs roughly $0.0000617. For a complex federated query involving multiple remote sources and millions of rows, this can add up.

Third, you might incur costs from your remote data sources themselves. If you're querying DynamoDB, you're consuming read capacity units. If you're querying RDS, you're consuming database resources (though typically no direct per-query charge). Querying on-premises databases or data warehouses shouldn't incur additional costs from those systems unless they're metered services.

Fourth, there's network data transfer. If your Lambda connector is in a different VPC or region from your remote data source, or if the source is on premises, you might incur data transfer charges. Data transfer between Lambda and S3 is free, and data transfer between Lambda and resources in the same VPC is free, but cross-region or Internet-bound traffic isn't.

To optimize federated query costs, focus on reducing the amount of data transferred. Write connectors that aggressively filter and project data. Use Athena's partition pruning capabilities when your remote data source supports partitions. Avoid federated queries for massive scans—if you need to regularly scan terabytes of data from a remote source, you're probably better off replicating that data into S3 and querying it natively with Athena.

For scenarios where you're running repeated queries against the same remote data, consider materializing views in S3. This involves periodically running a federated query and storing the results in S3, then querying those results instead of repeatedly federate. This approach trades storage costs (S3 storage is inexpensive) for query and Lambda execution cost savings, and you gain much better query performance as a bonus.

### Practical Example: Querying RDS and DynamoDB Together

Let's walk through a realistic scenario to cement your understanding. Imagine you have an e-commerce platform with several data sources: an RDS MySQL database containing customer and product information, and DynamoDB tables storing real-time order events and user behavior data. You want to analyze which products are trending among high-value customers.

First, you'd set up the RDS connector. You'd deploy the pre-built RDS connector Lambda from the Serverless Application Repository, configure it with your database credentials (stored in Secrets Manager), and ensure the Lambda can reach your RDS instance (either in the same VPC or through a security group rule). In Athena, you'd create an external data source that references this Lambda and maps it to your MySQL database.

Next, you'd set up the DynamoDB connector similarly. Deploy the DynamoDB connector Lambda and configure it to access your DynamoDB tables.

Now you can write a query like this:

```sql
SELECT 
    p.product_id,
    p.product_name,
    COUNT(o.order_id) as order_count,
    SUM(o.order_value) as total_value
FROM rds_source.ecommerce.products p
JOIN dynamodb_source.order_events o ON p.product_id = o.product_id
WHERE o.order_timestamp > date_format(current_timestamp - interval '7' day, '%Y-%m-%d')
    AND p.price > 50
GROUP BY p.product_id, p.product_name
ORDER BY total_value DESC
LIMIT 20
```

When you execute this query, Athena's optimizer recognizes that the predicates on `order_timestamp` and `price` can be pushed down to the respective connectors. The RDS connector receives a request to fetch products with price > 50, filtering at the database level. The DynamoDB connector receives a request to scan order events with timestamps in the last 7 days. Both connectors return only the relevant data, the join happens in Athena, and you get your trending products without transferring gigabytes of unnecessary data.

The results might take a few seconds to appear (depending on your data volume and remote system performance), but you've achieved something that would have been difficult without federated queries: correlating operational transactional data with event-driven behavioral data, all through a single SQL statement.

### When Federated Queries Make Sense

Federated queries are powerful, but they're not always the right choice. Use them when you need to correlate data across multiple sources infrequently, when data freshness is important, or when data volumes are small enough that the performance impact is acceptable. They're excellent for ad-hoc analysis, exploratory queries, and reporting that combines operational and analytical data.

Avoid federated queries for high-volume repeated scans, real-time dashboards that need subsecond latency, or scenarios where you're essentially replacing a traditional ETL pipeline. For those use cases, the performance and cost benefits of replicating data into S3 usually outweigh the simplicity of federated queries.

### Conclusion

Amazon Athena's federated query capability transforms it from a specialized S3 querying tool into a universal SQL interface for your entire data landscape. By understanding the architecture—how Lambda connectors act as intermediaries between Athena and remote data sources—you can architect solutions that avoid costly data replication while maintaining access to fresh operational data.

Whether you're using AWS-provided connectors for common data sources like RDS and DynamoDB, or building custom connectors for specialized systems, the principles remain consistent: push predicates down to remote sources, minimize data transfer, and understand the performance and cost implications of your queries. With these foundational concepts in mind, you're equipped to leverage federated queries effectively in your AWS applications, unlocking analytical capabilities that would be difficult or expensive to achieve through traditional approaches.
