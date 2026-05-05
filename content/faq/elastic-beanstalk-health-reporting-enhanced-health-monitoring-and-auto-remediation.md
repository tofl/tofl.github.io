---
title: "Elastic Beanstalk Health Reporting: Enhanced Health Monitoring and Auto Remediation"
---

## Elastic Beanstalk Health Reporting: Enhanced Health Monitoring and Auto Remediation

When you deploy an application to AWS Elastic Beanstalk, you're not just launching compute instances—you're gaining access to a sophisticated health monitoring system that can help you catch and resolve production issues before your users notice them. Yet many developers rely on basic health checks without realizing that Elastic Beanstalk offers a far richer view into application behavior through its enhanced health reporting system. Understanding the difference between basic and enhanced health monitoring, and knowing how to interpret the metrics they provide, is essential for building reliable applications on Beanstalk.

The health of your Elastic Beanstalk environment isn't a binary state—it's a multidimensional picture that becomes exponentially more useful once you know where to look. This article explores how Elastic Beanstalk's two health monitoring modes work, what they reveal about your application, and how to use that information to set up automated remediation and effective alarms.

### The Fundamentals: Why Application Health Matters

Before diving into the mechanics of health reporting, let's establish why this matters. In a traditional setup where you manually manage EC2 instances, you might write scripts to check whether your application responds to HTTP requests, monitor CPU usage, and parse application logs for errors. Elastic Beanstalk abstracts away much of that operational toil by providing built-in health monitoring, but only if you configure it properly.

A health reporting system serves several critical functions. First, it gives you visibility into whether your application is actually working—not just whether the underlying infrastructure is running. Second, it provides the foundation for automatic remediation: Beanstalk can terminate unhealthy instances and replace them without any intervention from you. Third, it generates the metrics you need to set up CloudWatch alarms that wake you up at 3 AM only when something is genuinely wrong, rather than on every minor fluctuation.

The challenge is that not all health information is equally useful. You need to understand what each monitoring mode reveals, and crucially, what it hides.

### Basic Health Mode: The Foundation

Elastic Beanstalk's default health monitoring approach, called basic health mode, relies on the Elastic Load Balancer (ELB) that fronts your environment. When you enable basic health, Beanstalk configures the load balancer to periodically send HTTP requests to each instance and observe the responses. If an instance responds successfully, it's considered healthy. If it doesn't respond or returns an error, it's marked unhealthy.

This is straightforward and requires no additional setup beyond specifying a health check URL in your Beanstalk configuration. The load balancer might check `http://your-instance:80/` every 30 seconds, for example, and expect a 2xx or 3xx HTTP status code within a reasonable timeout period.

The appeal of basic health monitoring is simplicity. It works out of the box, requires minimal configuration, and gives you a simple True/False picture of whether each instance can handle HTTP requests. However, this simplicity comes with significant blind spots. Basic health tells you whether an instance is responding to requests, but it doesn't tell you how *fast* those requests are being answered, whether the application is consuming excessive memory, whether certain endpoints are failing while others succeed, or whether an instance is degrading gradually before it finally crashes.

In practice, basic health mode is sufficient for very simple applications with no backend dependencies and forgiving error rates. For anything more complex—which describes most production applications—basic health is a starting point, not a destination.

### Enhanced Health Mode: Detailed Application Insights

Enhanced health reporting bridges the gap between basic health's simplicity and the operational complexity of modern applications. When you enable enhanced health mode, Beanstalk deploys a lightweight monitoring agent to every instance in your environment. This agent collects detailed metrics about the application's behavior and reports them to CloudWatch at regular intervals, typically every 10 to 15 seconds.

The agent doesn't replace the load balancer health checks; rather, it complements them by providing a richer picture of what's actually happening on each instance. Here's what enhanced health reveals that basic health cannot:

**Request latency per instance**: The agent measures how long it takes each instance to respond to requests and reports percentiles. This is invaluable for detecting performance degradation. You might notice that one instance is responding in 100ms while others respond in 20ms—a sign that something on that instance is consuming resources or that it's running an old version of your code.

**HTTP response code distribution**: Instead of just tracking whether an instance is "up" or "down," enhanced health tells you what percentage of requests resulted in 2xx, 4xx, 5xx, and other response codes. This reveals systematic issues that basic health would miss. For instance, if 20% of an instance's requests are returning 500 errors while others return 200, basic health might still consider it healthy, but enhanced health metrics would flag the problem.

**Instance-level CPU and memory utilization**: When the CloudWatch agent is installed (which happens automatically with enhanced health), Elastic Beanstalk has visibility into each instance's CPU and memory consumption. This is critical for capacity planning and for detecting resource leaks in your application.

**The operating system and platform metrics**: Beyond the application, the agent reports on swap usage, inode usage, and other operating system metrics that can indicate problems before they become catastrophic.

The catch is that enhanced health requires an agent to run on every instance, which adds minimal overhead but does require a slightly larger instance footprint and introduces one more component that could theoretically fail. In practice, this is rarely a concern—the Elastic Beanstalk agent is part of the standard platform and is battle-tested across millions of instances.

### Enabling Enhanced Health Reporting

Switching from basic to enhanced health reporting is remarkably straightforward, though the exact steps depend on whether you're configuring a new environment or modifying an existing one.

For a new environment, you can enable enhanced health through the Elastic Beanstalk console by navigating to the "Health reporting system" option and selecting "Enhanced." Alternatively, you can set it in your environment configuration file, typically `.ebextensions/01_env.config`:

```yaml
option_settings:
  aws:elasticbeanstalk:healthreporting:system:
    SystemType: Enhanced
```

For an existing environment, you'll use the console or the AWS CLI. Via the CLI, it looks like this:

```bash
aws elasticbeanstalk update-environment \
  --environment-name my-environment \
  --option-settings \
    Namespace=aws:elasticbeanstalk:healthreporting:system,OptionName=SystemType,Value=Enhanced
```

Once you've made this change, the Elastic Beanstalk platform will begin rolling the monitoring agent out to instances. There's no downtime, and the process typically completes within a few minutes for small environments. Within moments of the agent starting, you'll begin seeing enhanced health metrics in the Elastic Beanstalk console and in CloudWatch.

### Interpreting the Enhanced Health Dashboard

Once enhanced health is enabled, the Elastic Beanstalk console displays a much richer dashboard. Instead of simply seeing "2 healthy, 1 unhealthy," you see a breakdown of request rates, latency percentiles, error rates, and resource utilization across your environment.

The dashboard typically shows metrics like requests per second, average response time, HTTP response code distribution, and instance-level metrics like CPU and memory. Each instance is listed with its own detailed metrics, making it easy to spot outliers. If you're running five identical instances and one is consistently slower or returning more errors, enhanced health will make that obvious immediately.

The health status of the environment itself is determined by a combination of these metrics. Elastic Beanstalk evaluates not just whether instances are responding, but whether the responses are timely and successful. An instance might be marked as "Degraded" if it's responding to requests but slowly, or if it's returning a high percentage of errors.

This nuance is powerful because it prevents false negatives. A system that's technically alive but performing terribly is arguably less useful than a system that fails clearly and triggers remediation. Enhanced health helps you identify and respond to these twilight-zone scenarios.

### Enhanced Health and Auto Remediation

The true power of enhanced health emerges when you combine it with Elastic Beanstalk's auto remediation capabilities. When basic health is enabled, Beanstalk will terminate and replace instances that fail health checks, but the definition of "failure" is relatively crude. With enhanced health, you have much finer control over what constitutes a failure worthy of remediation.

You can configure Elastic Beanstalk to automatically terminate instances that are consistently returning high error rates, responding slowly, or consuming excessive CPU or memory. The rationale is compelling: if an instance is degraded enough that you'd want to manually replace it anyway, why wait for manual intervention? Let Beanstalk handle it automatically during off-peak hours or immediately, depending on your configuration.

Auto remediation is controlled through environment configuration options. For instance, you might tell Beanstalk to terminate an instance if its average response time exceeds 1 second, or if more than 10% of its responses are 5xx errors. These thresholds are specific to your application and traffic patterns, which is precisely why enhanced health metrics are so valuable—they give you the granular data you need to set intelligent thresholds.

To configure auto remediation, you'd update your environment configuration:

```yaml
option_settings:
  aws:elasticbeanstalk:application:
    Application Healthcheck URL: /health
  aws:elasticbeanstalk:environment:
    EnhancedHealthAuthEnabled: true
  aws:elasticbeanstalk:healthreporting:system:
    SystemType: Enhanced
    EnhancedHealthAuthEnabled: true
```

Beyond these basic settings, you'll define thresholds through CloudWatch alarms, which we'll cover in the next section. The key insight is that enhanced health provides the data, but you—the developer—decide what should trigger action.

### Setting Up CloudWatch Alarms on Enhanced Health Metrics

Enhanced health metrics flow into CloudWatch, where you can create alarms that trigger automated actions or notify you of problems. This is where the real operational power lies.

CloudWatch alarms on enhanced health metrics can trigger SNS notifications (which might page you), invoke Lambda functions, or instruct an Auto Scaling group to add or remove instances. For Elastic Beanstalk environments that use Auto Scaling, you might create an alarm that scales up when average latency exceeds a threshold, or scales down when it's consistently low.

Let's walk through a practical example. Suppose you want to be alerted if the average response latency across your environment exceeds 500ms. You'd create a CloudWatch alarm on the `TargetResponseTime` metric:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name high-latency-alert \
  --alarm-description "Alert if response latency exceeds 500ms" \
  --metric-name TargetResponseTime \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 60 \
  --threshold 0.5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:ops-alerts
```

This alarm will trigger an SNS notification if latency exceeds 500ms for two consecutive one-minute periods. You could set a lower threshold for critical systems or a higher one for less sensitive applications.

More sophisticated setups use alarms to trigger remediation. You might create an alarm that monitors the percentage of 5xx errors returned by your environment and invokes a Lambda function that automatically triggers a deployment rollback if the error rate spikes unexpectedly. Or you might create an alarm on CPU utilization that scales up your Auto Scaling group when resource consumption gets too high.

The metrics available for alarms include everything the enhanced health agent reports: instance-level latency, error rates, CPU, memory, and more. The Elastic Beanstalk console and the CloudWatch console both provide interfaces for browsing available metrics and creating alarms.

### Practical Scenario: Diagnosing a Production Issue

To ground this discussion in reality, let's walk through a concrete scenario. Your e-commerce platform is experiencing elevated latency during peak hours. Users are complaining that checkout is slow. Your team is paged at midnight.

With basic health monitoring, you'd see that the environment is "healthy"—all instances are responding to requests. You'd have to manually SSH into instances, run profiling tools, check application logs, and piece together what's happening. This could take 30 minutes or more.

With enhanced health monitoring, you'd immediately see that one of your five instances is responding in 2.5 seconds on average while others respond in 300ms. You'd see that this instance's CPU is pegged at 95%, while others are at 30%. You'd see that this instance is returning 20% 5xx errors. Within seconds, you'd know that something is wrong with a specific instance.

Your next step might be to check the application logs on that instance to see what's consuming CPU, or you might simply trigger a remediation—terminate this instance and let Elastic Beanstalk replace it. By the time you've diagnosed the problem, it's likely already solved, and you can investigate the root cause during business hours.

This is the operational difference that enhanced health provides. It transforms troubleshooting from a detective game into a guided process.

### Choosing Between Basic and Enhanced: Considerations

While enhanced health is clearly superior for production applications, it's not without trade-offs. The agent adds a small amount of memory and CPU overhead, though this is typically negligible. More significantly, you're adding a dependency on the Elastic Beanstalk monitoring infrastructure—if the agent fails or isn't updated promptly, you lose enhanced visibility.

For simple, non-critical applications, basic health might be sufficient. For anything customer-facing or business-critical, enhanced health is a no-brainer investment. The operational visibility it provides typically pays for itself within days through faster incident response and fewer false alarms.

You should also consider your environment's complexity. If you're running a single-tier application with no database dependencies, basic health might be adequate. If you're running a distributed system with multiple tiers, databases, caches, and external services, enhanced health becomes essential because you need visibility into how well each tier is performing.

### The Agent and Troubleshooting

The Elastic Beanstalk monitoring agent typically runs without issues, but it's worth understanding how to troubleshoot if something goes wrong. The agent logs its activity to files on the instance, which you can inspect if you SSH in for investigation.

If enhanced health metrics stop appearing in CloudWatch, first check that the agent process is running. If it's not, it may have crashed due to insufficient memory or disk space. You can check the agent's status through the Elastic Beanstalk platform logs, which are available through the console or via the CLI.

In rare cases, you might encounter a situation where the agent's presence is causing problems—perhaps it's generating unexpected load or interfering with your application's monitoring. You can temporarily disable it through the environment configuration, but this is rarely necessary and defeats the purpose of enhanced monitoring.

### Integration with Your Development Workflow

Enhanced health metrics should feed into your development and operations processes. During code reviews, consider whether your changes might impact latency or error rates. During deployments, monitor the enhanced health dashboard to ensure the new version behaves as expected.

Many teams integrate CloudWatch metrics into their dashboards and incident response workflows. Tools like Datadog, Splunk, or even custom Lambda functions can consume these metrics and provide richer context. For instance, you might create a dashboard that shows your application's enhanced health metrics alongside business metrics like conversion rate or checkout success rate, giving you a complete operational picture.

### Conclusion

Elastic Beanstalk's enhanced health reporting system transforms application monitoring from a binary "up or down" check into a detailed, multidimensional view of your application's behavior. By understanding the difference between basic and enhanced health, enabling enhanced health in your environments, and setting up CloudWatch alarms on the resulting metrics, you gain the visibility needed to operate reliable applications at scale.

The investment in configuring enhanced health is minimal—a few configuration changes—but the return is substantial. You'll catch problems faster, resolve them more automatically, and sleep better knowing that your platform is working hard to maintain its own health. In production environments, this isn't a luxury; it's a necessity.
