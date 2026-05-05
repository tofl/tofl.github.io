---
title: "Migrating Data to DynamoDB: AWS DMS, Data Pipeline, and Custom Approaches"
---

## Migrating Data to DynamoDB: AWS DMS, Data Pipeline, and Custom Approaches

Moving data into DynamoDB is rarely a one-size-fits-all proposition. Whether you're modernizing a legacy relational database, consolidating data from multiple sources, or building a new application from scratch, the path your data takes matters as much as the destination. Get it wrong, and you might face throttling errors, incomplete migrations, or validation nightmares. Get it right, and your data flows smoothly into a highly scalable NoSQL database that can grow with your application.

This article walks you through the main strategies for loading data into DynamoDB at scale—from AWS-managed services like DMS and S3 imports to custom ETL approaches with Lambda and Glue. We'll explore when to use each approach, how to handle throughput constraints, and what validation looks like on the other side.

### Understanding Your Starting Point and End Goal

Before diving into migration tools, it's worth clarifying what you're actually trying to accomplish. Are you migrating an entire relational database as part of a modernization effort? Are you doing a one-time bulk load of historical data? Or are you setting up ongoing data synchronization from a legacy system while you transition to DynamoDB-native applications?

These scenarios shape your approach dramatically. A one-time bulk load from S3 is fundamentally different from continuous replication from an Oracle database. A custom Lambda-based ETL might be perfect for transforming JSON events from Kinesis, but overkill for a simple PostgreSQL migration. The AWS ecosystem provides purpose-built tools for each scenario—the trick is matching the tool to your actual problem.

Understanding your data volume and schema also matters. DynamoDB's throughput model, partition key design, and item size limits all impose constraints that influence how you'll stage the migration. A table with millions of small items behaves very differently from one with thousands of large items. Similarly, the structure of your source data determines how much transformation is necessary before it can land in DynamoDB.

### AWS Database Migration Service (DMS) for Ongoing Replication

If you're migrating from a relational database and need continuous synchronization—even if it's just during a cutover window—AWS DMS is designed exactly for this use case. DMS acts as a bridge between your source database and DynamoDB, handling the complexity of schema conversion, data extraction, and incremental updates.

DMS works by creating a replication instance, which is essentially a managed server that reads from your source database and writes to your target. The service handles connection management, credential rotation, and the hard problem of extracting changes incrementally without locking your source database for extended periods. For many organizations, this means you can keep your production database running while preparing the migration, reducing downtime to minutes rather than hours or days.

The service excels at handling the schema transformation challenge. When migrating from a relational database to DynamoDB, your flat tables don't map directly to DynamoDB's hierarchical item structure. DMS includes mapping templates that let you define how columns become attributes, how primary keys become partition and sort keys, and where nested data should be embedded. You might collapse a parent-child relationship from normalized tables into a single DynamoDB item with a list or map attribute, or you might distribute the data across multiple items with a thoughtful design that enables efficient queries.

Here's where DMS shines in a real migration: imagine you're moving a customer management system from PostgreSQL. Your source database has a `customers` table, an `addresses` table, and an `orders` table, all properly normalized. In DynamoDB, you might design a schema where each customer is a single item with a partition key of `customer_id` and a sort key of `metadata`. Related orders become separate items with a partition key of `customer_id` and sort keys like `order#123`. DMS can be configured with mapping rules that implement this transformation automatically across millions of rows.

The catch? DMS requires careful throughput planning. When you create a task in DMS, the service reads from your source in batches and writes to DynamoDB using batch operations. If your DynamoDB table isn't provisioned with enough write capacity units (WCUs), you'll hit throttling, and the migration will slow to a crawl. The solution is often to temporarily over-provision write capacity during the migration—scale it up to On-Demand billing or increase provisioned WCUs significantly, then scale back down once the migration completes. DMS includes a helpful "batch apply" feature that lets you tune how many items are written in each batch, giving you fine-grained control over throughput.

### S3 Import to DynamoDB for Bulk Loads

When you need to load a large volume of data all at once and you have the source data available in S3, the S3 import feature (sometimes called "import from S3") is often the fastest and most cost-effective approach. This feature allows you to bypass the batch write API entirely and load data directly from S3 into a new or existing DynamoDB table, dramatically accelerating the process compared to traditional write operations.

The S3 import works with data in DynamoDB JSON format, which is a specific representation where each attribute includes its type. A simple example:

```json
{
  "customer_id": {"S": "cust-12345"},
  "name": {"S": "Jane Doe"},
  "age": {"N": "32"},
  "active": {"BOOL": true},
  "tags": {"SS": ["vip", "early-adopter"]}
}
```

Each line in your S3 file should be one of these JSON objects. The import process reads directly from S3, validates the items, and writes them into DynamoDB without going through your application or the batch write API. This is remarkably efficient—you can load gigabytes of data in minutes rather than hours.

To prepare data for import, you'll often use AWS Glue or a custom script to transform your source data (whether that's CSV, JSON, Parquet, or a relational database dump) into DynamoDB JSON format. If you're exporting from PostgreSQL, for instance, you might use `psql` to dump to CSV, then run a Glue job or Lambda function that converts each row into the proper DynamoDB JSON representation, writing the results to S3.

One important consideration: S3 import creates a temporary snapshot of your table structure and data. If you're importing into an existing table that has live traffic, there can be brief consistency considerations, though AWS handles this gracefully. For large migrations, many teams prefer to import into a fresh table, validate the data, then switch over the application traffic—a pattern that's safer and more testable.

The S3 import feature also respects on-demand billing and doesn't require you to provision write capacity in advance, which is a nice financial advantage if you're doing a one-time bulk load. There's no need to temporarily increase WCUs and then scale them back down.

### The AWS Data Pipeline Approach (Legacy)

You may encounter AWS Data Pipeline in existing codebases or documentation, particularly in organizations that have been running on AWS for a long time. Data Pipeline was one of AWS's original workflow orchestration services, designed to move data between services on a schedule. While it still functions, it's largely been superseded by more modern tools like AWS Glue and Step Functions.

If you're looking at Data Pipeline in the context of DynamoDB migration, the typical pattern was to schedule a pipeline activity that exports data from a relational database, stages it in S3, and then triggers a script or Lambda function to load it into DynamoDB. The orchestration was valuable—it let you chain multiple steps together and handle retries—but the underlying mechanics weren't fundamentally different from what you'd do with a cron job or Step Functions today.

The main reason to understand Data Pipeline in a modern context is historical awareness. If you're maintaining legacy infrastructure that uses it, you're not wrong—it works. But if you're starting a new migration, investing in Data Pipeline isn't recommended. Step Functions offers more flexibility, better visibility, and tighter integration with modern AWS services. Similarly, AWS Glue is specifically designed for ETL and includes Python/Scala support, making complex transformations easier than they were with Data Pipeline's limited expression language.

That said, if you inherit a Data Pipeline setup that's humming along reliably, there's no urgent reason to rip it out and replace it. Migration tools are means to an end, and a working system beats a shiny new one that introduces new failure modes.

### Custom ETL with AWS Lambda

For smaller migrations, more complex transformation logic, or cases where you need fine-grained control, writing custom ETL code with Lambda offers flexibility that managed services can't match. Lambda is event-driven, scalable, and integrates seamlessly with other AWS services—you can read from S3, transform data, and write to DynamoDB, all within a single function.

A simple Lambda-based migration might look like this: an S3 event triggers when a CSV file is uploaded, the Lambda function reads the file, parses each row, transforms it into DynamoDB item format, and writes batches of items using the DynamoDB `batch_write_item` API. Here's a sketch in Python:

```python
import json
import boto3
import csv
from io import BytesIO

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')

def lambda_handler(event, context):
    table = dynamodb.Table('my-table')
    
    # Get the S3 object from the event
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = event['Records'][0]['s3']['object']['key']
    
    # Read CSV from S3
    response = s3.get_object(Bucket=bucket, Key=key)
    csv_data = response['Body'].read().decode('utf-8')
    
    reader = csv.DictReader(BytesIO(csv_data.encode('utf-8')))
    
    with table.batch_writer(
        batch_size=25,
        overwrite_by_pkeys=['customer_id']
    ) as batch:
        for row in reader:
            item = {
                'customer_id': row['id'],
                'name': row['name'],
                'email': row['email'],
                'created_at': int(row['timestamp'])
            }
            batch.put_item(Item=item)
    
    return {
        'statusCode': 200,
        'body': json.dumps('Migration completed')
    }
```

The `batch_writer` context manager is particularly useful here—it automatically batches writes and retries on throttling, which is crucial when you're pushing data into DynamoDB at scale. Without this helper, you'd need to manually implement batching and exponential backoff yourself.

Lambda's 15-minute timeout is a real constraint, though. If your migration dataset is large or your transformations are complex, you'll exceed the timeout. The solution is to break the problem into smaller chunks: have Lambda process one file or one partition at a time, triggering the next invocation from your orchestration layer (Step Functions, EventBridge, or even a simple SQS queue-driven architecture).

### Custom ETL with AWS Glue

For larger, more complex migrations, AWS Glue is the better choice than Lambda. Glue is a fully managed ETL service built on Apache Spark, meaning it can parallelize your workload across multiple executors and handle enormous datasets that would never fit in Lambda's memory constraints.

A Glue job can read from various sources (S3, relational databases, Kinesis, etc.), apply complex transformations using PySpark or Scala, and write directly to DynamoDB. Glue handles the scaling automatically—you define the job, specify the number of workers, and Glue spins up the cluster, executes your code, tears down the cluster, and charges you only for what you used.

Here's an example Glue job skeleton in PySpark that reads from S3 and writes to DynamoDB:

```python
import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

args = getResolvedOptions(sys.argv, ['JOB_NAME'])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Read CSV from S3
df = spark.read.option("header", "true").csv("s3://my-bucket/data.csv")

# Transform: add a timestamp, rename columns
from pyspark.sql.functions import current_timestamp, col
df = df \
    .withColumnRenamed("id", "customer_id") \
    .withColumn("loaded_at", current_timestamp())

# Write to DynamoDB
glueContext.write_dynamic_frame.from_options(
    frame=DynamicFrame.fromDF(df, glueContext, "transformed"),
    connection_type="dynamodb",
    connection_options={
        "dynamodb.output.tableName": "my-table",
        "dynamodb.throughput.write.percent": "1.5"
    }
)

job.commit()
```

The `dynamodb.throughput.write.percent` option is worth highlighting. When Glue writes to DynamoDB, it respects your table's write capacity. If you're using provisioned throughput, you can tell Glue to consume up to a percentage of your available capacity (1.5 means 150% if you're using On-Demand billing, which autoscales). If you're hitting throttling, you can either increase this percentage or temporarily increase your WCU allocation.

Glue also provides excellent visibility into what went wrong. Failed records are typically logged and can be written to a separate S3 location, making debugging much easier than with Lambda where you're limited to CloudWatch logs.

### Handling Throughput and Capacity During Migration

Regardless of which tool you choose, the throughput challenge is universal. DynamoDB charges for write capacity, and if you're doing a large migration, you need to think carefully about whether you're provisioning enough capacity to avoid throttling.

There are several strategies here. The simplest is to scale up your write capacity units (WCUs) before the migration starts. If your table normally runs on 100 WCUs, you might temporarily increase it to 1000 or 10000 for the duration of the migration. Each WCU allows 1 write per second, so if you need to write 1 million items, you can calculate roughly how long it will take at a given WCU level. Once the migration completes, scale back down. AWS charges for provisioned capacity hourly, so this temporary spike is manageable if you're only running it for a few hours.

The alternative is to use On-Demand billing mode during the migration. Instead of provisioning capacity upfront, you pay per request. This means DynamoDB automatically scales to whatever throughput you need, up to limits that AWS enforces to prevent runaway costs. There's a slight per-request cost premium compared to provisioned capacity, but you avoid the overhead of capacity planning. Many teams enable On-Demand for the migration, then switch back to provisioned capacity for the steady-state workload once the migration is complete. This avoids both throttling and unnecessary spending.

Some tools give you knobs to control write rates. DMS, for instance, has batch size and commit rate settings. Glue has the throughput percentage option. If you're using custom Lambda code with the batch writer, you can adjust the batch size. Starting conservatively and increasing gradually allows you to find the sweet spot—maximum throughput without throttling.

One subtle point: if you're importing into an existing table that has live traffic, you're competing with that traffic for capacity. If your application is writing 200 WCUs and you allocate 500 total, your migration only gets 300 WCUs to work with. This is another reason many teams prefer to migrate into a fresh table and then switch over application traffic.

### Error Handling and Retry Logic

Data migrations are inherently error-prone. Network hiccups, malformed data, constraint violations, and throttling all introduce failure modes. Robust error handling is the difference between a successful migration and one that leaves you debugging inconsistencies for days.

Most AWS tools include built-in retry logic. DMS has configurable task settings that control how many times a failed batch is retried before being written to an error log. The batch writer in Python SDKs includes exponential backoff and retries. Glue writes failed records to a separate location. Lean on these mechanisms—they're battle-tested and often better than anything you'd write yourself.

For custom code, implement idempotent writes. Design your migration so that writing the same item twice produces the same result as writing it once. This is particularly important if you need to resume a migration that was interrupted. If you write item A, then the process crashes, and you restart from the beginning, you want item A to be overwritten with the same data, not to create duplicates or error out.

One pattern is to use DynamoDB's conditional writes. Instead of blindly overwriting, you can specify that an item should only be written if it doesn't exist, or only if a certain timestamp attribute hasn't been updated recently. This gives you some protection against race conditions and double-writes.

Logging is also non-negotiable. At a minimum, log the number of items processed, the number of errors, and any items that failed. Store these logs somewhere durable (CloudWatch, S3, or a DynamoDB table) so you can review them after the migration. If things go wrong, you'll want to know exactly which items failed and why.

### Validating the Migrated Data

Once the data is loaded, how do you know it actually made it correctly? Validation is often the step teams skimp on, to their later regret. A few weeks after the migration, someone notices that customer IDs are off by one, or timestamps are in the wrong timezone, or a subset of records simply didn't transfer. At that point, you're in firefighting mode.

Validation happens at multiple levels. The first is structural—did all the items actually land in DynamoDB? A simple count comparison is a starting point: how many rows did you have in the source, and how many items are now in the target table? If the counts don't match, something went wrong.

The second level is sampling. Pick a random subset of items—say, 1% of the data—and manually verify that they're correct. Check that partition keys are present and correct, that sort keys (if applicable) are as expected, and that attributes match the source data. If you migrated from a relational database, compare a few items side-by-side to ensure transformations happened correctly.

The third level is application testing. If possible, point a staging copy of your application at the new DynamoDB table and run your integration tests against it. This catches issues that aren't obvious from data structure alone—missing attributes that your code depends on, incorrect data types, or subtle transformation bugs.

For large migrations, consider writing a validation script that spot-checks items in both the source and target. This could be a Lambda function that randomly selects customer IDs, fetches the corresponding item from both systems, and compares them field by field. Glue is also good for this—write a job that reads from both the source database and DynamoDB, joins them on key attributes, and produces a report of differences.

Finally, if your migration was supposed to be a one-time event, establish a rollback plan. Keep the old system available for a period after the migration—a few days, a week, or longer depending on your risk tolerance. If validation uncovers a serious issue, you can quickly revert application traffic to the old system while you investigate and fix the problem.

### Choosing the Right Approach for Your Scenario

Each migration tool has strengths and weaknesses. DMS is your choice when you're migrating from a relational database and need ongoing replication or a large-scale, complex transformation. It handles the schema mapping and change capture, reducing your implementation burden. The tradeoff is operational complexity—you're managing a replication instance and task configuration.

S3 import is ideal for bulk one-time loads where your data is already in S3 or easy to get there. It's fast, cost-effective, and requires minimal code. The limitation is that it only works for one-time imports into new tables or for importing into existing tables with specific considerations.

Custom Lambda ETL shines when your migration is small, your transformations are simple, or you need very fine-grained control. It's low-overhead to build and deploy, and it integrates naturally with event-driven architectures. It breaks down when your data volume is large or your transformations are complex.

AWS Glue is the workhorse for larger, more complex migrations. It parallelizes your work, handles massive datasets, and scales automatically. The cost is higher than Lambda for small migrations, and the operational overhead is greater, but for jobs that touch hundreds of gigabytes or terabytes, it's the right tool.

In practice, many large migrations combine multiple approaches. You might use DMS to handle the bulk of the data from your relational database, then use Glue to clean up and transform the data into the optimal DynamoDB schema, then use Lambda to enrich it with data from other sources. Each tool does what it does best, and the orchestration layer (Step Functions, typically) ties it all together.

### Conclusion

Data migration to DynamoDB is a solvable problem—AWS provides multiple well-designed tools that handle different scenarios effectively. The key is matching the tool to your specific situation: source data type, volume, transformation complexity, and whether you need ongoing replication or a one-time load.

Start by clearly understanding your starting point and end goal. Assess your data volume and schema complexity. Then choose the tool that minimizes implementation burden while meeting your throughput and reliability requirements. Plan for capacity during the migration, implement robust error handling and logging, and invest in validation. With these pieces in place, you can migrate confidently, knowing that your data arrived safely and correctly in its new home.
