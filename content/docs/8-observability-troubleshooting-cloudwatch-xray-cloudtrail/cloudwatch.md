---
title: "25. CloudWatch"
type: docs
weight: 1
---

# CloudWatch

CloudWatch is AWS's primary observability service — a unified platform for collecting metrics, logs, and events from virtually every AWS service and your own applications. Before CloudWatch, understanding what was actually happening inside your infrastructure meant stitching together custom scripts, third-party agents, and ad-hoc logging setups. CloudWatch solves this by providing a single place to monitor resource health, detect anomalies, trigger automated responses, and query logs — all without managing any underlying infrastructure.

## Metrics

A **metric** is a time-ordered set of data points representing a measurable value — CPU utilization, number of requests, queue depth, and so on. Metrics are grouped into **namespaces** (e.g., `AWS/EC2`, `AWS/Lambda`), which act as containers that prevent naming collisions between services. Within a namespace, **dimensions** are key-value pairs that further identify a metric — for example, the `InstanceId` dimension on an EC2 CPU metric tells CloudWatch which specific instance that data belongs to.

Metrics come in two resolutions [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/publishingMetrics.html#high-resolution-metrics):
- **Standard resolution** — data points recorded at 1-minute granularity (the default for most AWS services).
- **High resolution** — data points recorded down to 1-second granularity, useful when you need tight feedback loops (e.g., auto-scaling a service that spikes within seconds).

## Custom Metrics

AWS services publish their own metrics automatically, but your application logic is invisible to CloudWatch by default. The **PutMetricData** API [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html) lets you push any business or application metric — order count, active sessions, queue processing time — into a custom namespace. You choose the namespace, dimensions, unit, and resolution. From there, custom metrics behave exactly like built-in ones: you can alarm on them, graph them, and run anomaly detection against them.

A common pattern is calling `PutMetricData` from within a Lambda function or an application running on EC2 to track domain-specific KPIs alongside infrastructure metrics in the same dashboard.

## CloudWatch Logs

CloudWatch Logs is the log management layer of CloudWatch [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html). Logs are organized into:
- **Log groups** — a collection of log streams that share the same retention, access control, and metric filter settings. Typically one log group per application or Lambda function.
- **Log streams** — a sequence of log events from a single source (e.g., one EC2 instance, one Lambda invocation container).

**Retention policies** are configured at the log group level. By default, logs are kept indefinitely, which can become expensive. Setting a retention period (e.g., 7 days, 30 days, 1 year) automatically deletes older events and is a cost-control best practice.

### Metric Filters

Raw log data often contains information you want to treat as a metric — for example, counting the occurrences of the word `ERROR` or extracting a response time value. **Metric Filters** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html) let you define a filter pattern on a log group and publish matching data as a CloudWatch metric. This bridges the gap between unstructured log output and the structured metrics world, enabling you to alarm on log-derived signals without a separate log processing pipeline.

### Subscription Filters

When you need to act on log data in **real time**, subscription filters are the tool. A subscription filter [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html) attaches to a log group and streams matching log events — as they arrive — to a downstream destination:
- **AWS Lambda** — for lightweight, serverless log processing or forwarding.
- **Kinesis Data Streams** — for high-throughput ingestion into a custom processing pipeline.
- **Kinesis Data Firehose** — for near-real-time delivery to S3, OpenSearch, or Splunk.

A practical example: stream application logs from a log group to Lambda, which parses each event, detects a specific error pattern, and posts a Slack alert — all within seconds of the log being written.

## CloudWatch Alarms

An alarm [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html) watches a single metric over a defined time window and transitions between three states:
- **OK** — the metric is within the defined threshold.
- **ALARM** — the metric has breached the threshold.
- **INSUFFICIENT_DATA** — not enough data points exist yet to evaluate the alarm (common shortly after creation or for infrequently reported metrics).

When an alarm transitions to ALARM, it can trigger **actions**: sending an SNS notification, invoking an Auto Scaling policy, stopping or rebooting an EC2 instance, or triggering a Systems Manager automation. This makes alarms the core feedback loop for operational response on AWS.

### Composite Alarms

A **Composite Alarm** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html) combines multiple individual alarms using boolean logic (`AND`, `OR`, `NOT`). This is useful for reducing alert noise: instead of firing a page every time CPU spikes, you can require that CPU is high **and** error rate is elevated **and** latency has increased — only then treating the situation as a true incident requiring immediate action.

## CloudWatch Dashboards

Dashboards [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html) are customizable, shareable views that aggregate metrics and alarms into a single pane of glass. They can span multiple AWS services and regions, making them the natural home for an operational runbook or an executive-facing health overview. Dashboards update in near real-time and can be shared across AWS accounts.

## CloudWatch Agent

The metrics that AWS publishes automatically for EC2 (CPU, network, disk I/O at the hypervisor level) do not include **in-guest** data like memory utilization or disk space usage — those require access inside the operating system. The **CloudWatch Agent** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html) runs as a process on EC2 instances (and on-premises servers) and ships OS-level metrics and log files to CloudWatch. Configuration is done via a JSON config file (which can be managed centrally through Systems Manager Parameter Store), making it easy to standardize the agent setup across a fleet of instances.

## CloudWatch Logs Insights

**Logs Insights** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html) is an interactive query engine built into CloudWatch Logs. It uses its own query language that supports filtering, aggregation, sorting, and visualization — purpose-built for log analysis. For example, you can query a Lambda log group to find the 10 slowest invocations in the last hour, or count 5xx errors by endpoint across an API fleet. Queries run in parallel across log streams and return results quickly even against large volumes of data. Logs Insights is the go-to tool for ad-hoc debugging and post-incident analysis.

## Anomaly Detection

Rather than setting static thresholds, **Anomaly Detection** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html) uses machine learning to model the expected behavior of a metric over time — accounting for daily and weekly seasonality patterns. CloudWatch then highlights deviations from the expected band and can trigger alarms when the metric steps outside that band. This is particularly useful for traffic-driven metrics where "normal" changes throughout the day.

## Container Insights and Lambda Insights

For containerized workloads (ECS, EKS) and Lambda functions, CloudWatch offers purpose-built observability layers:

- **Container Insights** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html) collects and aggregates metrics and logs from containers — CPU, memory, network, and disk per task/pod/node — and presents them in pre-built dashboards. It requires deploying the CloudWatch Agent (or the AWS Distro for OpenTelemetry) as a sidecar or DaemonSet.
- **Lambda Insights** [🔗](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-insights.html) is a monitoring solution for Lambda functions that surfaces cold start duration, memory usage, and initialization time as structured metrics, going beyond what the default Lambda metrics provide. It is enabled by adding a Lambda layer to your function.

Both features follow the same pattern: opt in, and CloudWatch automatically begins collecting richer telemetry that would otherwise require custom instrumentation.