---
title: "Sending Custom CloudWatch Metrics to Drive ASG Scaling"
---

## Sending Custom CloudWatch Metrics to Drive ASG Scaling

When you're managing applications on AWS, CPU utilization feels like the obvious scaling metric. It's simple, built-in, and requires no extra work. But CPU-based scaling often tells only part of the story. What if your application is I/O-bound? What if you need to scale based on application queue depth, the number of pending jobs, or some business-specific metric that has nothing to do with processor load? This is where custom CloudWatch metrics shine, unlocking scaling policies that actually reflect how your application works.

Auto Scaling Groups (ASGs) become far more powerful when you feed them metrics that matter to your application logic. Instead of waiting for CPU to spike—a lagging indicator that your system is already struggling—you can scale proactively based on work queued up and waiting to be processed. This guide walks you through the mechanics of publishing custom metrics, building scaling policies around them, and implementing real-world patterns that handle queue-based and request-driven workloads.

### Understanding Custom Metrics and Why They Matter

CloudWatch comes with a set of standard metrics out of the box: EC2 CPU utilization, network throughput, disk reads and writes. These are useful, but they're generic. They don't understand your application. Your application might be processing jobs from an SQS queue, serving API requests with highly variable response times, or managing a batch processing pipeline where queue depth is the truest signal of system load.

Custom metrics let you define and publish any measurement that matters to your business logic. You might publish metrics like jobs per second, queue depth per instance, request latency percentiles, or database connection pool exhaustion. Once published to CloudWatch, these metrics become first-class citizens that can drive scaling decisions through target tracking policies.

The power of this approach becomes obvious when you consider a concrete scenario: an ASG running workers that pull messages from an SQS queue. If you scale based on CPU, you might have instances running at 5% CPU with thousands of messages piling up in the queue—a clear mismatch. If you scale based on queue depth per instance, you maintain a target ratio of messages to workers, ensuring the queue drains at a consistent rate. This is more predictable, more efficient, and maps directly to your operational goals.

### Publishing Custom Metrics from Your Application

Getting metrics into CloudWatch starts with the PutMetricData API call. This operation accepts a metric name, a timestamp, a value, and optional dimensions that add context to the measurement. You can publish metrics from EC2 instances, Lambda functions, on-premises servers, or any application with AWS API credentials.

The most straightforward approach is to publish metrics directly from your application code. Imagine you have a worker application running on EC2 instances that processes jobs from a queue. You might want to track how many jobs are currently being processed on each instance. Here's a Python example using the boto3 SDK:

```python
import boto3
from datetime import datetime

cloudwatch = boto3.client('cloudwatch')

def publish_queue_depth_metric(depth_per_instance):
    cloudwatch.put_metric_data(
        Namespace='MyApplication',
        MetricData=[
            {
                'MetricName': 'JobsPerInstance',
                'Value': depth_per_instance,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow(),
                'Dimensions': [
                    {
                        'Name': 'InstanceId',
                        'Value': ec2_instance_id
                    },
                    {
                        'Name': 'Environment',
                        'Value': 'production'
                    }
                ]
            }
        ]
    )
```

The Namespace acts as a container for related metrics, much like a folder. Using something like `MyApplication` keeps your custom metrics organized and separate from AWS service metrics. Dimensions add granularity; they're key-value pairs that let you slice and dice metrics later. In the example above, InstanceId and Environment are dimensions that let you filter metrics by instance or environment.

The Unit field is optional but valuable for operational clarity—using 'Count', 'Seconds', or 'Percent' helps CloudWatch display metrics with correct labeling and makes the data more interpretable in dashboards. The Timestamp should generally be the current time or very close to it; CloudWatch will use the current time if you omit it.

Publishing metrics at regular intervals is crucial. Most applications publish metrics every minute or every few minutes. This cadence balances granularity with API costs—remember that custom metrics incur charges based on the number of put operations and the number of dimensions. A common pattern is to batch multiple metrics into a single PutMetricData call to reduce API overhead.

### Leveraging Lambda for Metric Publication

Sometimes it makes more sense to publish metrics from outside the application itself. Suppose you want to monitor SQS queue depth and scale based on that, but you don't want to modify your worker code. A Lambda function can periodically fetch the queue depth and publish it as a metric.

Lambda functions are particularly useful for this because they're event-driven and can be invoked by CloudWatch Events (now called EventBridge) on a schedule. You might run a Lambda every minute to pull queue statistics and publish them to CloudWatch:

```python
import boto3
from datetime import datetime

sqs = boto3.client('sqs')
cloudwatch = boto3.client('cloudwatch')

def lambda_handler(event, context):
    queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/MyQueue'
    
    # Get queue attributes
    response = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=['ApproximateNumberOfMessages']
    )
    
    queue_depth = int(response['Attributes']['ApproximateNumberOfMessages'])
    
    # Publish to CloudWatch
    cloudwatch.put_metric_data(
        Namespace='MyApplication',
        MetricData=[
            {
                'MetricName': 'SQSQueueDepth',
                'Value': queue_depth,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow()
            }
        ]
    )
    
    return {'statusCode': 200}
```

This pattern works well for metrics that aggregate across multiple instances or that come from AWS services. The advantage is clear separation of concerns: your application focuses on processing work, while monitoring infrastructure handles metrics collection.

### Building Target Tracking Policies on Custom Metrics

Once you're publishing custom metrics, the next step is configuring your ASG to scale based on them. AWS Auto Scaling supports target tracking policies, which automatically adjust the desired capacity to keep a metric close to a target value. This is simpler and more elegant than manually defining step policies.

To create a target tracking policy, you need three pieces of information: the metric namespace, the metric name, and a target value. Let's say you've been publishing a metric called JobsPerInstance in the MyApplication namespace, and you want to maintain a target of 10 jobs per instance. You can create this policy via the AWS CLI:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-worker-asg \
  --policy-name target-tracking-jobs \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "TargetValue": 10.0,
    "CustomizedMetricSpecification": {
      "MetricName": "JobsPerInstance",
      "Namespace": "MyApplication",
      "Statistic": "Average"
    },
    "ScaleOutCooldown": 300,
    "ScaleInCooldown": 600
  }'
```

The CustomizedMetricSpecification tells Auto Scaling which metric to track. The Statistic field determines how CloudWatch aggregates the metric—Average, Sum, Maximum, and Minimum are all valid options. Most of the time, Average makes sense because you want the mean load across instances.

The ScaleOutCooldown and ScaleInCooldown values control how quickly the ASG responds to changes. ScaleOutCooldown (scaling up) is typically shorter than ScaleInCooldown (scaling down) because you want to respond quickly to increasing load but avoid thrashing when load fluctuates. A scale-out cooldown of 300 seconds and scale-in cooldown of 600 seconds is a reasonable starting point.

Target tracking policies automatically calculate the desired capacity based on the gap between your target and the current metric value. If your target is 10 jobs per instance and you have 5 instances processing 75 jobs total (15 per instance on average), the policy will scale up. The exact scaling behavior is determined by AWS's scaling algorithm, which aims to reach the target smoothly without wild swings.

### The SQS Queue Depth Pattern

One of the most common and powerful patterns for ASG scaling is the queue depth approach. Many applications follow a producer-consumer model where work is queued in SQS and workers pull items from the queue. Scaling based on queue depth per worker is intuitive and effective.

The metric you want to track is approximately the SQS ApproximateNumberOfMessagesVisible divided by the current instance count. However, since you need this as a single metric that ASG can track, you must calculate and publish it yourself. Here's a Lambda function that does this:

```python
import boto3
from datetime import datetime

sqs = boto3.client('sqs')
cloudwatch = boto3.client('cloudwatch')
autoscaling = boto3.client('autoscaling')

def lambda_handler(event, context):
    queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/MyQueue'
    asg_name = 'my-worker-asg'
    
    # Get queue depth
    queue_attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=['ApproximateNumberOfMessages']
    )
    queue_depth = int(queue_attrs['Attributes']['ApproximateNumberOfMessages'])
    
    # Get current instance count
    asg_response = autoscaling.describe_auto_scaling_groups(
        AutoScalingGroupNames=[asg_name]
    )
    instance_count = len(asg_response['AutoScalingGroups'][0]['Instances'])
    
    # Avoid division by zero
    if instance_count == 0:
        instance_count = 1
    
    messages_per_instance = queue_depth / instance_count
    
    # Publish metric
    cloudwatch.put_metric_data(
        Namespace='MyApplication',
        MetricData=[
            {
                'MetricName': 'SQSMessagesPerInstance',
                'Value': messages_per_instance,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow()
            }
        ]
    )
    
    return {'statusCode': 200}
```

Then you create a target tracking policy targeting this metric. If you want to maintain 5 messages per worker, your target value would be 5. The ASG will scale up when the metric exceeds 5 and scale down when it drops below 5, automatically adjusting capacity to match the queue depth.

The beauty of this pattern is that it decouples scaling from internal application metrics. Your workers don't need to publish anything; they just process messages. The monitoring infrastructure observes the queue and scales the fleet accordingly. This is particularly valuable when you're adding monitoring to an existing application without modifying its code.

### Designing Metrics with Dimensions and Namespaces

As your custom metrics grow, organizing them becomes important. Namespaces and dimensions are your tools for this.

Namespaces are top-level containers. You might use `MyApplication/Production` for production metrics, `MyApplication/Development` for development metrics, and `MyApplication/DataPipeline` for batch processing metrics. This organization prevents naming collisions and makes it easy to find related metrics in the CloudWatch console.

Dimensions are key-value pairs attached to each metric that add context. If you're running multiple instances and want to track per-instance metrics, include an InstanceId dimension. If you're serving multiple tenants, include a TenantId dimension. If you're running in multiple regions, include a Region dimension. Dimensions let you filter and aggregate metrics in different ways without duplicating data.

However, there's a cost consideration: dimensions increase the storage and query cost of your metrics. Using many dimensions is fine if you need that granularity, but it's worth thinking about. For example, if you publish a metric with five dimensions, that's effectively five different metrics for billing purposes.

When designing dimensions for ASG scaling, keep it simple. The most common pattern is to omit dimensions altogether when publishing aggregated metrics that already account for all instances. If you do include dimensions, use only those that are essential for understanding the metric or that you'll use for filtering.

### Metric Resolution and Frequency

CloudWatch supports two metric resolutions: standard (1-minute) and high-resolution (1-second to 60-second). Standard resolution is the default and is free (well, included in your AWS bill). High-resolution metrics cost more, so use them only when you need real-time scaling responses.

For most ASG scaling scenarios, 1-minute resolution is perfectly adequate. Your Lambda function publishes metrics every 1 minute, the ASG evaluates scaling policies every 1-2 minutes, and the cooldown prevents frequent scaling anyway. Going to 10-second or 30-second resolution gives you faster response times but adds cost and doesn't always improve outcomes—faster scaling can lead to unnecessary fleet churn.

The frequency of metric publication should match your application's characteristics. If your queue depth fluctuates rapidly, publish metrics every minute to capture these changes. If your metrics are stable, you might publish every 5 minutes. The tradeoff is between responsiveness and API costs. Keep in mind that CloudWatch API calls are throttled and have costs, so publishing more frequently than necessary wastes both.

When configuring your target tracking policy, be aware that it evaluates metrics over a period (usually 1-5 minutes) to smooth out noise. This means small, transient spikes won't trigger scaling immediately, which is generally desirable because it prevents overreacting to momentary load variations.

### Best Practices for Reliable Custom Metrics

Building a robust custom metrics system requires attention to a few operational details.

First, ensure your metric publishing code is resilient. If the CloudWatch API call fails, don't let it crash your application or Lambda function. Wrap PutMetricData calls in try-catch blocks and log failures, but allow your main application to continue. Publishing metrics is observability, not core functionality.

Second, include safeguards against edge cases. If you're calculating messages per instance, ensure your code doesn't divide by zero if the ASG temporarily has no instances. If you're reading from a DynamoDB table or making external API calls to gather metric data, implement timeouts and fallback values so metric publishing doesn't hang indefinitely.

Third, be consistent with metric names, namespaces, and dimension names. If you publish 'JobsPerInstance' one minute and 'JobPerInstance' the next, CloudWatch treats these as separate metrics. Use lowercase with camelCase or underscores for consistency, and document your metric naming scheme so teammates understand what's available.

Fourth, monitor your custom metrics themselves. Set up CloudWatch alarms to alert you if metrics stop being published. An alarm that fires when a metric hasn't been received in 5 minutes can catch problems early—misconfigured credentials, Lambda execution failures, or network issues that break metric publishing. Without this meta-monitoring, you might have silently broken scaling without realizing it.

Fifth, test your scaling policies in a non-production environment first. Spin up a test ASG with reduced capacity limits and load-test it. Verify that the policy scales up when metrics exceed your target and scales down as expected. Scaling policies interact with cooldowns and minimum/maximum capacity constraints in ways that can surprise you, so empirical testing is valuable.

### Combining Custom Metrics with Other Scaling Policies

Your ASG doesn't need to rely on a single scaling policy. You can combine target tracking policies, step policies, and simple scaling policies to create nuanced scaling behavior.

For example, you might have a target tracking policy that keeps messages per instance at 10 under normal conditions, but also a step policy that triggers immediate scaling if queue depth exceeds 1000 messages (indicating a potential problem). The step policy acts as a safety valve, ensuring rapid response to extreme conditions while the target tracking policy handles routine load balancing.

Combining policies requires care to avoid conflicts. If you have two policies that both scale up, AWS will honor the policy that results in the larger scaling action. If they conflict on scale-down, AWS applies a conservative approach and scales down less aggressively. Understanding this helps you design policies that work together rather than against each other.

### Monitoring Scaling Behavior and Iterating

Once your scaling policies are live, monitor them. CloudWatch has a useful metric for this: it automatically tracks the desired capacity and actual instance count for your ASG. Create a dashboard showing your custom metric alongside the ASG capacity, so you can see the correlation. This helps you validate that scaling is responding appropriately.

Look for patterns in your metrics. Do they spike at predictable times? Is there a lag between when queue depth increases and when instances scale up? Is your scale-down cooldown too long, causing instances to linger after load drops? These observations let you fine-tune your target values and cooldowns over time.

Don't be afraid to iterate. If your target of 10 jobs per instance results in instances running at 90% utilization (close to capacity), lower your target to 8 so you have more headroom. If scaling up is too slow, reduce the scale-out cooldown. If scaling down is too aggressive and causes thrashing, increase the scale-in cooldown. These adjustments are risk-free and can be made without downtime.

### Security and IAM Considerations

Publishing custom metrics requires IAM permissions. Your EC2 instances or Lambda functions need the cloudwatch:PutMetricData permission. Your Lambda functions also need autoscaling:DescribeAutoScalingGroups if they're calculating messages per instance, and sqs:GetQueueAttributes if they're reading queue depth.

Use least privilege: grant only the specific permissions needed. If your worker application publishes metrics from EC2, attach an IAM role with just PutMetricData. If your Lambda function calculates aggregated metrics, its role should have the specific SQS and AutoScaling permissions it actually uses.

Be cautious about metric dimension values. If you're using customer IDs or sensitive information as dimension values, remember that dimensions are visible in CloudWatch dashboards and alarms, and they're included in metric data that can be queried via APIs. For sensitive data, consider whether a dimension is truly necessary, or use hashed or anonymized values instead.

### Real-World Example: Scaling a Data Processing Fleet

Let's tie everything together with a concrete scenario. You're running a data processing application where jobs come in from various sources. A Lambda function fans these into an SQS queue. A fleet of EC2 instances running in an ASG pulls jobs from the queue, processes them, and stores results in S3.

Your instances are compute-optimized and handle approximately 5 jobs per minute. A job typically takes 10-15 seconds to complete. You want to ensure that jobs don't back up in the queue while also avoiding unnecessary instances when load is light.

First, you set up a Lambda function (invoked by EventBridge every minute) that reads the queue depth and current instance count, then publishes SQSJobsPerInstance. You set the target to 15, meaning you want to maintain a ratio where if 150 jobs are queued and you have 10 instances, that's 15 jobs per instance, which should drain in about 3 minutes.

You create a target tracking scaling policy with a target value of 15. You set ScaleOutCooldown to 60 seconds and ScaleInCooldown to 300 seconds, so the fleet responds quickly to spikes but doesn't scale down instantly when load temporarily dips.

You also set up a step scaling policy as a safety valve: if queue depth exceeds 500 jobs (regardless of instance count), immediately add 5 instances. This catches situations where the queue suddenly explodes faster than the target tracking policy can respond.

You monitor the scaling behavior in a CloudWatch dashboard showing queue depth, jobs per instance, and desired capacity over time. After a week of production load, you see that the fleet is scaling appropriately but instances are sitting at 60% utilization during normal hours. You decide to increase your target from 15 to 18 jobs per instance, using the available capacity more efficiently without hurting response times.

Three months later, you've collected enough data to understand the distribution of job sizes, the impact of cold starts, and the optimal scaling parameters. Your system now scales predictably and costs are minimized because you're not keeping excess capacity idle.

### Conclusion

Custom CloudWatch metrics transform your ASG from a reactive, CPU-based scaling mechanism into a proactive, application-aware scaling system. By publishing metrics that reflect your actual workload—queue depth, request backlog, or business-specific measurements—you align infrastructure scaling with operational reality.

The pattern is straightforward: identify a metric that drives your application's load, publish it regularly to CloudWatch using PutMetricData, and build a target tracking policy around it. Whether you publish from your application code, a Lambda function, or a scheduled script, the result is the same: your infrastructure scales intelligently based on what actually matters.

Start small. Pick one custom metric and one scaling policy. Monitor it, verify it works as expected, then expand to additional metrics and policies as your confidence grows. Over time, this approach lets you build highly efficient, responsive systems that cost less and perform better than those relying on generic metrics alone.
