---
title: "CloudFront Real-Time Logs and Standard Access Logs: Monitoring Your Distribution"
---

## CloudFront Real-Time Logs and Standard Access Logs: Monitoring Your Distribution

Every request flowing through your CloudFront distribution tells a story. Who's accessing your content? Where are they coming from? Are they getting cache hits or misses? How long did the request take? Understanding what happened at your edge requires visibility, and CloudFront gives you two distinct mechanisms to gain that visibility: standard access logs and real-time logs. These aren't interchangeable tools—each solves different problems, operates under different constraints, and costs you differently. Knowing when and how to use each one is essential for building observable, maintainable applications on AWS.

### Understanding CloudFront's Two Logging Mechanisms

CloudFront offers two ways to monitor traffic flowing through your distribution, and they represent fundamentally different trade-offs between latency, completeness, and cost.

**Standard access logs** have been CloudFront's default offering for years. When you enable them, CloudFront batches up request data and periodically writes log files to an Amazon S3 bucket you specify. These logs contain every single field CloudFront can track about each request—the full story, held in files that typically arrive within a few minutes to a couple of hours. The catch is the latency: by the time you see a log entry, the request is old news. The upside is the cost: standard access logs are completely free. CloudFront doesn't charge you for generating or delivering them; you only pay S3's storage and data transfer costs.

**Real-time logs**, introduced more recently, flip the priority. Instead of batching data into files destined for S3, real-time logs stream request data through Amazon Kinesis Data Streams within seconds of the actual request. This means you can detect anomalies, trigger automated responses, or populate dashboards while the problem is still happening. The trade-off is that you choose which fields to log (reducing noise and data volume) and you can set a sampling rate so you don't capture every single request. More importantly, you pay for the Kinesis Data Streams throughput you consume—making real-time logs a premium feature suited to specific use cases rather than a default for every distribution.

Think of it this way: standard access logs are your permanent record, your audit trail, your source of truth for batch analytics and compliance. Real-time logs are your operational heartbeat, your early warning system, your window into what's happening right now.

### The Anatomy of CloudFront Log Entries

To make sense of either log type, you need to understand what CloudFront actually records about each request.

Standard access logs produce tab-delimited files with a consistent, rich schema. Each line represents one request and includes fields like the timestamp, client IP address, the HTTP method and URI, the HTTP status code returned, the number of bytes sent to the client, the referrer and user agent, the CloudFront edge location that handled the request, the request ID, the hostname, and the protocol (HTTP or HTTPS). You also get performance metrics: how long CloudFront took to process the request, cache status (hit, miss, error), and whether the request was served from the origin or the edge. Additional fields track the HTTP version, whether the request came from a bot, and details about SSL/TLS negotiation if applicable.

A typical standard access log entry might look like this:

```
2024-01-15	10:32:45	LAX50	192.0.2.100	GET	/images/banner.png	200	45632	https	d123.cloudfront.net	Mozilla/5.0...	Hit	-	0.042	-	-	-	TLSv1.3	ECDHE-RSA-AES128-GCM-SHA256	-	-	-	-
```

The fields flow from left to right: date, time, edge location, client IP, method, URI, status, bytes sent, protocol, distribution domain name, and so on. The exact number and order of fields is defined by CloudFront's schema, and you should consult the AWS documentation to understand every field's meaning.

Real-time logs don't include all these fields by default. Instead, you define a sampling rate and choose which fields you want streamed to Kinesis. This selectivity is partly a performance optimization—why stream data you won't use?—and partly a cost control mechanism. You might capture the timestamp, client IP, edge location, HTTP status, cache status, and bytes sent, omitting fields less relevant to your monitoring goals. The format is JSON rather than tab-delimited, making it easier to parse programmatically.

A real-time log entry streamed to Kinesis might look like:

```json
{
  "timestamp": 1705328365000,
  "clientIp": "192.0.2.100",
  "edgeLocation": "LAX50",
  "httpStatus": 200,
  "cacheStatus": "Hit",
  "bytesSent": 45632
}
```

### Enabling and Configuring Standard Access Logs

Setting up standard access logs is straightforward. You need an S3 bucket where CloudFront can write the logs, and CloudFront needs permission to put objects in that bucket.

Start by creating or designating an S3 bucket for your logs. It doesn't need to be in any particular region, though placing it in the same region as your origin can be cost-effective. CloudFront will create a folder structure inside: typically, logs are written to a path like `s3://my-logs-bucket/logs/d123.cloudfront.net/`, with individual log files arriving periodically.

Next, configure the bucket policy to grant CloudFront write access. Here's a minimal policy that allows CloudFront to put objects:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-logs-bucket/logs/*"
    }
  ]
}
```

In the AWS Console, navigate to your CloudFront distribution settings and find the "Logging" section. Enable logging, specify your S3 bucket, and optionally provide a log prefix (like `logs/my-app/`) to organize files. Save your changes, and CloudFront begins writing logs to S3 within minutes.

The logs arrive in batches, typically within a few minutes but sometimes up to an hour, depending on traffic volume and CloudFront's internal scheduling. Each log file is gzip-compressed and named with a timestamp, making it easy to identify when the log was generated.

### Enabling and Configuring Real-Time Logs

Real-time logs require more setup because you need to create a Kinesis Data Stream and define a logging configuration that specifies which fields to capture.

First, create a Kinesis Data Stream in the same AWS account (though not necessarily the same region as your distribution). CloudFront will push log records into this stream as requests occur. Decide on your shard count based on expected throughput: each shard can ingest up to 1 MB per second or 1,000 records per second. For most distributions, a single shard is sufficient; high-traffic distributions may need more.

Next, create a real-time log configuration in CloudFront. This configuration specifies:

- The Kinesis Data Stream ARN where logs should be sent
- The fields you want to capture (choosing from CloudFront's available field list)
- The sampling rate (from 1 to 100 percent)

For example, you might create a configuration that samples 10% of requests and captures timestamp, client IP, edge location, HTTP status, cache status, and bytes sent. This reduces your Kinesis costs while still giving you visibility into traffic patterns.

Here's how you might create a real-time log configuration using the AWS CLI:

```bash
aws cloudfront create-realtime-log-config \
  --name my-realtime-logs \
  --endpoints StreamType=Kinesis,KinesisStreamConfig={RoleArn=arn:aws:iam::123456789012:role/CloudFrontLogsRole,StreamArn=arn:aws:kinesis:us-east-1:123456789012:stream/cloudfront-logs} \
  --fields timestamp clientIp edgeLocation httpStatus cacheStatus bytesSent \
  --sampling-rate 10
```

Once the configuration is created, you attach it to your CloudFront distribution. From that moment, CloudFront begins streaming log records into your Kinesis Data Stream at the configured sampling rate.

The IAM role you specify must trust CloudFront and have permission to put records into the Kinesis Data Stream. A minimal trust policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

And the role's inline policy must permit Kinesis writes:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "kinesis:PutRecord",
      "Resource": "arn:aws:kinesis:us-east-1:123456789012:stream/cloudfront-logs"
    }
  ]
}
```

### Querying Standard Access Logs with Athena

Once your standard access logs are flowing into S3, you probably want to query them. Amazon Athena is the natural choice: it lets you run SQL against files in S3 without moving data around or managing infrastructure.

To query CloudFront logs in Athena, you first create an external table that maps to your S3 bucket. CloudFront publishes a standard CREATE TABLE statement on their documentation, but here's a representative example:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS cloudfront_logs (
  date STRING,
  time STRING,
  x_edge_location STRING,
  bytes BIGINT,
  ip STRING,
  method STRING,
  host STRING,
  uri STRING,
  status INT,
  referrer STRING,
  user_agent STRING,
  query_string STRING,
  cookie STRING,
  x_edge_result_type STRING,
  x_edge_request_id STRING,
  host_header STRING,
  protocol STRING,
  bytes_time_taken DOUBLE,
  x_forwarded_for STRING,
  ssl_protocol STRING,
  ssl_cipher STRING,
  x_edge_response_result_type STRING,
  http_version STRING,
  fle_status STRING,
  fle_encrypted_fields INT,
  c_port INT,
  time_taken DOUBLE,
  x_host_header STRING,
  cs_protocol_version STRING,
  piece_rule_id STRING,
  x_sampled INT,
  cache_behavior_path_pattern STRING,
  request_count INT,
  request_pct DOUBLE
)
PARTITIONED BY (year STRING, month STRING, day STRING)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY '\t'
LOCATION 's3://my-logs-bucket/logs/d123.cloudfront.net/'
```

Notice the tab-delimited format and the partition structure: CloudFront organizes logs by year, month, and day. Once your table is defined, you can partition it against your actual S3 structure:

```sql
ALTER TABLE cloudfront_logs ADD IF NOT EXISTS
  PARTITION (year='2024', month='01', day='15')
  LOCATION 's3://my-logs-bucket/logs/d123.cloudfront.net/2024/01/15/';
```

Now you can run queries. Want to find your top 10 most requested URIs?

```sql
SELECT uri, COUNT(*) as request_count
FROM cloudfront_logs
WHERE year='2024' AND month='01' AND day='15'
GROUP BY uri
ORDER BY request_count DESC
LIMIT 10;
```

Looking for non-200 responses that might indicate errors?

```sql
SELECT date, time, ip, method, uri, status, COUNT(*) as occurrences
FROM cloudfront_logs
WHERE year='2024' AND month='01' AND day='15'
  AND status NOT IN (200, 304)
GROUP BY date, time, ip, method, uri, status
ORDER BY occurrences DESC;
```

Interested in cache hit ratio?

```sql
SELECT
  x_edge_result_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM cloudfront_logs
WHERE year='2024' AND month='01' AND day='15'
GROUP BY x_edge_result_type;
```

Athena charges you per byte scanned, so use partition pruning (filtering by year, month, day) to keep costs down. You can also compress your logs with gzip or use Parquet format to reduce scan volume.

### Processing Real-Time Logs from Kinesis

Real-time logs flowing into Kinesis open up a different set of possibilities. You're not batching data into files for batch analysis; you're processing events as they arrive, enabling real-time alerting and monitoring.

One common pattern is to use a Lambda function triggered by Kinesis records. CloudFront writes batches of log records to Kinesis, and Lambda decodes them and takes action. Here's a sketch of what that might look like:

```python
import json
import base64
import boto3

cloudwatch = boto3.client('cloudwatch')
sns = boto3.client('sns')

def lambda_handler(event, context):
    for record in event['Records']:
        # Kinesis data is base64-encoded
        payload = base64.b64decode(record['kinesis']['data']).decode('utf-8')
        logs = [json.loads(line) for line in payload.strip().split('\n')]
        
        # Process each log record
        for log in logs:
            # Check for error statuses
            if log['httpStatus'] >= 500:
                # Publish an alert
                sns.publish(
                    TopicArn='arn:aws:sns:us-east-1:123456789012:cloudfront-errors',
                    Subject='CloudFront Server Error Detected',
                    Message=f"Status {log['httpStatus']} from {log['clientIp']}"
                )
            
            # Track metrics
            cloudwatch.put_metric_data(
                Namespace='CloudFront',
                MetricData=[
                    {
                        'MetricName': 'EdgeLocationRequests',
                        'Value': 1,
                        'Dimensions': [
                            {'Name': 'EdgeLocation', 'Value': log['edgeLocation']}
                        ]
                    }
                ]
            )
    
    return {'statusCode': 200}
```

Another pattern is to stream the records into an analytics platform like Amazon Kinesis Data Analytics, which lets you write SQL against the streaming data:

```sql
SELECT
  CAST(CURRENT_TIMESTAMP AS TIMESTAMP) as event_time,
  edgeLocation,
  COUNT(*) as request_count,
  SUM(CAST(bytesSent AS BIGINT)) as total_bytes
FROM SOURCE_SQL_STREAM_001
GROUP BY
  TUMBLE(CURRENT_TIMESTAMP, INTERVAL '1' MINUTE),
  edgeLocation;
```

This groups requests into one-minute windows and gives you real-time visibility into traffic patterns per edge location.

You could also use Kinesis Data Firehose to buffer the records and periodically write them to S3 or Redshift, blending real-time delivery with batch storage.

### Choosing Between Standard and Real-Time Logs

The decision of which logging mechanism to use—or whether to use both—depends on your operational needs and budget.

Use **standard access logs** when you need a complete, cost-free audit trail. If you're doing compliance reporting, month-end analytics, or post-incident analysis, standard logs have everything. The latency (minutes to hours) doesn't matter because you're not reacting immediately. Standard logs are also free: your only costs are S3 storage and retrieval. For most distributions, especially low-to-moderate traffic ones, standard logs alone may be sufficient.

Use **real-time logs** when you need to detect and respond to issues immediately. If you're monitoring for DDoS attacks, sudden spikes in error rates, or anomalous traffic patterns, the near-instantaneous delivery of real-time logs is invaluable. The sampling and field selection let you keep costs manageable while still capturing the metrics that matter. Real-time logs shine for high-traffic distributions where anomalies appear in seconds and you need to respond within minutes.

Many organizations use both. Standard logs provide the archive and source of truth; real-time logs provide the operational visibility. Your Lambda functions and dashboards watch real-time logs for immediate issues, while your Athena queries dig into standard logs for deeper analysis and trend identification.

Cost is a real consideration. Real-time logs incur Kinesis Data Streams charges based on shard hours and the volume of data ingested. For a distribution with millions of requests per hour, sampling at 10% and capturing only essential fields keeps costs reasonable. But if you're sampling at 100% and capturing every field, costs can add up quickly. Standard logs, by contrast, only cost you S3 storage and retrieval.

### Real-World Scenarios and Best Practices

Consider a high-traffic SaaS application serving millions of API requests daily. You'd likely enable both logging mechanisms. Real-time logs, sampled at 5% and capturing only timestamp, status code, edge location, and bytes sent, feed into a Lambda function that tracks 5xx errors and publishes alerts to SNS. If error rates spike, you're notified within seconds. Meanwhile, standard logs accumulate in S3, partitioned by date. Each morning, an Athena query runs to identify trends: Which URIs are slowest? What percentage of requests hit the cache? Which geographic regions see the most traffic? This data informs decisions about cache policies, origin optimization, and capacity planning.

For a content delivery network hosting mostly static assets, standard logs might suffice. Cache hit ratios are consistently high, traffic is predictable, and incident response is less time-critical. You'd enable standard logs, run daily Athena queries to track cache performance and popular content, and call it done. No Kinesis costs, no real-time monitoring overhead.

For an API platform that occasionally experiences bursts or unusual traffic, you might use real-time logs selectively. During normal operations, you rely on standard logs. But during a product launch or promotional event, you enable a real-time log configuration to watch for anomalies in real time. Once the event ends, you disable it and let standard logs handle the routine analysis.

When setting up logging, follow these practices: First, use meaningful S3 prefixes and partition structures for standard logs so queries don't scan unnecessary data. Second, for real-time logs, choose a sampling rate that balances visibility with cost; 5–10% is often a good starting point for high-traffic distributions. Third, define the minimum set of fields you actually need for real-time logs; every field you exclude reduces costs and processing overhead. Fourth, set up log retention policies in S3 to avoid indefinite storage costs; most compliance requirements don't mandate keeping logs forever. Fifth, use CloudWatch metrics or dashboards to monitor your logging infrastructure itself: Are Lambda processors keeping up with Kinesis records? Are your Athena queries completing successfully?

### Conclusion

CloudFront's two logging mechanisms solve different problems, and understanding their trade-offs is essential for building observable systems on AWS. Standard access logs are your cost-free, comprehensive audit trail—the complete record of every request. Real-time logs are your operational heartbeat, streaming data through Kinesis for immediate detection and response. Neither is objectively better; they're complementary tools suited to different needs. A mature logging strategy often uses both: standard logs for compliance, forensics, and batch analytics, and real-time logs for anomaly detection and operational alerting. By configuring logging thoughtfully and querying it strategically, you gain the visibility needed to optimize performance, troubleshoot issues, and maintain the reliability your users expect.
