---
title: "Querying VPC Flow Logs and CloudTrail with Athena: Practical Examples"
---

## Querying VPC Flow Logs and CloudTrail with Athena: Practical Examples

When something goes wrong in your AWS infrastructure—a security incident, unexplained traffic spikes, or mysterious latency—your first instinct is to dig into the logs. AWS generates logs constantly: VPC Flow Logs capture network traffic, CloudTrail records API calls, and ALB access logs track HTTP requests. The challenge isn't having data; it's making sense of it fast enough to respond.

Amazon Athena solves this elegantly. By turning your logs into queryable tables, Athena lets you hunt for problems using SQL—no infrastructure to manage, no data to copy around, no waiting hours for results. It's become an essential tool for security investigations, operational troubleshooting, and compliance audits.

This article walks you through the most practical use of Athena: analyzing AWS service logs to find suspicious activity, performance issues, and security anomalies. You'll learn how to set up tables for VPC Flow Logs, CloudTrail, and ALB access logs, write queries that actually tell you what's happening, and automate recurring analyses so you're not manually hunting every time something feels off.

### Why Athena for Log Analysis?

Before diving into the mechanics, it's worth understanding why Athena has become the go-to for log analysis in AWS.

Traditional approaches to log hunting create friction. You could stream logs into a data warehouse like Redshift, but you're paying for provisioned capacity whether you query it once a month or once a minute. You could write custom Lambda functions to parse logs, but that's code you have to maintain and test. You could download logs locally and grep through them, but that only works at small scale.

Athena works differently. It's a query engine built on top of Presto that runs against data sitting in S3—no servers to provision, no storage to manage separately from your logs. You pay per terabyte of data scanned, which aligns perfectly with occasional, ad-hoc investigations. Set it up once, and you can run queries whenever you need them.

For developers, the killer feature is simplicity. If you know SQL, you can start investigating your infrastructure within minutes. No API documentation to learn, no custom query language, just standard SELECT statements.

### Setting Up Athena: The Basics

Before you can query anything, you need an S3 bucket for query results and an AWS Glue database to hold your table definitions.

Create an S3 bucket to store Athena query results. This doesn't need to be the same bucket where your logs live; in fact, it's cleaner to keep them separate. Just create a simple bucket with a name like `athena-query-results-account-id`.

Next, create a Glue database. You can do this through the AWS Console under the Glue service, or via the AWS CLI:

```bash
aws glue create-database \
  --database-input "Name=log_analysis,Description=Database for analyzing logs"
```

Now you're ready to create tables. When you open the Athena console and connect to your new database, you'll write CREATE TABLE statements that map to your log files in S3.

### Creating a Table for VPC Flow Logs

VPC Flow Logs capture metadata about traffic flowing through your VPC. By default, they land in an S3 bucket you specify, organized by region, account ID, and interface ID. A typical path looks like `s3://my-vpc-logs/AWSLogs/123456789012/vpcflowlogs/us-east-1/2024/01/15/`.

Each log file is a gzip-compressed text file containing tab-separated fields. Here's what a raw VPC Flow Log entry looks like:

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes windowstart windowend action log-status
2 123456789012 eni-12345678 10.0.1.100 203.0.113.12 49153 443 6 10 5234 1642281600 1642281660 ACCEPT OK
```

To query this, you create a table that describes the schema:

```sql
CREATE EXTERNAL TABLE vpc_flow_logs (
  version INT,
  account_id STRING,
  interface_id STRING,
  srcaddr STRING,
  dstaddr STRING,
  srcport INT,
  dstport INT,
  protocol INT,
  packets BIGINT,
  bytes BIGINT,
  windowstart BIGINT,
  windowend BIGINT,
  action STRING,
  log_status STRING
)
PARTITIONED BY (
  region STRING,
  year STRING,
  month STRING,
  day STRING
)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY ' '
LOCATION 's3://my-vpc-logs/AWSLogs/123456789012/vpcflowlogs/'
TBLPROPERTIES ('skip.header.line.count'='1');
```

Notice the PARTITIONED BY clause. VPC Flow Logs automatically organize files by date and region in S3. By declaring these as partition columns, you tell Athena how to structure the metadata. This is crucial for performance: without partitioning, Athena would scan every single log file to answer your query. With partitions, it only scans the date ranges and regions you care about.

After creating the table, you need to tell Athena where the partitions are. You can do this manually with ALTER TABLE statements, but there's a smarter approach: partition projection.

### Partition Projection: The Game Changer

Partition projection is a feature that lets Athena automatically discover partitions without you having to tell it about each one. Instead of manually registering partitions with ALTER TABLE, you configure rules that tell Athena how partitions are structured, and it figures out the rest.

For VPC Flow Logs, here's how you'd enable partition projection:

```sql
CREATE EXTERNAL TABLE vpc_flow_logs_auto (
  version INT,
  account_id STRING,
  interface_id STRING,
  srcaddr STRING,
  dstaddr STRING,
  srcport INT,
  dstport INT,
  protocol INT,
  packets BIGINT,
  bytes BIGINT,
  windowstart BIGINT,
  windowend BIGINT,
  action STRING,
  log_status STRING
)
PARTITIONED BY (
  region STRING,
  year STRING,
  month STRING,
  day STRING
)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY ' '
LOCATION 's3://my-vpc-logs/AWSLogs/123456789012/vpcflowlogs/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.region.type'='enum',
  'projection.region.values'='us-east-1,us-east-2,us-west-1,us-west-2,eu-west-1',
  'projection.year.type'='integer',
  'projection.year.range'='2023,2025',
  'projection.month.type'='integer',
  'projection.month.range'='1,12',
  'projection.month.digits'='2',
  'projection.day.type'='integer',
  'projection.day.range'='1,31',
  'projection.day.digits'='2',
  'storage.location.template'='s3://my-vpc-logs/AWSLogs/123456789012/vpcflowlogs/${region}/${year}/${month}/${day}',
  'skip.header.line.count'='1'
);
```

This tells Athena that regions are an enumerated list, years and months and days are integers with specific ranges, and it can construct S3 paths dynamically. The result: Athena discovers partitions on the fly without querying Glue's metadata service. Your queries run faster, and you don't have to maintain partition tables.

### Creating a Table for CloudTrail Events

CloudTrail is AWS's audit log. Every API call made in your account—whether through the console, SDK, or CLI—gets recorded. CloudTrail writes JSON events to S3 in a structure like `s3://my-cloudtrail-logs/AWSLogs/123456789012/CloudTrail/us-east-1/2024/01/15/`.

Each file contains an array of JSON events. Unlike VPC Flow Logs, CloudTrail uses a more complex nested structure:

```json
{
  "Records": [
    {
      "eventVersion": "1.08",
      "userIdentity": {
        "type": "IAMUser",
        "principalId": "AIDAJ45Q7YFFAREXAMPLE",
        "arn": "arn:aws:iam::123456789012:user/alice",
        "accountId": "123456789012",
        "userName": "alice"
      },
      "eventTime": "2024-01-15T14:32:18Z",
      "eventSource": "ec2.amazonaws.com",
      "eventName": "DescribeInstances",
      "awsRegion": "us-east-1",
      "sourceIPAddress": "203.0.113.15",
      "userAgent": "aws-cli/2.13.0",
      "requestParameters": {...},
      "responseElements": null,
      "requestId": "12345678-1234-1234-1234-123456789012",
      "eventID": "87654321-4321-4321-4321-210987654321",
      "eventType": "AwsApiCall",
      "recipientAccountId": "123456789012",
      "errorCode": null,
      "errorMessage": null
    }
  ]
}
```

Creating a table for CloudTrail is more involved because of the nested structure:

```sql
CREATE EXTERNAL TABLE cloudtrail_logs (
  eventversion STRING,
  useridentity STRUCT<
    type: STRING,
    principalid: STRING,
    arn: STRING,
    accountid: STRING,
    invokedby: STRING,
    accesskeyid: STRING,
    userName: STRING,
    sessioncontext: STRUCT<
      attributes: STRUCT<
        mfaauthenticated: STRING,
        creationdate: STRING>,
      sessionissuer: STRUCT<
        type: STRING,
        principalId: STRING,
        arn: STRING,
        accountId: STRING,
        userName: STRING>>>,
  eventtime STRING,
  eventsource STRING,
  eventname STRING,
  awsregion STRING,
  sourceipaddress STRING,
  useragent STRING,
  errorcode STRING,
  errormessage STRING,
  requestparameters STRING,
  responseelements STRING,
  additionaleventdata STRING,
  requestid STRING,
  eventid STRING,
  resources ARRAY<STRUCT<
    ARN: STRING,
    accountId: STRING,
    type: STRING>>,
  eventtype STRING,
  recipientaccountid STRING,
  sharedEventID STRING,
  vpcendpointid STRING
)
PARTITIONED BY (
  region STRING,
  year STRING,
  month STRING,
  day STRING
)
ROW FORMAT SERDE 'com.amazon.emr.hive.serde.CloudTrailSerde'
STORED AS INPUTFORMAT 'com.amazon.emr.cloudtrail.CloudTrailInputFormat'
OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
LOCATION 's3://my-cloudtrail-logs/AWSLogs/123456789012/CloudTrail/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.region.type'='enum',
  'projection.region.values'='us-east-1,us-east-2,us-west-1,us-west-2',
  'projection.year.type'='integer',
  'projection.year.range'='2023,2025',
  'projection.month.type'='integer',
  'projection.month.range'='1,12',
  'projection.month.digits'='2',
  'projection.day.type'='integer',
  'projection.day.range'='1,31',
  'projection.day.digits'='2',
  'storage.location.template'='s3://my-cloudtrail-logs/AWSLogs/123456789012/CloudTrail/${region}/${year}/${month}/${day}'
);
```

The key difference here is the SERDE (serializer/deserializer). CloudTrail provides a custom Serde that knows how to parse its JSON format, including handling the outer Records array. Without this, Athena would struggle to parse the nested structure correctly.

### Creating a Table for ALB Access Logs

Application Load Balancer access logs are simpler than CloudTrail but more verbose than VPC Flow Logs. Each request that hits your ALB gets logged, with details about the client, target, and response. The logs land in S3 with a path like `s3://my-alb-logs/AWSLogs/123456789012/elasticloadbalancing/us-east-1/2024/01/15/`.

A single ALB access log line looks like this:

```
http 2024-01-15T14:32:18.123456Z app/my-alb/1234567890abcdef 203.0.113.15:50000 10.0.1.100:80 0.123 0.456 0.001 200 200 34 512 "GET http://example.com:80/ HTTP/1.1" "Mozilla/5.0" ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/1234567890abcdef "Root=1-67890abc-def1234567890abcdef123" "-" "-" 0 2024-01-15T14:32:18.123456Z "forward" "-" "-" "203.0.113.15" "TLSv1.2" "-" "-"
```

The table definition maps these space-separated fields:

```sql
CREATE EXTERNAL TABLE alb_access_logs (
  type STRING,
  time STRING,
  elb STRING,
  client_ip STRING,
  client_port INT,
  target_ip STRING,
  target_port INT,
  request_processing_time DOUBLE,
  target_processing_time DOUBLE,
  response_processing_time DOUBLE,
  elb_status_code INT,
  target_status_code INT,
  received_bytes BIGINT,
  sent_bytes BIGINT,
  request_verb STRING,
  request_url STRING,
  request_proto STRING,
  user_agent STRING,
  ssl_cipher STRING,
  ssl_protocol STRING,
  target_group_arn STRING,
  trace_id STRING,
  domain_name STRING,
  chosen_cert_arn STRING,
  matched_rule_priority STRING,
  request_creation_time STRING,
  actions_executed STRING,
  redirect_url STRING,
  lambda_error_code STRING,
  new_field STRING
)
PARTITIONED BY (
  region STRING,
  year STRING,
  month STRING,
  day STRING,
  hour STRING
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.RegexSerDe'
WITH SERDEPROPERTIES (
  'serialization.format'='1',
  'input.regex'='([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*):([0-9]*) ([^ ]*)[:-]([0-9]*) ([-.0-9]*) ([-.0-9]*) ([-.0-9]*) (|[-0-9]*) (-|[-0-9]*) ([-0-9]*) ([-0-9]*) \"([^ ]*) ([^ ]*) (- |[^ ]*)\" \"([^\"]*)\" ([A-Z0-9-]+) ([A-Za-z0-9.-]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" \"([^\"]*)\" ([-.0-9]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" \"([^ ]*)\" \"([^\s]+?)\" \"([^\s]*)\" \"([^ ]*)\"'
)
LOCATION 's3://my-alb-logs/AWSLogs/123456789012/elasticloadbalancing/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.region.type'='enum',
  'projection.region.values'='us-east-1,us-east-2,us-west-1,us-west-2',
  'projection.year.type'='integer',
  'projection.year.range'='2023,2025',
  'projection.month.type'='integer',
  'projection.month.range'='1,12',
  'projection.month.digits'='2',
  'projection.day.type'='integer',
  'projection.day.range'='1,31',
  'projection.day.digits'='2',
  'projection.hour.type'='integer',
  'projection.hour.range'='0,23',
  'projection.hour.digits'='2',
  'storage.location.template'='s3://my-alb-logs/AWSLogs/123456789012/elasticloadbalancing/${region}/${year}/${month}/${day}/${hour}'
);
```

The RegexSerDe parses the space-separated format using a regex pattern. Notice that ALB logs are even more granular than VPC Flow Logs—they include an hour partition, which is useful because ALB logs can be voluminous for high-traffic applications.

### Hunting for Suspicious Activity: CloudTrail Queries

Now that your tables are set up, let's write queries that actually tell you what's happening. Start with CloudTrail because it's the foundation of security investigations.

To find failed API calls, which often indicate reconnaissance or brute-force attempts:

```sql
SELECT
  eventtime,
  eventname,
  useridentity.arn,
  sourceipaddress,
  errorcode,
  errormessage,
  requestparameters
FROM cloudtrail_logs
WHERE year = '2024'
  AND month = '01'
  AND day = '15'
  AND errorcode IS NOT NULL
  AND errorcode != 'Success'
ORDER BY eventtime DESC;
```

This query shows every failed API call on a specific day, sorted by time. The errorcode field tells you what went wrong—often AuthFailure or UnauthorizedOperation. If you see a pattern of failures from a specific IP address or user, that's worth investigating.

To find who created or modified security groups, which is a high-risk operation:

```sql
SELECT
  eventtime,
  eventname,
  useridentity.arn,
  sourceipaddress,
  requestparameters,
  resources[0].arn as resource_arn
FROM cloudtrail_logs
WHERE year = '2024'
  AND month = '01'
  AND day >= '14'
  AND eventname IN ('AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress',
                    'RevokeSecurityGroupIngress', 'RevokeSecurityGroupEgress')
ORDER BY eventtime DESC;
```

Security group changes are high-signal—they directly impact network access. This query tells you exactly who changed what and when.

To detect potentially compromised credentials, look for API calls from unusual locations:

```sql
SELECT
  eventtime,
  eventname,
  useridentity.arn,
  sourceipaddress,
  COUNT(*) as request_count
FROM cloudtrail_logs
WHERE year = '2024'
  AND month = '01'
  AND useridentity.type = 'IAMUser'
GROUP BY eventtime, eventname, useridentity.arn, sourceipaddress
HAVING COUNT(*) > 100
ORDER BY request_count DESC;
```

This finds users making a large number of API calls in a short window—potentially a compromised access key being used for reconnaissance or data exfiltration.

### Network Analysis: VPC Flow Logs Queries

VPC Flow Logs give you visibility into network traffic. While they don't show the payload (that's not captured), they show who's talking to whom, how much data is flowing, and whether connections are being accepted or rejected.

To find the top talkers—the source IPs sending the most traffic:

```sql
SELECT
  srcaddr,
  dstaddr,
  dstport,
  SUM(bytes) as total_bytes,
  SUM(packets) as total_packets,
  COUNT(*) as flow_count
FROM vpc_flow_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
GROUP BY srcaddr, dstaddr, dstport
ORDER BY total_bytes DESC
LIMIT 20;
```

This shows which source and destination pairs are moving the most data. If you see internal IPs sending massive amounts to external IPs, that could indicate data exfiltration. If you see external IPs hammering your servers on unusual ports, that's a sign of scanning or exploitation attempts.

To detect potential DDoS activity—many flows from different sources to the same destination:

```sql
SELECT
  dstaddr,
  dstport,
  COUNT(DISTINCT srcaddr) as unique_sources,
  SUM(packets) as total_packets,
  SUM(bytes) as total_bytes
FROM vpc_flow_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
GROUP BY dstaddr, dstport
HAVING COUNT(DISTINCT srcaddr) > 1000
ORDER BY unique_sources DESC;
```

A single destination receiving traffic from thousands of unique sources is the fingerprint of a distributed attack. This query finds those patterns.

To identify rejected connections, which might indicate network policy violations or exploit attempts:

```sql
SELECT
  srcaddr,
  dstaddr,
  dstport,
  action,
  COUNT(*) as flow_count,
  SUM(packets) as total_packets
FROM vpc_flow_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND action = 'REJECT'
GROUP BY srcaddr, dstaddr, dstport, action
ORDER BY flow_count DESC;
```

By default, most rejected flows don't indicate a problem—they're just packets that hit security groups or NACLs. But patterns of rejections from the same source to the same destination often mean someone's probing your network.

### Performance and Error Analysis: ALB Logs Queries

ALB access logs show you what your application is experiencing from the load balancer's perspective. You can use them to detect performance degradation, error spikes, and unusual traffic patterns.

To find the response times trending over time:

```sql
SELECT
  DATE_TRUNC('minute', FROM_ISO8601_TIMESTAMP(time)) as minute,
  target_group_arn,
  ROUND(AVG(target_processing_time), 3) as avg_target_time,
  ROUND(MAX(target_processing_time), 3) as max_target_time,
  COUNT(*) as request_count
FROM alb_access_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
GROUP BY DATE_TRUNC('minute', FROM_ISO8601_TIMESTAMP(time)), target_group_arn
ORDER BY minute DESC;
```

This groups requests by minute and shows you how long your targets are taking to respond. If you see a spike in response time, you know something's wrong—either the application is slow or the infrastructure is overloaded.

To find 4xx and 5xx error spikes:

```sql
SELECT
  DATE_TRUNC('minute', FROM_ISO8601_TIMESTAMP(time)) as minute,
  target_group_arn,
  target_status_code,
  COUNT(*) as error_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY DATE_TRUNC('minute', FROM_ISO8601_TIMESTAMP(time)), target_group_arn), 2) as error_percentage
FROM alb_access_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
  AND target_status_code >= 400
GROUP BY DATE_TRUNC('minute', FROM_ISO8601_TIMESTAMP(time)), target_group_arn, target_status_code
ORDER BY minute DESC;
```

This shows you which status codes are appearing and what percentage of traffic they represent. A sudden spike in 503 Service Unavailable responses might mean your backend is crashing. A spike in 401 Unauthorized might mean an authentication service is down.

To identify slow requests:

```sql
SELECT
  time,
  client_ip,
  request_url,
  target_processing_time,
  target_status_code
FROM alb_access_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
  AND target_processing_time > 5.0
ORDER BY target_processing_time DESC
LIMIT 100;
```

Requests taking more than 5 seconds are outliers. This query finds them so you can correlate with application logs to understand what happened.

To detect potential credential stuffing or brute-force attacks against your application:

```sql
SELECT
  client_ip,
  request_url,
  COUNT(*) as request_count,
  SUM(CASE WHEN elb_status_code = 401 THEN 1 ELSE 0 END) as unauthorized_count
FROM alb_access_logs
WHERE region = 'us-east-1'
  AND year = '2024'
  AND month = '01'
  AND day = '15'
  AND request_url LIKE '%login%'
GROUP BY client_ip, request_url
HAVING COUNT(*) > 50
ORDER BY request_count DESC;
```

If a single IP is making dozens of requests to your login endpoint and getting 401 responses, that's a classic credential stuffing pattern.

### Automating Analysis with Scheduled Queries

Running ad-hoc queries when something goes wrong is useful, but automating recurring analyses is even better. You can use Amazon EventBridge to trigger Lambda functions that run Athena queries on a schedule, then send the results somewhere you'll see them.

Here's a simple Lambda function that runs an Athena query:

```python
import boto3
import time

athena_client = boto3.client('athena')

def lambda_handler(event, context):
    query = """
    SELECT
      eventtime,
      eventname,
      useridentity.arn,
      sourceipaddress,
      errorcode
    FROM cloudtrail_logs
    WHERE year = '2024'
      AND month = '01'
      AND day = '15'
      AND errorcode IS NOT NULL
      AND errorcode != 'Success'
    ORDER BY eventtime DESC
    """
    
    response = athena_client.start_query_execution(
        QueryString=query,
        QueryExecutionContext={'Database': 'log_analysis'},
        ResultConfiguration={'OutputLocation': 's3://athena-query-results-123456789012/'}
    )
    
    query_execution_id = response['QueryExecutionId']
    
    # Wait for the query to complete
    while True:
        query_status = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        status = query_status['QueryExecution']['Status']['State']
        
        if status in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
            break
        
        time.sleep(2)
    
    if status == 'SUCCEEDED':
        results = athena_client.get_query_results(QueryExecutionId=query_execution_id)
        return {
            'statusCode': 200,
            'body': results['ResultSet']['Rows']
        }
    else:
        return {
            'statusCode': 500,
            'body': f'Query failed with status {status}'
        }
```

You'd wrap this in error handling and add code to send results to SNS, send them to a Slack webhook, or store them in a DynamoDB table for further processing. The key is that you're automating the investigation.

To run this daily, create an EventBridge rule:

```bash
aws events put-rule \
  --name daily-cloudtrail-security-check \
  --schedule-expression 'cron(0 6 * * ? *)'
```

This triggers at 6 AM UTC every day. Point it to your Lambda function, and every morning you'll have a fresh report of failed API calls without lifting a finger.

### Performance Tuning and Cost Optimization

Athena charges by the amount of data scanned. A single query scanning terabytes of unfiltered log data can be expensive. Here are ways to keep costs down while keeping queries fast.

Always partition your queries. The examples above all filter by year, month, and day. That's partition pruning—it tells Athena to only scan the files relevant to your date range. Without it, Athena scans every single log file.

Use partition projection to avoid metadata overhead. Without partition projection, Athena queries the Glue Catalog to find partitions. With partition projection, it calculates partition paths directly. For high-velocity logs like ALB access logs, this can cut query execution time in half.

Be selective with your WHERE clauses. Instead of `WHERE year = '2024'`, use `WHERE year = '2024' AND month = '01' AND day = '15'`. The more specific you are, the fewer files Athena scans.

Use columnar formats when possible. VPC Flow Logs and ALB logs are text-based, but if you're archiving historical data, consider converting to Parquet or ORC. Columnar formats compress better and Athena can skip entire columns without reading them.

For CloudTrail, consider splitting the table by event source or event name. CloudTrail logs a huge variety of events, and if you mostly care about security-related events, create a separate table filtered to just those events. Smaller tables mean faster queries.

### Combining Data Across Sources

The real power of Athena comes when you join data across sources. For example, you might find a suspicious CloudTrail API call, then use VPC Flow Logs to see what network traffic that user generated, and check ALB logs to see if the traffic reached your application.

Here's a query that finds CloudTrail API calls and matches them to subsequent network flows:

```sql
SELECT
  ct.eventtime as api_call_time,
  ct.eventname,
  ct.useridentity.arn,
  ct.sourceipaddress,
  fl.srcaddr,
  fl.dstaddr,
  fl.dstport,
  fl.bytes
FROM cloudtrail_logs ct
LEFT JOIN vpc_flow_logs fl ON
  ct.sourceipaddress = fl.srcaddr
  AND CAST(ct.eventtime AS BIGINT) BETWEEN fl.windowstart AND fl.windowend
WHERE ct.year = '2024'
  AND ct.month = '01'
  AND ct.day = '15'
  AND ct.eventname = 'DescribeSecurityGroups'
LIMIT 100;
```

This finds all DescribeSecurityGroups API calls, then matches them to network flows from the same source IP within the same time window. It tells you what network traffic was happening around the time someone was querying your security groups—potentially a sign of reconnaissance.

### Conclusion

Athena transforms AWS logs from static files sitting in S3 into an interactive database you can query in seconds. By setting up tables for VPC Flow Logs, CloudTrail, and ALB access logs with partition projection, you eliminate the overhead of managing partitions and can focus on investigation.

The queries in this article cover the most common operational use cases: finding failed API calls, detecting suspicious network patterns, identifying performance problems, and spotting potential security incidents. They're not one-size-fits-all—you'll adapt them to your specific infrastructure and security requirements—but they demonstrate the types of questions you can answer with Athena.

The real win is automation. Once you've written queries that catch the problems you care about, wrap them in Lambda functions and run them on a schedule. Every morning you can have a report of unusual activity, without waiting for alerts or manually hunting through logs. That's how Athena shifts from a tactical tool for incident response to a strategic part of your security and operations infrastructure.

Start small: pick one type of log, create a table, write a few exploratory queries, and get comfortable with the data. Then layer in additional sources and more sophisticated analyses. Before long, Athena becomes indispensable for understanding what's happening in your AWS environment.
