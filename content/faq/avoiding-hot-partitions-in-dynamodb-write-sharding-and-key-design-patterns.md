---
title: "Avoiding Hot Partitions in DynamoDB: Write Sharding and Key Design Patterns"
---

## Avoiding Hot Partitions in DynamoDB: Write Sharding and Key Design Patterns

DynamoDB's promise of seamless scalability makes it an attractive choice for modern applications. You provision capacity, your data is automatically partitioned across multiple nodes, and your queries run fast. But this promise breaks down dramatically when you concentrate your writes on a small number of partition keys. When all your traffic hits the same underlying partition, you experience throttling, latency spikes, and degraded performance—regardless of your provisioned capacity. This is the hot partition problem, and it's one of the most common performance challenges developers face with DynamoDB.

Understanding how DynamoDB maps your logical keys to physical partitions, recognizing the signs of a hot partition, and learning concrete design patterns to distribute your load are essential skills for building scalable applications. Let's explore this problem in depth and discover practical techniques to keep your partitions cool.

### Understanding DynamoDB's Partition Architecture

To fix hot partitions, you first need to understand how DynamoDB actually stores your data. When you create a DynamoDB table, you're not creating a single file or database. Instead, AWS divides your table across multiple partitions—physical storage nodes distributed across availability zones. Each partition stores a contiguous range of items, determined by your partition key values.

Here's the critical part: the partition that stores your data is determined entirely by the partition key. DynamoDB applies an internal hashing function to your partition key, and that hash determines which physical partition owns that item. This is elegant and usually invisible—until it isn't.

Imagine you're building a user notification system. Your partition key is `userId`. Most of your application's users are sleeping, but a few high-profile users get thousands of notifications per second. All of those notifications share the same partition key, so they all hash to the same physical partition. That one partition suddenly bears 10,000 writes per second, while other partitions sit idle. You've created a hot partition.

The problem becomes worse if your partition key is something with limited cardinality. Many teams use `tenantId` as their partition key for multi-tenant systems. If one tenant is significantly more active than others, that tenant's partition becomes hot. If you use `status` as a partition key and most of your items have status `ACTIVE`, you've just created a hot partition by design.

### How Adaptive Capacity Helps—And Where It Falls Short

AWS introduced adaptive capacity to mitigate this exact problem. When it detects that a particular partition is consuming more throughput than allocated, DynamoDB automatically grants additional capacity to that partition, borrowing from underutilized ones. This is a powerful safety net, and it has saved many developers from complete disaster.

However, adaptive capacity is not a cure-all. It has limitations you must understand. First, it operates on a per-partition basis, not per-key. If your partition key `userId` maps to a partition that's consuming 10,000 write units per second when you only provisioned 100, adaptive capacity can help—but only up to a point. AWS won't grant unlimited capacity; there are practical limits based on your table's overall provisioned throughput and available capacity on other partitions.

Second, adaptive capacity has a delay. When a spike hits, it takes time for CloudWatch metrics to update, for AWS to detect the problem, and for capacity to be reallocated. During that window, you'll experience throttling. For latency-sensitive applications, that delay is unacceptable.

Third, and most importantly, adaptive capacity doesn't prevent the problem—it merely reduces its impact. The fundamental issue remains: you're concentrating load on a small number of physical partitions. The better solution is to prevent hot partitions from forming in the first place through smart key design.

### Write Sharding: Distributing Load Across Partitions

Write sharding is the primary technique for solving hot partitions, and it works by intentionally spreading writes across multiple partition keys. Instead of using a single partition key value, you create multiple variations of it, distributing your writes across each variation.

The simplest form of write sharding is adding a random suffix to your partition key. Let's say you're logging events for a user, and your current schema uses `userId` as the partition key:

```python
import boto3
import uuid
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('user-events')

user_id = 'user-12345'
event_data = {
    'userId': user_id,
    'timestamp': Decimal(str(time.time())),
    'eventType': 'page_view',
    'pageUrl': '/dashboard'
}

# Write the event
table.put_item(Item=event_data)
```

This works fine for low-volume users, but if user 12345 is generating thousands of events per second, you'll create a hot partition. To fix it, add a random suffix:

```python
import random

user_id = 'user-12345'
shard_id = random.randint(0, 9)  # Distribute across 10 shards
partition_key = f"{user_id}#{shard_id}"

event_data = {
    'userId': partition_key,
    'timestamp': Decimal(str(time.time())),
    'eventType': 'page_view',
    'pageUrl': '/dashboard'
}

table.put_item(Item=event_data)
```

Now your writes are randomly distributed across 10 different partition keys: `user-12345#0`, `user-12345#1`, `user-12345#2`, and so on. Instead of one partition handling 1,000 writes per second, you now have 10 partitions each handling roughly 100 writes per second. You've effectively multiplied your write capacity by distributing the load.

The number of shards you choose depends on your expected peak write rate. If you expect a user might generate 5,000 writes per second and your partition can handle 1,000, you need at least 5 shards. It's better to over-shard than under-shard; extra shards don't hurt performance, but insufficient sharding doesn't solve the problem.

### Deterministic Sharding for Consistency

Random sharding works, but it has a drawback: when you write, you pick a random shard, but when you later query that data, you don't know which shard you wrote to. This makes retrieval difficult. If you need to retrieve all events for a user, you must query all 10 partition keys and aggregate the results. This is called a scatter-gather operation, and it increases latency.

A better approach for many use cases is deterministic sharding, where you calculate which shard an item belongs to based on a property of the data itself. This way, you can write to the same shard and retrieve from the same shard without guessing.

```python
import hashlib

user_id = 'user-12345'
event_id = 'event-67890'

# Deterministically pick a shard based on event_id
shard_id = int(hashlib.md5(event_id.encode()).hexdigest(), 16) % 10
partition_key = f"{user_id}#{shard_id}"

# When you write
event_data = {
    'userId': partition_key,
    'eventId': event_id,
    'timestamp': Decimal(str(time.time())),
    'eventType': 'page_view'
}
table.put_item(Item=event_data)

# When you read the same event later
response = table.get_item(Key={'userId': partition_key, 'eventId': event_id})
```

By hashing the event ID and taking modulo 10, you ensure that the same event always maps to the same shard. This lets you read data deterministically without scatter-gather queries.

### Time-Based Bucketing for Time-Series Data

Many applications naturally generate time-series data: logs, metrics, transactions, or user activity. DynamoDB is excellent for storing this data, but time-series patterns can create hot partitions if you're not careful. All events happening "right now" share the same timestamp and might naturally cluster around a few partition key values.

Time-based bucketing addresses this by including a time bucket in your partition key. Instead of using just `userId`, you use `userId#date` or `userId#hour`:

```python
from datetime import datetime, timezone

user_id = 'user-12345'
now = datetime.now(timezone.utc)
time_bucket = now.strftime('%Y-%m-%d')  # Daily bucket

partition_key = f"{user_id}#{time_bucket}"
sort_key = int(now.timestamp())

event_data = {
    'userId': partition_key,
    'timestamp': sort_key,
    'eventType': 'purchase',
    'amount': Decimal('99.99')
}

table.put_item(Item=event_data)
```

This approach is particularly elegant because it naturally aligns with your query patterns. Most time-series queries ask for "all events for user X in the last day" or "all events for user X in January." By bucketing by day or month, you can query a single partition key for that entire time window.

The trade-off is that old data becomes isolated in old partitions. If you query across multiple days, you'll need scatter-gather queries:

```python
from datetime import timedelta

user_id = 'user-12345'
start_date = datetime(2024, 1, 1, tzinfo=timezone.utc)
end_date = datetime(2024, 1, 10, tzinfo=timezone.utc)

# Query each day separately
current_date = start_date
all_events = []

while current_date < end_date:
    bucket = current_date.strftime('%Y-%m-%d')
    partition_key = f"{user_id}#{bucket}"
    
    response = table.query(
        KeyConditionExpression='userId = :pk',
        ExpressionAttributeValues={':pk': partition_key}
    )
    
    all_events.extend(response['Items'])
    current_date += timedelta(days=1)
```

You're querying 10 different partition keys, one for each day, and combining the results. This is more work than a single query, but it distributes load across time and prevents your current day's partition from becoming a hot spot.

### Combining Sharding with Bucketing

For maximum protection against hot partitions, you can combine time-based bucketing with write sharding. This ensures load is distributed across both time and logical shards:

```python
import random
from datetime import datetime, timezone

user_id = 'user-12345'
now = datetime.now(timezone.utc)
time_bucket = now.strftime('%Y-%m-%d')
shard_id = random.randint(0, 4)

partition_key = f"{user_id}#{time_bucket}#{shard_id}"
sort_key = int(now.timestamp())

event_data = {
    'userId': partition_key,
    'timestamp': sort_key,
    'eventType': 'click',
    'data': 'some event data'
}

table.put_item(Item=event_data)
```

Now a user's write load is spread across 5 shards for each day. This provides excellent protection against hot partitions, but it makes querying more complex. When you want all events for a user in a day, you must query all 5 shards:

```python
from datetime import datetime, timezone

user_id = 'user-12345'
target_date = '2024-01-15'
all_events = []

for shard_id in range(5):
    partition_key = f"{user_id}#{target_date}#{shard_id}"
    
    response = table.query(
        KeyConditionExpression='userId = :pk',
        ExpressionAttributeValues={':pk': partition_key}
    )
    
    all_events.extend(response['Items'])

# Sort all events by timestamp
all_events.sort(key=lambda x: x['timestamp'])
```

This scatter-gather operation queries 5 partition keys and merges the results. It's more expensive than a single query, but it prevents a single partition from becoming overloaded. The trade-off is a fundamental one in distributed systems: you can optimize for write performance by spreading load, or optimize for read performance by concentrating data, but doing both is difficult.

### Detecting Hot Partitions with CloudWatch

Before you can fix hot partitions, you need to detect them. CloudWatch provides metrics that help. The `ConsumedWriteCapacityUnits` metric shows how many write capacity units you're actually consuming. If you see this metric consistently at the high end of your provisioned capacity, you likely have hot partitions.

More specifically, look for `UserErrors` and `SystemErrors` metrics. `UserErrors` include throttling exceptions (`ProvisionedThroughputExceededException`). If you see regular spikes in `UserErrors`, you almost certainly have hot partitions:

```python
import boto3
from datetime import datetime, timedelta

cloudwatch = boto3.client('cloudwatch')

response = cloudwatch.get_metric_statistics(
    Namespace='AWS/DynamoDB',
    MetricName='UserErrors',
    Dimensions=[
        {
            'Name': 'TableName',
            'Value': 'user-events'
        }
    ],
    StartTime=datetime.utcnow() - timedelta(hours=1),
    EndTime=datetime.utcnow(),
    Period=60,
    Statistics=['Sum']
)

for datapoint in response['Datapoints']:
    if datapoint['Sum'] > 0:
        print(f"Throttling detected at {datapoint['Timestamp']}: {datapoint['Sum']} errors")
```

CloudWatch doesn't provide partition-level metrics directly, but you can infer partition-level problems from application-level errors. If specific queries or operations consistently fail with throttling exceptions, and you've confirmed your overall table throughput is healthy, you likely have a hot partition associated with those queries.

For more detailed diagnostics, enable DynamoDB Streams and CloudWatch Logs. Streams capture all write operations, and you can analyze them to see which partition keys are generating the most traffic:

```python
import json
import boto3

dynamodb = boto3.client('dynamodb')

stream_arn = dynamodb.describe_table(TableName='user-events')['Table']['LatestStreamArn']

# Stream records are processed by a Lambda function
def lambda_handler(event, context):
    partition_key_counts = {}
    
    for record in event['Records']:
        dynamodb_record = record['dynamodb']
        partition_key = dynamodb_record['Keys']['userId']['S']
        
        partition_key_counts[partition_key] = partition_key_counts.get(partition_key, 0) + 1
    
    # Identify hot keys
    hot_keys = {k: v for k, v in partition_key_counts.items() if v > 100}
    if hot_keys:
        print(f"Hot partition keys detected: {hot_keys}")
```

By processing stream records, you can identify which partition keys are receiving disproportionate traffic and confirm that hot partitions are forming.

### The Query Penalty: Scatter-Gather Trade-offs

Write sharding solves the hot partition problem, but it introduces a query penalty. When you shard your writes, you fragment your data across multiple partition keys. Retrieving all related items requires multiple queries.

Consider a simple case: a user profile that stores attributes like name, email, and preferences. Without sharding, you store everything under a single `userId` partition key. A single query returns everything:

```python
response = table.get_item(Key={'userId': 'user-12345'})
user_data = response['Item']
```

With sharding, you might split the data across multiple partition keys:

```python
response1 = table.get_item(Key={'userId': 'user-12345#0'})
response2 = table.get_item(Key={'userId': 'user-12345#1'})
response3 = table.get_item(Key={'userId': 'user-12345#2'})

user_data = {**response1['Item'], **response2['Item'], **response3['Item']}
```

Now you need three queries instead of one. You're paying higher latency and consuming more read capacity units. This is the fundamental trade-off: you've solved write hotness at the cost of read complexity and throughput.

The best sharding strategies minimize this penalty. Time-based bucketing is elegant because it aligns with natural query patterns—you usually want data within a specific time range, which maps to one or a few buckets. Random sharding is worst for reads because you have no way to predict which shard holds the data you want.

A middle ground is deterministic sharding based on a property other than the primary data you're querying. For instance, if you shard by `eventId` hash but query by `userId`, you can query all shards and aggregate. But if your queries consistently ask for "all events for user X in the last day," time-based bucketing is superior because it lets you query a single bucket.

### Choosing Your Sharding Strategy

Different situations call for different strategies. Let's consider a few scenarios.

**High-volume single item updates**: If you have a single item that receives thousands of updates per second (like a real-time counter or leaderboard entry), use write sharding with a numeric suffix:

```python
item_id = 'leaderboard#game-1'
shard_count = 10
shards = [{'itemId': f"{item_id}#{i}", 'score': 0} for i in range(shard_count)]

# When updating, randomly pick a shard
import random
shard = shards[random.randint(0, shard_count - 1)]

# Increment the score
table.update_item(
    Key={'itemId': shard['itemId']},
    UpdateExpression='ADD score :inc',
    ExpressionAttributeValues={':inc': 1}
)

# To get the total, query all shards and sum
total_score = sum(table.get_item(Key={'itemId': shard['itemId']})['Item']['score'] for shard in shards)
```

**Time-series data with time-aligned queries**: If your access pattern is "give me data for the last 24 hours," use daily bucketing:

```python
user_id = 'user-12345'
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
partition_key = f"{user_id}#{today}"

table.put_item(Item={
    'userId': partition_key,
    'timestamp': int(datetime.now(timezone.utc).timestamp()),
    'metric': 'cpu_usage',
    'value': 45.2
})

# Query today's data
response = table.query(
    KeyConditionExpression='userId = :pk',
    ExpressionAttributeValues={':pk': partition_key}
)
```

**Multi-tenant data with unpredictable hotspots**: If you can't predict which tenants will be hot, combine time-bucketing with random sharding:

```python
tenant_id = 'tenant-456'
time_bucket = datetime.now(timezone.utc).strftime('%Y-%m-%d')
shard_id = random.randint(0, 4)

partition_key = f"{tenant_id}#{time_bucket}#{shard_id}"

table.put_item(Item={
    'tenantId': partition_key,
    'timestamp': int(datetime.now(timezone.utc).timestamp()),
    'action': 'user_login',
    'userId': 'some-user'
})
```

### Monitoring and Adaptive Strategies

In production, hot partitions don't always appear at design time. A new feature launches, usage patterns shift, and suddenly a partition that handled 100 writes per second is handling 5,000. This is where adaptive strategies help.

One approach is to monitor your table's metrics and dynamically adjust your sharding strategy. If you notice throttling on a specific partition key, increase the number of shards:

```python
import boto3

cloudwatch = boto3.client('cloudwatch')
dynamodb = boto3.client('dynamodb')

def check_partition_health(table_name, partition_key_value):
    # Check for recent throttling
    response = cloudwatch.get_metric_statistics(
        Namespace='AWS/DynamoDB',
        MetricName='UserErrors',
        Dimensions=[{'Name': 'TableName', 'Value': table_name}],
        StartTime=datetime.utcnow() - timedelta(minutes=5),
        EndTime=datetime.utcnow(),
        Period=60,
        Statistics=['Sum']
    )
    
    total_errors = sum(dp['Sum'] for dp in response['Datapoints'])
    
    if total_errors > 10:
        print(f"Partition {partition_key_value} may be hot. Consider increasing shards.")
        # In production, you might log this or trigger an alert
        return False
    return True
```

Another approach is to over-shard from the start. If you think you might need 5 shards, use 20. The extra shards don't hurt; they just sit mostly idle. If your traffic spikes, you already have capacity distributed across many partitions.

The downside is increased query complexity. You can mitigate this by using batch operations when reading:

```python
user_id = 'user-12345'
date_bucket = '2024-01-15'
shard_count = 20

partition_keys = [f"{user_id}#{date_bucket}#{i}" for i in range(shard_count)]

# Batch read from all shards
request_items = {
    'user-events': {
        'Keys': [{'userId': pk} for pk in partition_keys]
    }
}

response = dynamodb.batch_get_item(RequestItems=request_items)
all_items = response['Responses']['user-events']
```

Batch operations are more efficient than individual queries. They're your friend when implementing scatter-gather patterns.

### Real-World Considerations

Sharding adds complexity, and it's worth asking whether you actually need it. If your table receives millions of requests per second spread across thousands of users, sharding is essential. If your table receives thousands of requests per second for a small number of items, sharding is critical. If your table receives moderate traffic with good distribution across partition keys, you might not need sharding at all.

Also consider your access patterns. If queries are simple and align naturally with your sharding strategy, the cost is low. If queries are complex and require scatter-gather across many shards, the cost is high. Sometimes a better solution is to denormalize your data differently or use a different storage layer entirely.

DynamoDB Global Secondary Indexes (GSIs) can also help with hot partitions in some scenarios. An index with a different partition key distributes traffic differently. If user-12345 is hot because of a specific access pattern, you might create a GSI that queries by a different attribute, spreading that traffic across different partitions. However, this requires careful design because GSIs have their own throughput and can become hot themselves.

Finally, remember that hot partitions are often a symptom of a deeper issue. If one user generates vastly more traffic than others, why? Are they a test account that should be filtered out? Are they running a load test? Are they abusing the system? Sometimes the best solution to a hot partition is to handle the root cause, not work around it.

### Conclusion

Hot partitions in DynamoDB are a real challenge, but they're entirely avoidable with careful design. The key insight is that DynamoDB distributes data across physical partitions based on your partition key, and concentrating writes on a small number of keys creates bottlenecks that even adaptive capacity can't fully resolve.

Write sharding—distributing your writes across multiple variations of your partition key—is the primary solution. Whether you use random suffixes, time-based bucketing, deterministic hashing, or a combination depends on your access patterns and traffic characteristics. The trade-off is increased query complexity, but modern applications can handle scatter-gather operations efficiently using batch operations.

The path forward is to understand your table's access patterns deeply. Profile your production traffic. Monitor CloudWatch metrics for signs of throttling. Design your partition keys with sharding in mind from the start, even if you don't initially need it. And be willing to evolve your strategy as your application grows and usage patterns change. With these practices, you'll keep your partitions cool and your application responsive.
