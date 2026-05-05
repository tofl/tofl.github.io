---
title: "Monitoring API Gateway with CloudWatch and Access Logging"
---

## Monitoring API Gateway with CloudWatch and Access Logging

Building an API is one thing; keeping it running smoothly in production is another entirely. Once your API Gateway endpoints are live and handling traffic, you need visibility into what's happening on the other side of the curtain. Is your API responding quickly? Are errors creeping up? Which endpoints are causing the most friction? These questions matter, and they're best answered with proper observability.

In this article, we'll explore how to gain comprehensive visibility into your API Gateway workloads using CloudWatch metrics, access logging, and related tools. You'll learn not just how to turn on monitoring, but how to interpret what you're seeing and use that information to diagnose and resolve issues before they become production incidents.

### Understanding API Gateway's Native CloudWatch Metrics

API Gateway automatically publishes metrics to CloudWatch, giving you a real-time window into your API's health and performance. These metrics are available at no extra cost and require no configuration—they just appear in your CloudWatch dashboard the moment your API starts receiving traffic.

The most important metrics fall into a few categories. The **Count** metric tracks the total number of requests hitting your API during a given period. This is your baseline traffic volume, and it's useful for understanding load patterns. A sharp spike in Count might indicate a sudden surge in demand, or it could signal that something went wrong and clients are retrying requests obsessively.

The **4XXError** metric counts client-side errors—requests that are malformed, unauthorized, or missing required data. These errors typically originate from problems on the client side: a bad request format, expired credentials, or a request to an endpoint that doesn't exist. While some 4XX errors are inevitable and even healthy (they're part of normal API operation), a sudden increase could indicate that clients have deployed a buggy version or that your authentication setup has changed in a way that's rejecting valid requests.

The **5XXError** metric, by contrast, tracks server-side errors. These are your concern. A 5XX error means your API or its backend couldn't process a request successfully. This could stem from a Lambda function that's timing out, a database that's unreachable, insufficient permissions, or an unhandled exception. Unlike 4XX errors, 5XX errors generally warrant immediate investigation.

The **Latency** metric measures the total time API Gateway takes to respond to a request, from when it receives the request to when the response is sent back to the client. This includes all integration time and any Lambda execution overhead. If latency is creeping up, clients notice, and your user experience suffers. High latency can stem from slow backends, high concurrency, or Lambda cold starts.

The **IntegrationLatency** metric isolates just the time spent talking to your backend—whether that's a Lambda function, HTTP endpoint, or other integration. The difference between Latency and IntegrationLatency tells you how much time API Gateway itself is spending on request processing. Usually this difference is small, but it can reveal when API Gateway is the bottleneck rather than your backend.

These metrics are available at both the API level and the stage level. You can also drill down by method and resource, which is invaluable when you're trying to identify which specific endpoint is problematic. By default, CloudWatch retains these metrics for 15 months, giving you good historical visibility for trend analysis.

### Enabling and Configuring Access Logs

While CloudWatch metrics give you aggregated numbers, they don't tell you the story of individual requests. If you want to understand what specific requests looked like—what headers were sent, what response codes were returned, how long each request took—you need access logs.

Access logging in API Gateway is not enabled by default. You must explicitly configure it, specifying where the logs should go and which fields you want to capture. API Gateway supports two destinations: CloudWatch Logs and Amazon S3. Each has different strengths.

CloudWatch Logs is ideal if you want real-time access to log data and plan to query it with CloudWatch Insights. It integrates seamlessly with your other CloudWatch metrics and alarms. However, CloudWatch Logs becomes expensive at scale—high-traffic APIs can generate enormous log volumes, and storage and ingestion costs add up. CloudWatch Logs also has retention limits; you typically can't economically keep years of detailed logs in CloudWatch.

S3 is better for long-term, cost-effective storage of access logs. You can store massive volumes of logs for pennies per gigabyte per month. The tradeoff is that querying S3 logs isn't as instantaneous as querying CloudWatch Logs—you'll typically use Athena to query them, which requires more setup but is powerful once configured.

To enable access logging to CloudWatch, you configure it at the stage level. You'll define an IAM role that grants API Gateway permission to write to CloudWatch Logs, create a log group, and then associate that log group with your stage. Here's how you might set this up with the AWS CLI:

```bash
aws logs create-log-group --log-group-name /aws/apigateway/my-api

aws apigateway update-stage \
  --rest-api-id abc123 \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/accessLogSetting/destinationArn,value=arn:aws:logs:us-east-1:123456789012:log-group:/aws/apigateway/my-api \
    op=replace,path=/accessLogSetting/format,value='$context.requestId $context.extendedRequestId $context.identity.sourceIp $context.requestTime $context.routeKey $context.status'
```

When you configure access logging to S3, the process is similar, but you're specifying an S3 bucket instead of a log group:

```bash
aws apigateway update-stage \
  --rest-api-id abc123 \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/accessLogSetting/destinationArn,value=arn:aws:s3:::my-api-logs \
    op=replace,path=/accessLogSetting/format,value='$context.requestId $context.extendedRequestId $context.identity.sourceIp $context.requestTime $context.routeKey $context.status'
```

The format string is where things get interesting. This string defines which fields will appear in your logs.

### Leveraging the $context Variable for Rich Request Details

The `$context` variable is your key to understanding individual requests. It's a special variable available in access log formats, request/response mapping templates, and authorizers. It contains a rich set of information about the current request and response, organized into nested objects.

`$context.requestId` is a unique identifier for each request, perfect for correlating logs across different systems. If a client reports an issue, you can ask for their request ID and instantly pull up the exact log entry.

`$context.identity` contains information about the caller: their IP address (`sourceIp`), user agent, and if you're using API authentication, their principal ID and account ID. This helps you understand who's hitting your API and where they're coming from.

`$context.requestTime` records when the request was received, while `$context.extendedRequestId` is an extended identifier that API Gateway generates for debugging. `$context.status` shows the HTTP response code your backend returned.

`$context.integration.latency` and `$context.latency` give you precise timing information. The former is how long your backend took to respond; the latter is the total time from when API Gateway received the request to when it sent the response.

Here's a more comprehensive log format that captures the most useful information:

```
$context.requestId $context.extendedRequestId $context.identity.sourceIp $context.requestTime $context.routeKey $context.status $context.integration.latency $context.latency $context.error.message $context.error.messageString $context.authorizer.principalId $context.identity.userAgent
```

With this format, your logs will include the request ID, caller's IP, timestamp, endpoint, response code, how long the backend took, total time, any error message, who made the request (if authenticated), and their user agent. This gives you enough detail to trace almost any production issue.

The `$context` variable has dozens of nested fields. Some of the most operationally useful ones include:

`$context.requestTimeEpoch` is the Unix timestamp of the request, useful if you're parsing logs programmatically. `$context.integration.error` tells you if there was an error from your backend integration. `$context.authorizer.*` exposes any values returned by a Lambda authorizer, which is invaluable if you're using custom authorization logic. `$context.accountId` shows which AWS account the API gateway belongs to, helpful in multi-account setups.

You can also access the HTTP method and path explicitly: `$context.httpMethod` and `$context.resourcePath`. Headers from the original request are available via `$context.requestOverride.header.*`, and query parameters via `$context.querystring.*`.

### Setting Up CloudWatch Alarms for Proactive Alerting

Metrics and logs are only useful if someone's paying attention to them. CloudWatch alarms let you define thresholds and automatically alert you—via SNS, email, or other mechanisms—when things go wrong. Rather than staring at dashboards, alarms wake you up when action is needed.

For an API Gateway, the most critical alarms revolve around errors and latency. You might set up an alarm that triggers if the 5XXError count exceeds 10 in a 5-minute period, indicating that your backend is struggling. Here's how you'd create that with the AWS CLI:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name api-5xx-errors-high \
  --alarm-description "Alert if 5XX errors exceed 10 in 5 minutes" \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 10 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:api-alerts
```

You'd typically create a similar alarm for 4XX errors, though the threshold might be higher and the severity lower. A spike in 4XX errors often indicates a problem with client-side logic rather than your infrastructure, but it's still worth monitoring because it can signal a breaking change or a client bug.

Latency alarms are equally important. If your API's latency is consistently above 1000ms, users have a poor experience. You might set an alarm that triggers if the average latency exceeds 1 second:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name api-latency-high \
  --alarm-description "Alert if average latency exceeds 1 second" \
  --metric-name Latency \
  --namespace AWS/ApiGateway \
  --statistic Average \
  --period 60 \
  --evaluation-periods 2 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:api-alerts
```

Note the `evaluation-periods` of 2—this means the alarm only triggers if latency is high for two consecutive periods (2 minutes in this case). This prevents false alarms from transient blips and gives you more confidence that there's a real issue.

You might also set up an alarm on IntegrationLatency to distinguish problems within your backend from problems with API Gateway itself. And for high-volume APIs, consider an alarm that monitors the absolute count of errors rather than just the rate—if you're getting 100 requests per second and a few are failing, that might be normal, but if 10 are failing, that's significant.

### Querying Access Logs with CloudWatch Insights

Once access logs are flowing into CloudWatch Logs, CloudWatch Insights gives you a powerful query language to analyze them. CloudWatch Insights uses a simple, intuitive syntax inspired by common log analysis tools, and it's fast even on large log volumes.

Suppose you want to understand which endpoints are generating the most errors. You'd query:

```
fields @timestamp, routeKey, status, @message
| filter status >= 400
| stats count() as error_count by routeKey
| sort error_count desc
```

This query pulls all entries where the status code is 400 or higher, counts them by endpoint (routeKey), and sorts them in descending order. In seconds, you see which endpoints are problematic.

To find the slowest requests, you'd look at latency:

```
fields @timestamp, requestId, routeKey, latency, status
| filter ispresent(latency)
| stats max(latency) as max_latency, avg(latency) as avg_latency, pct(latency, 95) as p95_latency by routeKey
| sort max_latency desc
```

This shows you the maximum, average, and 95th percentile latency for each endpoint, helping you identify which endpoints have performance issues and which are consistently fast.

To see traffic patterns by user agent (useful for understanding client diversity):

```
fields userAgent, @timestamp
| stats count() as requests by userAgent
| sort requests desc
```

You can also correlate errors with specific clients:

```
fields @timestamp, requestId, sourceIp, status, @message
| filter status >= 500
| stats count() as errors by sourceIp
| sort errors desc
```

This shows you which IPs are experiencing the most 5XX errors, which can help you identify if the problem is localized to a specific client or region.

CloudWatch Insights also supports pattern matching for parsing unstructured log data. If your log format includes error messages, you can search for specific error patterns:

```
fields @timestamp, requestId, routeKey, status, @message
| filter @message like /timeout|connection refused/
| stats count() as timeout_errors by routeKey
```

Queries like this are invaluable during incident response—you can quickly correlate errors with specific issues and understand their scope.

### Using Athena for Long-Term Log Analytics

While CloudWatch Insights is great for real-time querying, it's not economical for analyzing months or years of logs. If you've been storing access logs in S3, Athena lets you query them directly using SQL, without needing to load them into a database.

Setting up Athena for API Gateway logs requires a few steps. First, you need to create a table that describes the structure of your logs. You define the column names, data types, and how the log data is formatted. API Gateway logs are typically stored as space-separated values, so you'd create a table like this:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS api_gateway_logs (
  request_id STRING,
  extended_request_id STRING,
  source_ip STRING,
  request_time STRING,
  route_key STRING,
  status INT,
  integration_latency INT,
  latency INT,
  error_message STRING,
  principal_id STRING,
  user_agent STRING
)
PARTITIONED BY (date_partition STRING)
ROW FORMAT DELIMITED
FIELDS TERMINATED BY ' '
LOCATION 's3://my-api-logs/';
```

Once the table is created, you can run SQL queries directly against your S3 logs. To find the endpoints with the highest error rates over the past month:

```sql
SELECT route_key, 
       COUNT(*) as total_requests,
       SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as server_errors,
       ROUND(100.0 * SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate_percent
FROM api_gateway_logs
WHERE date_partition >= '2024-01-01'
GROUP BY route_key
ORDER BY error_rate_percent DESC;
```

To identify slow requests:

```sql
SELECT request_id, route_key, integration_latency, latency, status, source_ip
FROM api_gateway_logs
WHERE date_partition >= '2024-01-01'
  AND latency > 5000
ORDER BY latency DESC
LIMIT 100;
```

Athena charges by the amount of data scanned, so partitioning your S3 logs by date (as shown in the table definition) is important—it lets you scan only the date range you care about rather than all your logs.

### Interpreting Metrics to Diagnose Common Issues

Understanding the raw numbers is one thing; knowing what they mean is another. Let's walk through some common scenarios you might encounter and how to diagnose them.

**Scenario 1: Sudden spike in 5XX errors**

You're paged because your 5XX error alarm triggered. Your first instinct should be to check whether your backend has an issue. Look at IntegrationLatency—if it's normal but latency overall is high, API Gateway itself might be bottlenecked. Check CloudWatch Logs for errors. If you're using Lambda as your integration, check the Lambda CloudWatch Logs for exceptions. If it's an HTTP integration, check the health of the downstream service. A common culprit: a dependency (database, external service) became unavailable, causing your backend to fail.

**Scenario 2: High latency but low error rate**

Your API is slow, but requests are succeeding. This often indicates a resource constraint somewhere. If IntegrationLatency is high, your backend is slow—look for expensive operations, high concurrency, or bottlenecks in your database. If IntegrationLatency is normal but overall Latency is high, API Gateway itself is slow, possibly due to request validation or transformation overhead. For Lambda integrations, high latency can also indicate Lambda cold starts—especially if you notice latency is high intermittently rather than consistently.

**Scenario 3: Spike in 4XX errors**

This usually means your clients are sending bad requests. Check your access logs—what's the breakdown of 4XX codes? 401s might indicate an authentication issue. 400s might indicate clients are sending malformed payloads. 403s might suggest an authorization problem. Unlike 5XX errors, 4XX errors aren't always a sign of a problem; some 4XX errors are expected and normal. But a sudden spike is worth investigating—it might mean a client deployed a buggy version.

**Scenario 4: Increasing latency over time**

If latency is creeping up gradually rather than spiking suddenly, you might be growing into your API's capacity. This is common as traffic increases. It's a sign to consider caching, optimizing your backend, or potentially splitting your API across multiple instances or regions.

### Building a Comprehensive Monitoring Strategy

Effective monitoring is more than just turning on metrics and logs. You need a strategy that combines different signals into a coherent picture. Consider creating a CloudWatch dashboard that brings together your most important metrics: Count, 5XXError, 4XXError, Latency, and IntegrationLatency, all visualized over time. Add your alarms to the dashboard so you can see at a glance which alarms are active.

Set up your alarms with appropriate thresholds for your workload. A high-traffic API might tolerate a few hundred errors per hour, while a critical payment API might want to alert on even a single 5XX error. Think about your SLA—if you promise 99.9% availability, that's about 43 seconds of downtime per month, or roughly one 5XX error every 10,000 requests on a moderately-loaded API.

Use access logs not just for reactive troubleshooting, but for proactive analysis. Regularly query your logs to identify trends: which endpoints are slowest, which are most error-prone, which have the most traffic. Use this information to prioritize optimization efforts.

And remember that observability is a continuous process, not a one-time setup. As your API evolves, your monitoring should evolve with it. New endpoints might need new alarms. Latency targets might change. Access log formats might be refined to capture additional details. Treat your monitoring setup as living infrastructure that deserves regular attention and iteration.

### Conclusion

Proper monitoring and observability transform API Gateway from a black box into an understandable system. CloudWatch metrics give you the birds-eye view, showing you overall health and performance. Access logs give you the granular details—the story of individual requests. Alarms wake you up when something's wrong. And tools like CloudWatch Insights and Athena let you analyze your logs to understand patterns and root causes.

The investment in setting up comprehensive monitoring pays dividends. You'll detect and diagnose issues faster, understand your users' experience more clearly, and make data-driven decisions about optimization. In production environments where availability and performance matter, observability isn't optional—it's essential.
