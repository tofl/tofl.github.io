---
title: "25. CloudWatch"
type: docs
weight: 1
---

## CloudWatch

CloudWatch is AWS's primary observability service — a unified platform for collecting metrics, logs, and events from virtually every AWS service and your own applications. Before CloudWatch, understanding what was actually happening inside your infrastructure meant stitching together custom scripts, third-party agents, and ad-hoc logging setups. CloudWatch solves this by providing a single place to monitor resource health, detect anomalies, trigger automated responses, and query logs — all without managing any underlying infrastructure.

### Metrics

A **metric** is a time-ordered set of data points representing a measurable value — CPU utilization, number of requests, queue depth, and so on. Metrics are grouped into **namespaces** (e.g., `AWS/EC2`, `AWS/Lambda`), which act as containers that prevent naming collisions between services. Within a namespace, **dimensions** are key-value pairs that further identify a metric — for example, the `InstanceId` dimension on an EC2 CPU metric tells CloudWatch which specific instance that data belongs to.

Metrics come in two resolutions [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/publishingMetrics.html#high-resolution-metrics):
- **Standard resolution** — data points recorded at 1-minute granularity (the default for most AWS services).
- **High resolution** — data points recorded down to 1-second granularity, useful when you need tight feedback loops (e.g., auto-scaling a service that spikes within seconds).

### Custom Metrics

AWS services publish their own metrics automatically, but your application logic is invisible to CloudWatch by default. The **PutMetricData** API [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html) lets you push any business or application metric — order count, active sessions, queue processing time — into a custom namespace. You choose the namespace, dimensions, unit, and resolution. From there, custom metrics behave exactly like built-in ones: you can alarm on them, graph them, and run anomaly detection against them.

A common pattern is calling `PutMetricData` from within a Lambda function or an application running on EC2 to track domain-specific KPIs alongside infrastructure metrics in the same dashboard.

### CloudWatch Logs

CloudWatch Logs is the log management layer of CloudWatch [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html). Logs are organized into:
- **Log groups** — a collection of log streams that share the same retention, access control, and metric filter settings. Typically one log group per application or Lambda function.
- **Log streams** — a sequence of log events from a single source (e.g., one EC2 instance, one Lambda invocation container).

**Retention policies** are configured at the log group level. By default, logs are kept indefinitely, which can become expensive. Setting a retention period (e.g., 7 days, 30 days, 1 year) automatically deletes older events and is a cost-control best practice.

#### Metric Filters

Raw log data often contains information you want to treat as a metric — for example, counting the occurrences of the word `ERROR` or extracting a response time value. **Metric Filters** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html) let you define a filter pattern on a log group and publish matching data as a CloudWatch metric. This bridges the gap between unstructured log output and the structured metrics world, enabling you to alarm on log-derived signals without a separate log processing pipeline.

#### Subscription Filters

When you need to act on log data in **real time**, subscription filters are the tool. A subscription filter [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html) attaches to a log group and streams matching log events — as they arrive — to a downstream destination:
- **AWS Lambda** — for lightweight, serverless log processing or forwarding.
- **Kinesis Data Streams** — for high-throughput ingestion into a custom processing pipeline.
- **Kinesis Data Firehose** — for near-real-time delivery to S3, OpenSearch, or Splunk.

A practical example: stream application logs from a log group to Lambda, which parses each event, detects a specific error pattern, and posts a Slack alert — all within seconds of the log being written.

### CloudWatch Alarms

An alarm [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html) watches a single metric over a defined time window and transitions between three states:
- **OK** — the metric is within the defined threshold.
- **ALARM** — the metric has breached the threshold.
- **INSUFFICIENT_DATA** — not enough data points exist yet to evaluate the alarm (common shortly after creation or for infrequently reported metrics).

When an alarm transitions to ALARM, it can trigger **actions**: sending an SNS notification, invoking an Auto Scaling policy, stopping or rebooting an EC2 instance, or triggering a Systems Manager automation. This makes alarms the core feedback loop for operational response on AWS.

#### Composite Alarms

A **Composite Alarm** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html) combines multiple individual alarms using boolean logic (`AND`, `OR`, `NOT`). This is useful for reducing alert noise: instead of firing a page every time CPU spikes, you can require that CPU is high **and** error rate is elevated **and** latency has increased — only then treating the situation as a true incident requiring immediate action.

### CloudWatch Dashboards

Dashboards [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html) are customizable, shareable views that aggregate metrics and alarms into a single pane of glass. They can span multiple AWS services and regions, making them the natural home for an operational runbook or an executive-facing health overview. Dashboards update in near real-time and can be shared across AWS accounts.

### CloudWatch Agent

The metrics that AWS publishes automatically for EC2 (CPU, network, disk I/O at the hypervisor level) do not include **in-guest** data like memory utilization or disk space usage — those require access inside the operating system. The **CloudWatch Agent** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html) runs as a process on EC2 instances (and on-premises servers) and ships OS-level metrics and log files to CloudWatch. Configuration is done via a JSON config file (which can be managed centrally through Systems Manager Parameter Store), making it easy to standardize the agent setup across a fleet of instances.

### CloudWatch Logs Insights

**Logs Insights** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html) is an interactive query engine built into CloudWatch Logs. It uses its own query language that supports filtering, aggregation, sorting, and visualization — purpose-built for log analysis. For example, you can query a Lambda log group to find the 10 slowest invocations in the last hour, or count 5xx errors by endpoint across an API fleet. Queries run in parallel across log streams and return results quickly even against large volumes of data. Logs Insights is the go-to tool for ad-hoc debugging and post-incident analysis.

### Anomaly Detection

Rather than setting static thresholds, **Anomaly Detection** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html) uses machine learning to model the expected behavior of a metric over time — accounting for daily and weekly seasonality patterns. CloudWatch then highlights deviations from the expected band and can trigger alarms when the metric steps outside that band. This is particularly useful for traffic-driven metrics where "normal" changes throughout the day.

### Container Insights and Lambda Insights

For containerized workloads (ECS, EKS) and Lambda functions, CloudWatch offers purpose-built observability layers:

- **Container Insights** [🔗](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html) collects and aggregates metrics and logs from containers — CPU, memory, network, and disk per task/pod/node — and presents them in pre-built dashboards. It requires deploying the CloudWatch Agent (or the AWS Distro for OpenTelemetry) as a sidecar or DaemonSet.
- **Lambda Insights** [🔗](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-insights.html) is a monitoring solution for Lambda functions that surfaces cold start duration, memory usage, and initialization time as structured metrics, going beyond what the default Lambda metrics provide. It is enabled by adding a Lambda layer to your function.

Both features follow the same pattern: opt in, and CloudWatch automatically begins collecting richer telemetry that would otherwise require custom instrumentation.

{{< qcm >}}
[
{
"question": "A developer wants to track the number of failed payment transactions in their e-commerce application running on EC2. Which API should they use to send this custom business metric to CloudWatch?",
"answers": [
{
"answer": "PutMetricData",
"isCorrect": true,
"explanation": "PutMetricData is the CloudWatch API used to publish custom metrics from your application into a custom namespace. It supports custom dimensions, units, and resolutions."
},
{
"answer": "PutLogEvents",
"isCorrect": false,
"explanation": "PutLogEvents is used to send log events to a CloudWatch Logs log stream, not to publish numeric metrics."
},
{
"answer": "PutMetricAlarm",
"isCorrect": false,
"explanation": "PutMetricAlarm creates or updates an alarm on an existing metric. It does not publish metric data points."
},
{
"answer": "GetMetricStatistics",
"isCorrect": false,
"explanation": "GetMetricStatistics retrieves statistics for an existing metric. It is a read operation, not used for publishing data."
}
]
},
{
"question": "An application experiences traffic spikes that last only a few seconds. A developer needs CloudWatch metrics with the finest possible granularity to trigger auto-scaling quickly. Which metric resolution should they use?",
"answers": [
{
"answer": "High resolution, with data points recorded down to 1-second granularity",
"isCorrect": true,
"explanation": "High-resolution metrics support 1-second granularity, enabling tight feedback loops for fast-spiking workloads where standard 1-minute resolution would be too slow."
},
{
"answer": "Standard resolution, with data points recorded at 1-minute granularity",
"isCorrect": false,
"explanation": "Standard resolution only provides data at 1-minute intervals. For sub-minute spikes, this granularity is insufficient to trigger timely auto-scaling."
},
{
"answer": "Detailed monitoring, with data points recorded at 10-second granularity",
"isCorrect": false,
"explanation": "There is no 10-second granularity tier in CloudWatch. The two resolutions are standard (1 minute) and high resolution (down to 1 second)."
},
{
"answer": "Basic monitoring, with data points recorded at 5-minute granularity",
"isCorrect": false,
"explanation": "5-minute granularity (basic monitoring) is even coarser than standard resolution and is completely unsuitable for fast-spiking workloads."
}
]
},
{
"question": "A team notices their CloudWatch Logs costs are increasing significantly. They determine that many log groups are retaining data indefinitely. What is the recommended action to control costs?",
"answers": [
{
"answer": "Configure a retention policy on each log group to automatically delete log events after a defined period",
"isCorrect": true,
"explanation": "Retention policies are set at the log group level. By default, logs are kept indefinitely. Setting a retention period (e.g., 7, 30, or 365 days) automatically purges older events and is a CloudWatch cost-control best practice."
},
{
"answer": "Delete individual log streams manually on a schedule",
"isCorrect": false,
"explanation": "Manually deleting log streams is operationally expensive and error-prone. Retention policies at the log group level automate this process."
},
{
"answer": "Use metric filters to reduce the volume of log data stored",
"isCorrect": false,
"explanation": "Metric filters extract metric data from logs but do not reduce log storage. The raw log events are still retained according to the log group's retention setting."
},
{
"answer": "Switch to high-resolution metrics to replace log storage",
"isCorrect": false,
"explanation": "High-resolution metrics address metric granularity, not log storage. They cannot replace log retention management."
}
]
},
{
"question": "A developer wants to count the number of times the string 'ERROR' appears in a CloudWatch Logs log group and use that count as a CloudWatch metric to trigger an alarm. Which feature should they use?",
"answers": [
{
"answer": "Metric Filters",
"isCorrect": true,
"explanation": "Metric Filters allow you to define a filter pattern on a log group and publish matching occurrences as a CloudWatch metric. This bridges unstructured log data and the structured metrics world without needing a separate pipeline."
},
{
"answer": "Subscription Filters",
"isCorrect": false,
"explanation": "Subscription Filters stream matching log events in real time to destinations like Lambda or Kinesis. They do not directly publish CloudWatch metrics."
},
{
"answer": "CloudWatch Logs Insights",
"isCorrect": false,
"explanation": "Logs Insights is an interactive query tool for ad-hoc log analysis. It does not continuously monitor log groups or publish metrics automatically."
},
{
"answer": "CloudWatch Anomaly Detection",
"isCorrect": false,
"explanation": "Anomaly Detection uses ML to model expected metric behavior. It operates on existing metrics and cannot extract metrics from raw log data."
}
]
},
{
"question": "A company wants to stream application logs from a CloudWatch Logs log group to an Amazon S3 bucket in near real-time for long-term archival. Which approach should they use?",
"answers": [
{
"answer": "Create a subscription filter on the log group targeting Kinesis Data Firehose, configured to deliver to S3",
"isCorrect": true,
"explanation": "Subscription filters stream matching log events in real time to downstream destinations. Kinesis Data Firehose supports near-real-time delivery to S3 (as well as OpenSearch and Splunk), making this the correct pattern for log archival."
},
{
"answer": "Create a metric filter on the log group and configure it to export to S3",
"isCorrect": false,
"explanation": "Metric filters publish numeric metrics from log patterns — they do not export raw log data to S3."
},
{
"answer": "Create a subscription filter on the log group targeting AWS Lambda, which writes directly to DynamoDB",
"isCorrect": false,
"explanation": "While Lambda is a valid subscription filter destination, writing to DynamoDB is not the pattern for S3 archival. Kinesis Data Firehose is the purpose-built service for this use case."
},
{
"answer": "Enable CloudWatch Logs Insights to export query results to S3 on a schedule",
"isCorrect": false,
"explanation": "Logs Insights is an interactive, on-demand query tool. It does not support continuous, near-real-time log streaming to S3."
}
]
},
{
"question": "Which of the following are valid destinations for a CloudWatch Logs subscription filter? (Select TWO)",
"answers": [
{
"answer": "AWS Lambda",
"isCorrect": true,
"explanation": "Lambda is a supported subscription filter destination, suitable for lightweight, serverless log processing such as parsing events and sending alerts."
},
{
"answer": "Kinesis Data Streams",
"isCorrect": true,
"explanation": "Kinesis Data Streams is a supported destination for high-throughput ingestion of log events into a custom processing pipeline."
},
{
"answer": "Amazon SQS",
"isCorrect": false,
"explanation": "Amazon SQS is not a valid destination for CloudWatch Logs subscription filters. Supported destinations are Lambda, Kinesis Data Streams, and Kinesis Data Firehose."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "Amazon RDS is not a destination for subscription filters. Subscription filters stream to Lambda, Kinesis Data Streams, or Kinesis Data Firehose."
},
{
"answer": "Amazon DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is not a direct subscription filter destination. Log data would need to be processed by an intermediary such as Lambda to be written to DynamoDB."
}
]
},
{
"question": "A CloudWatch alarm monitoring an EC2 instance's CPU metric was just created. Shortly afterward, the alarm shows a state of INSUFFICIENT_DATA. What does this state indicate?",
"answers": [
{
"answer": "There are not enough data points available yet for CloudWatch to evaluate the alarm's threshold",
"isCorrect": true,
"explanation": "INSUFFICIENT_DATA means CloudWatch cannot yet determine whether the metric is within or outside the threshold due to a lack of data points. This is common immediately after alarm creation or for infrequently reported metrics."
},
{
"answer": "The EC2 instance is terminated and no longer publishing metrics",
"isCorrect": false,
"explanation": "While a terminated instance would stop publishing metrics, the alarm state reflects missing data generically. INSUFFICIENT_DATA simply means not enough data exists to evaluate — it does not imply instance termination."
},
{
"answer": "The alarm threshold has been breached",
"isCorrect": false,
"explanation": "A breached threshold results in the ALARM state, not INSUFFICIENT_DATA."
},
{
"answer": "The metric namespace is incorrectly configured",
"isCorrect": false,
"explanation": "A misconfigured namespace would prevent metric data from appearing, but the alarm state would still be INSUFFICIENT_DATA — not a distinct configuration error state."
}
]
},
{
"question": "An operations team receives too many individual CloudWatch alarm notifications, many of which are false positives caused by brief, isolated metric spikes. They want to be alerted only when CPU utilization is high AND error rate is elevated AND latency has increased simultaneously. Which CloudWatch feature addresses this requirement?",
"answers": [
{
"answer": "Composite Alarms",
"isCorrect": true,
"explanation": "Composite Alarms combine multiple individual alarms using boolean logic (AND, OR, NOT). This allows teams to reduce alert noise by requiring multiple conditions to be true simultaneously before triggering an action."
},
{
"answer": "Anomaly Detection alarms",
"isCorrect": false,
"explanation": "Anomaly Detection alarms trigger when a single metric deviates from its expected band. They cannot combine conditions from multiple separate metrics."
},
{
"answer": "Metric Filters with multiple patterns",
"isCorrect": false,
"explanation": "Metric Filters extract metrics from log data. They do not provide boolean logic for combining multiple alarm states."
},
{
"answer": "CloudWatch Dashboards with threshold alerts",
"isCorrect": false,
"explanation": "Dashboards are visualization tools. They do not support alarm logic or automated alerting based on combined conditions."
}
]
},
{
"question": "A developer needs to monitor memory utilization and available disk space on a fleet of EC2 instances. After checking CloudWatch, they notice these metrics are not available by default. What is the correct solution?",
"answers": [
{
"answer": "Install and configure the CloudWatch Agent on the EC2 instances to collect and publish in-guest OS metrics",
"isCorrect": true,
"explanation": "AWS's default EC2 metrics are collected at the hypervisor level and do not include in-guest data like memory usage or disk space. The CloudWatch Agent runs inside the OS and ships these metrics (and log files) to CloudWatch."
},
{
"answer": "Enable detailed monitoring on the EC2 instances in the AWS console",
"isCorrect": false,
"explanation": "Detailed monitoring increases the frequency of default EC2 metrics from 5 minutes to 1 minute, but it still only covers hypervisor-level metrics. It does not add memory or disk space metrics."
},
{
"answer": "Use PutMetricData to manually push memory and disk metrics from application code",
"isCorrect": false,
"explanation": "While PutMetricData could theoretically be used, it requires custom scripting per metric. The CloudWatch Agent is the purpose-built, standardized solution for collecting OS-level metrics."
},
{
"answer": "Enable Container Insights on the EC2 instances",
"isCorrect": false,
"explanation": "Container Insights is designed for containerized workloads (ECS, EKS). It is not the appropriate solution for collecting OS-level metrics from standard EC2 instances."
}
]
},
{
"question": "A developer wants to find the 10 slowest Lambda invocations in the past hour across a specific log group. Which CloudWatch feature is best suited for this ad-hoc analysis?",
"answers": [
{
"answer": "CloudWatch Logs Insights",
"isCorrect": true,
"explanation": "Logs Insights is an interactive query engine built into CloudWatch Logs. It supports filtering, aggregation, sorting, and visualization, and is specifically designed for ad-hoc log analysis such as finding the slowest invocations."
},
{
"answer": "CloudWatch Metric Filters",
"isCorrect": false,
"explanation": "Metric Filters continuously monitor log groups and publish matching data as metrics. They are not suited for one-off, interactive queries across historical log data."
},
{
"answer": "CloudWatch Dashboards",
"isCorrect": false,
"explanation": "Dashboards visualize pre-configured metrics and alarms. They do not provide an ad-hoc query interface for log data."
},
{
"answer": "CloudWatch Anomaly Detection",
"isCorrect": false,
"explanation": "Anomaly Detection models expected metric behavior using ML. It does not query or analyze raw log records."
}
]
},
{
"question": "A team manages metrics for a web application where traffic varies significantly throughout the day and by day of the week. They want CloudWatch to automatically alert them when a metric behaves unusually without needing to define a fixed threshold. Which feature should they enable?",
"answers": [
{
"answer": "CloudWatch Anomaly Detection",
"isCorrect": true,
"explanation": "Anomaly Detection uses ML to model the expected behavior of a metric over time, accounting for daily and weekly seasonality. It alerts when the metric falls outside the expected band, removing the need for static thresholds."
},
{
"answer": "A standard CloudWatch alarm with a static threshold",
"isCorrect": false,
"explanation": "Static thresholds do not account for traffic patterns or seasonality. A threshold appropriate for peak hours may trigger false positives during off-peak hours, and vice versa."
},
{
"answer": "A Composite Alarm combining CPU and network metrics",
"isCorrect": false,
"explanation": "Composite Alarms reduce noise by combining multiple alarms with boolean logic. They still rely on static thresholds and do not model seasonal patterns automatically."
},
{
"answer": "CloudWatch Logs Insights with a scheduled query",
"isCorrect": false,
"explanation": "Logs Insights is an ad-hoc query tool for log data. It does not model metric seasonality or trigger automated alarms."
}
]
},
{
"question": "A company runs a microservices application on Amazon ECS. The platform team wants pre-built dashboards showing CPU, memory, network, and disk metrics per task and per node without writing custom instrumentation. Which CloudWatch feature provides this?",
"answers": [
{
"answer": "Container Insights",
"isCorrect": true,
"explanation": "Container Insights is purpose-built for ECS and EKS workloads. It collects and aggregates container-level metrics (CPU, memory, network, disk per task/pod/node) and presents them in pre-built dashboards, typically by deploying the CloudWatch Agent as a sidecar or DaemonSet."
},
{
"answer": "Lambda Insights",
"isCorrect": false,
"explanation": "Lambda Insights is designed for Lambda functions, surfacing cold start duration, memory usage, and initialization time. It is not applicable to ECS container workloads."
},
{
"answer": "CloudWatch Logs Insights",
"isCorrect": false,
"explanation": "Logs Insights is a log query tool. It does not automatically collect container-level metrics or provide pre-built container dashboards."
},
{
"answer": "The CloudWatch Agent with a custom JSON configuration",
"isCorrect": false,
"explanation": "While the CloudWatch Agent is part of the Container Insights implementation, using it alone with a custom configuration requires manual instrumentation. Container Insights is the managed, pre-built solution for this use case."
}
]
},
{
"question": "A developer wants to enable enhanced monitoring for a Lambda function, including cold start duration, memory usage, and initialization time, with minimal code changes. What is the correct approach?",
"answers": [
{
"answer": "Add the Lambda Insights Lambda layer to the function",
"isCorrect": true,
"explanation": "Lambda Insights is enabled by adding a specific Lambda layer to the function. Once added, CloudWatch automatically collects enhanced telemetry including cold start duration, memory usage, and initialization time as structured metrics."
},
{
"answer": "Install the CloudWatch Agent inside the Lambda execution environment",
"isCorrect": false,
"explanation": "Lambda functions run in managed, ephemeral environments where you cannot install a persistent agent. Lambda Insights works via a Lambda layer, not the CloudWatch Agent."
},
{
"answer": "Enable Container Insights on the Lambda function",
"isCorrect": false,
"explanation": "Container Insights is designed for ECS and EKS container workloads, not Lambda functions. Lambda Insights is the purpose-built feature for Lambda observability."
},
{
"answer": "Use PutMetricData in the function code to manually publish cold start and memory metrics",
"isCorrect": false,
"explanation": "While possible, manually using PutMetricData requires custom instrumentation for each metric. Lambda Insights provides this automatically with no code changes beyond adding the layer."
}
]
},
{
"question": "Which of the following correctly describes the relationship between CloudWatch namespaces and dimensions?",
"answers": [
{
"answer": "A namespace is a container that groups related metrics (e.g., AWS/EC2), and dimensions are key-value pairs within a namespace that identify a specific metric source (e.g., InstanceId=i-1234)",
"isCorrect": true,
"explanation": "Namespaces prevent naming collisions between services by grouping their metrics. Dimensions further narrow down which specific resource a metric belongs to within that namespace."
},
{
"answer": "A dimension is a container for metrics, and a namespace is a key-value pair that identifies a metric source",
"isCorrect": false,
"explanation": "This reverses the definitions. Namespaces are the containers (e.g., AWS/EC2), while dimensions are the key-value pairs that identify the specific resource (e.g., InstanceId)."
},
{
"answer": "A namespace and a dimension serve the same purpose and can be used interchangeably",
"isCorrect": false,
"explanation": "Namespaces and dimensions serve different purposes. Namespaces organize metrics by service or application; dimensions identify the specific resource within a namespace."
},
{
"answer": "Dimensions are only available for custom metrics published via PutMetricData, not for AWS service metrics",
"isCorrect": false,
"explanation": "Dimensions are used for both AWS service metrics and custom metrics. For example, EC2 metrics use the InstanceId dimension to identify a specific instance."
}
]
},
{
"question": "A CloudWatch alarm transitions to the ALARM state. Which of the following actions can the alarm trigger? (Select THREE)",
"answers": [
{
"answer": "Sending a notification via Amazon SNS",
"isCorrect": true,
"explanation": "SNS notifications are a native CloudWatch alarm action, commonly used to email, SMS, or fan out alerts to multiple subscribers."
},
{
"answer": "Invoking an EC2 Auto Scaling policy",
"isCorrect": true,
"explanation": "CloudWatch alarms can directly trigger Auto Scaling policies, enabling automated scale-out or scale-in responses to metric changes."
},
{
"answer": "Stopping or rebooting an EC2 instance",
"isCorrect": true,
"explanation": "CloudWatch alarms support EC2 instance actions including stopping, terminating, rebooting, or recovering an instance when the alarm transitions to ALARM."
},
{
"answer": "Automatically deleting the CloudWatch log group",
"isCorrect": false,
"explanation": "CloudWatch alarms do not support deleting log groups as an alarm action. Supported actions include SNS, Auto Scaling, EC2 actions, and Systems Manager automations."
},
{
"answer": "Directly writing a record to an Amazon DynamoDB table",
"isCorrect": false,
"explanation": "CloudWatch alarms cannot directly write to DynamoDB. You could achieve this indirectly by triggering SNS → Lambda → DynamoDB, but it is not a native alarm action."
}
]
},
{
"question": "A developer is setting up the CloudWatch Agent on a large fleet of EC2 instances and wants to manage the agent configuration centrally. What is the recommended approach?",
"answers": [
{
"answer": "Store the CloudWatch Agent JSON configuration file in AWS Systems Manager Parameter Store and reference it during agent setup",
"isCorrect": true,
"explanation": "The CloudWatch Agent supports configuration via a JSON file that can be centrally managed through Systems Manager Parameter Store. This allows standardized, fleet-wide configuration without manually managing files on each instance."
},
{
"answer": "Hardcode the configuration in the EC2 user data script for each instance",
"isCorrect": false,
"explanation": "Hardcoding configuration in user data is not scalable or maintainable for large fleets. Changes would require re-launching instances or running scripts across the fleet."
},
{
"answer": "Store the configuration in an S3 bucket and have each instance download it at boot",
"isCorrect": false,
"explanation": "While technically possible, this is not the recommended approach. Systems Manager Parameter Store is the purpose-built, centrally managed solution for CloudWatch Agent configuration."
},
{
"answer": "Use CloudWatch Dashboards to push configuration to all agents simultaneously",
"isCorrect": false,
"explanation": "CloudWatch Dashboards are a visualization feature. They have no role in agent configuration management."
}
]
},
{
"question": "A CloudWatch Dashboard needs to display metrics from multiple AWS regions and multiple services in a single view. Is this supported, and what is the expected behavior?",
"answers": [
{
"answer": "Yes — CloudWatch Dashboards can span multiple AWS services and regions, providing a unified operational view",
"isCorrect": true,
"explanation": "CloudWatch Dashboards support cross-service and cross-region metric aggregation in a single pane of glass. They update in near real-time and can also be shared across AWS accounts."
},
{
"answer": "No — each CloudWatch Dashboard is limited to a single AWS region",
"isCorrect": false,
"explanation": "CloudWatch Dashboards are not limited to a single region. They explicitly support cross-region metric visualization."
},
{
"answer": "Yes, but only for metrics within a single AWS account",
"isCorrect": false,
"explanation": "CloudWatch Dashboards can be shared across AWS accounts in addition to spanning multiple regions and services."
},
{
"answer": "No — cross-service metrics require Amazon Managed Grafana",
"isCorrect": false,
"explanation": "While Managed Grafana is a valid observability tool, CloudWatch Dashboards natively support cross-service and cross-region views without requiring a third-party solution."
}
]
}
]
{{< /qcm >}}