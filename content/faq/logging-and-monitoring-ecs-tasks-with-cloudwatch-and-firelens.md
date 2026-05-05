---
title: "Logging and Monitoring ECS Tasks with CloudWatch and FireLens"
---

## Logging and Monitoring ECS Tasks with CloudWatch and FireLens

When you deploy containerized applications on AWS Elastic Container Service, you're trading the simplicity of seeing logs directly on your host machine for a more distributed, scalable logging architecture. This shift requires a deliberate approach to logging—one that captures container output, routes it reliably, and makes it queryable and actionable across your fleet. Whether you're running a handful of tasks or thousands, understanding how to instrument your ECS containers with logging will determine how quickly you can troubleshoot issues, audit behavior, and understand application performance.

In this article, we'll explore the full spectrum of logging options available to ECS task developers: from CloudWatch Logs integration via the awslogs driver, to the flexibility of FireLens for routing logs to third-party platforms, to Container Insights for deep observability. We'll also cover the often-overlooked but critical aspects—IAM permissions, log retention strategies, and cost optimization—that turn logging infrastructure from a nice-to-have into a reliable operational practice.

### Understanding the ECS Logging Challenge

Before diving into tooling, let's establish why ECS logging is fundamentally different from traditional application logging. When you run an application on your laptop, you can tail logs in real time, grep through them instantly, and correlate them with system events happening on the same machine. With ECS, your containers are ephemeral—they start, do their work, and shut down. Their lifecycle is managed by the scheduler, not by you. Without intentional logging architecture, all that output simply vanishes.

Moreover, ECS encourages you to run multiple copies of the same task across different container instances or availability zones. That means logs are scattered across multiple sources. Without a centralized logging solution, correlating events across your distributed system becomes a nightmare.

This is where AWS's logging solutions come in. They solve two core problems: capturing container output reliably and making that output queryable and actionable at scale.

### The CloudWatch Logs Driver: Native Integration with awslogs

The simplest and most straightforward way to capture ECS container logs is the awslogs driver. This driver is built into the ECS agent and ships logs directly from your container to CloudWatch Logs with minimal configuration overhead.

#### How awslogs Works

When you specify the awslogs driver in your ECS task definition, the ECS agent intercepts everything your container writes to stdout and stderr and sends it to CloudWatch Logs. This happens automatically—your application doesn't need to know about CloudWatch at all. It just writes to standard output, the same way it would if running locally, and the logging driver handles the rest.

Here's what a minimal task definition with awslogs logging looks like:

```json
{
  "family": "my-application",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "my-app:latest",
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-application",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Let's break down those log configuration options. The `awslogs-group` is the CloudWatch Logs log group where all container output will be written. Think of this as a logical container for related logs. The `awslogs-region` specifies which region's CloudWatch Logs service should receive the logs—typically the same region where your ECS cluster operates. The `awslogs-stream-prefix` is particularly useful: it creates a predictable naming scheme for log streams within the group. With the prefix "ecs," your log streams will be named something like `ecs/app/container-id`, making them easy to identify and filter.

One critical point: the CloudWatch Logs log group must exist before your task runs, or the task will fail to start. Many teams create this as part of their infrastructure-as-code setup using CloudFormation or Terraform. The log group is inexpensive to create and maintain, so there's no reason to skip this step.

#### IAM Permissions for the Task Execution Role

Here's where many developers stumble: the awslogs driver requires specific IAM permissions, and these permissions belong on the *task execution role*, not the task role.

If you're new to this distinction, it's important to understand. The task execution role is assumed by the ECS agent itself—it's the role that allows the infrastructure to do its job setting up and running the task. The task role, by contrast, is assumed by the application code running inside the container and typically grants permissions to AWS services like DynamoDB or S3.

For the awslogs driver to function, the task execution role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/my-application:*"
    }
  ]
}
```

This policy grants permission to create new log streams (one per container instance and task) and write log events to them. If you're using CloudFormation or a similar tool, you might see these permissions bundled in a managed policy like `AmazonECSTaskExecutionRolePolicy`, but being explicit about what your infrastructure needs is always a good practice.

Without these permissions, the ECS agent will fail silently in a frustrating way—the task might run fine, but no logs will appear in CloudWatch. Always verify that your task execution role has the correct permissions when troubleshooting logging issues.

#### Log Group Configuration and Retention

Once logs are flowing into CloudWatch, you need to decide how long to keep them. CloudWatch Logs can retain data indefinitely, but indefinite retention isn't free. Logs cost money to store, and that cost compounds quickly at scale.

Most teams set a retention policy on their log groups based on operational needs. For example, you might retain logs for 30 days during normal operation, knowing that most issues are discovered and debugged within that window. For compliance-sensitive applications, you might retain logs longer—90 days, one year, or even indefinitely—and then export them to S3 for long-term archival.

You can set retention directly on the log group via the CLI:

```bash
aws logs put-retention-policy \
  --log-group-name /ecs/my-application \
  --retention-in-days 30
```

Or in CloudFormation:

```yaml
MyLogGroup:
  Type: AWS::Logs::LogGroup
  Properties:
    LogGroupName: /ecs/my-application
    RetentionInDays: 30
```

Setting retention in code rather than through the console ensures it's version-controlled and consistent across all your environments. It's also a safeguard against accidentally leaving retention off and watching your logs storage costs balloon.

### FireLens: Bringing Third-Party Logging to ECS

While CloudWatch Logs is powerful and tightly integrated with AWS, many organizations have existing investments in third-party logging platforms—Datadog, Splunk, New Relic, Elasticsearch, Sumo Logic, and others. For these teams, FireLens offers a way to route ECS container logs to their platform of choice without forcing them into an AWS-only logging stack.

FireLens works by pairing your application container with a log router sidecar container. The sidecar intercepts logs from your application and forwards them to your chosen third-party service, all while your application code remains completely unaware of the change.

#### How FireLens Works

FireLens uses Fluent Bit (a lightweight log processor and forwarder) or Fluentd (a more feature-rich alternative) as the routing engine. You specify FireLens in your task definition along with a configuration that tells the router where to send logs and how to format them.

Here's a simplified example using Fluent Bit to route logs to Datadog:

```json
{
  "family": "my-application",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "my-app:latest",
      "logConfiguration": {
        "logDriver": "awsfirelens",
        "options": {
          "Name": "datadog",
          "apikey": "${DD_API_KEY}",
          "provider": "ecs"
        }
      }
    },
    {
      "name": "log_router",
      "image": "public.ecr.aws/aws-observability/aws-for-fluent-bit:latest",
      "firelensConfiguration": {
        "type": "fluent-bit"
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-application/firelens",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "firelens"
        }
      }
    }
  ]
}
```

Notice the structure here: your main application container specifies `awsfirelens` as the log driver and provides configuration for the Datadog plugin. The `log_router` container runs the Fluent Bit image (AWS provides this container image in their public ECR registry), and it itself logs to CloudWatch so you can monitor the health of your logging infrastructure.

This two-container pattern might seem verbose, but it's elegant. Your application container's stdout and stderr are automatically captured by the log_router, which then processes and forwards them according to your configuration. If the log router container crashes or becomes unhealthy, the ECS service can detect it and restart the entire task, ensuring that logs continue to flow.

#### Configuring FireLens for Different Platforms

FireLens supports a wide range of output plugins. The configuration varies depending on your target platform, but the pattern is consistent: provide the plugin name and any authentication or endpoint information needed.

For Splunk, you might configure it like this:

```json
{
  "logConfiguration": {
    "logDriver": "awsfirelens",
    "options": {
      "Name": "splunk",
      "splunk_token": "${SPLUNK_TOKEN}",
      "splunk_host": "https://your-splunk-instance.splunk.com:8088"
    }
  }
}
```

For Elasticsearch:

```json
{
  "logConfiguration": {
    "logDriver": "awsfirelens",
    "options": {
      "Name": "es",
      "Host": "your-elasticsearch-domain.us-east-1.es.amazonaws.com",
      "Port": "443",
      "HTTP_User": "${ES_USER}",
      "HTTP_Passwd": "${ES_PASSWORD}"
    }
  }
}
```

In each case, sensitive values like API keys and passwords should be pulled from AWS Secrets Manager or Parameter Store, not hardcoded in the task definition. You can reference secrets in task definitions using the `valueFrom` attribute:

```json
{
  "name": "DD_API_KEY",
  "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:datadog-api-key"
}
```

#### IAM Permissions for FireLens

Like awslogs, FireLens requires IAM permissions on the task execution role. At a minimum, the role needs to write logs to CloudWatch (so the log router itself can be monitored). Additionally, depending on your configuration, you might need permissions to fetch secrets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/my-application/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:datadog-api-key"
    }
  ]
}
```

If you're pulling configuration from Parameter Store instead:

```json
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameters"
  ],
  "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/ecs/my-application/*"
}
```

#### FireLens Performance Considerations

One thing to keep in mind with FireLens is that the log router container consumes resources. It's not free—it adds memory overhead and CPU usage, even if minimal. For most workloads, the Fluent Bit image is lightweight enough that this is negligible. But if you're running many small tasks in a resource-constrained environment, the overhead becomes meaningful.

When designing your task, allocate enough memory for both your application and the log router. AWS recommends a minimum of 512 MB for the log router, though less can work depending on your log volume and throughput. Monitor your log router container's resource utilization in CloudWatch Container Insights to ensure it's not becoming a bottleneck.

Also consider the network overhead. If your third-party logging platform is outside AWS, you're egressing logs from your VPC, which incurs data transfer costs. For high-volume logging workloads, this can become significant, so it's worth calculating the cost impact before committing to a particular architecture.

### Container Insights: Comprehensive Metrics and Logs

While CloudWatch Logs captures your application's output, Container Insights provides a broader observability picture: metrics from your ECS tasks, container instances, and services. It's CloudWatch's native way of giving you visibility into the health and performance of your containerized workloads.

#### What Container Insights Collects

Container Insights automatically collects metrics from your ECS cluster, including CPU and memory utilization at the task and container level, network I/O, and storage metrics. It also aggregates these metrics to give you service-level and cluster-level views. This is invaluable for understanding how your workload is performing and identifying resource contention or poorly sized tasks.

Enabling Container Insights is straightforward. For ECS on EC2, you install the CloudWatch agent on your container instances. For ECS on Fargate, AWS manages this for you—you simply enable the setting in your task definition.

To enable Container Insights on Fargate, add this to your task definition:

```json
{
  "family": "my-application",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "my-app:latest"
    }
  ]
}
```

Container Insights on Fargate is enabled at the cluster level. When you create or update your ECS cluster, you have the option to enable Container Insights for all tasks launched in that cluster:

```bash
aws ecs put-cluster-settings \
  --cluster my-cluster \
  --settings name=containerInsights,value=enabled
```

Once enabled, metrics flow automatically into CloudWatch. You can view them in the CloudWatch console under the Container Insights section, or query them programmatically via the CloudWatch Metrics API.

#### Cost Implications of Container Insights

It's important to understand that Container Insights has a cost. You pay per task instance that contributes metrics. The cost is modest—as of recent pricing, it's roughly $0.30 per task per month for Fargate—but at scale it compounds. If you're running 100 tasks continuously, that's $30 per month just for metrics, on top of your compute costs.

For most teams, Container Insights is worth the cost because the observability it provides helps you optimize resource allocation and catch performance issues early. But if you're in a cost-sensitive environment or running many low-criticality workloads, you might selectively enable Container Insights only for production tasks or critical services.

#### Using Container Insights with Logs

Container Insights metrics are most powerful when correlated with your application logs. CloudWatch makes this easy by allowing you to create dashboards that bring together metrics and log insights queries. You might create a dashboard showing CPU utilization alongside log error rates, allowing you to see whether a spike in errors correlates with resource contention.

CloudWatch Logs Insights, in particular, is a powerful tool for analyzing logs at scale. You can write queries like:

```
fields @timestamp, @message, @duration
| filter @message like /ERROR/
| stats count() as error_count by bin(5m)
```

This query finds all log entries containing "ERROR," groups them into 5-minute windows, and counts them over time. Paired with Container Insights metrics, this gives you a comprehensive view of what's happening in your workload.

### Designing a Complete Logging Strategy

In practice, many teams use both CloudWatch Logs (via awslogs or FireLens) and Container Insights together. Here's how a mature logging strategy might look:

**For operational troubleshooting**: Use CloudWatch Logs with the awslogs driver. Application logs are cheap to store in CloudWatch, and when you need to debug a specific issue, you can tail logs in real time or search through them with Logs Insights. This is your primary source of truth for application behavior.

**For third-party integration**: If you already have a Datadog, Splunk, or similar setup, use FireLens to route logs there. This avoids vendor lock-in and lets you leverage existing investment in monitoring and alerting infrastructure.

**For infrastructure observability**: Enable Container Insights to monitor task and cluster health. Use Container Insights to detect resource bottlenecks, failed task launches, and performance regressions. Correlate Container Insights metrics with application logs to understand root causes.

**For long-term retention**: Set CloudWatch Logs retention to match your operational needs (typically 7–30 days), then export older logs to S3 for archival. This balances query speed for recent logs with cost efficiency for historical data.

### Cost Optimization Strategies

Logging costs can grow quickly if not managed intentionally. Here are practical strategies to keep costs reasonable:

**Set aggressive retention policies**. The largest component of logging costs is storage. Setting retention to 7 or 14 days instead of 90 days can cut costs dramatically. For compliance requirements, export logs to S3 and use S3 Glacier for long-term storage—it's far cheaper than CloudWatch Logs.

**Use log filtering**. If your application generates verbose DEBUG-level logs, consider filtering them out before they reach CloudWatch. You can do this at the application level (only log at INFO level in production) or with Fluent Bit filters (if using FireLens).

**Right-size your tasks**. Larger tasks produce more logs. If you're running tasks with excessive resource allocation, consolidating workloads or scaling down can reduce log volume.

**Monitor your log group sizes**. Use CloudWatch Logs Insights to find which log groups are consuming the most space. You might discover that a particular service is logging excessively, giving you a target for optimization.

**Consider sampling for low-value logs**. If you're logging high-frequency events (like every HTTP request), consider sampling—logging only 10% or 1% of events—to reduce volume while maintaining visibility into patterns.

### Troubleshooting Common Logging Issues

Even with careful configuration, logging issues can arise. Here are the most common problems and how to solve them:

**Task starts but no logs appear**: Check that the task execution role has the required CloudWatch Logs permissions. Verify that the log group exists. If using FireLens, check that the log router container is running (it should appear in the ECS task details).

**Logs appear but are incomplete**: This might indicate that the container crashed before all logs flushed. With awslogs, there can be a slight delay between log events and their appearance in CloudWatch. Verify that your container has time to shut down gracefully, allowing the logging driver to flush buffered events.

**High costs for logging**: Audit your log group retention settings. Use CloudWatch Logs Insights to identify which services are producing the most logs. Consider implementing log filtering to reduce noise.

**FireLens logs not reaching third-party platform**: Verify that the log router container has network connectivity to your platform (check security groups and VPC routing). Ensure that API keys and credentials are correct and haven't expired. Check the log router's own logs in CloudWatch—Fluent Bit logs errors there when unable to deliver to the remote service.

### Conclusion

Effective logging is one of the cornerstones of reliable, observable ECS workloads. Whether you opt for the simplicity of CloudWatch Logs with awslogs, the flexibility of FireLens for third-party platforms, or the comprehensive observability of Container Insights, the key is to choose a strategy that matches your operational needs and budget.

Start simple—use awslogs to capture container output and Container Insights to monitor infrastructure health. As your workload matures and your observability needs evolve, you can layer on additional tools like FireLens or invest in more sophisticated log analysis. The important thing is to capture logs reliably, make them queryable, and use them to understand and improve your system.

Remember that logging is not a one-time configuration but an ongoing practice. Regularly review your retention policies, audit your costs, and adjust your strategy as your workload changes. With a thoughtful approach to logging, you'll spend less time firefighting in the dark and more time understanding your systems deeply.
