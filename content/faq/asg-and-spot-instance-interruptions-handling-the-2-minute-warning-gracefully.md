---
title: "ASG and Spot Instance Interruptions: Handling the 2-Minute Warning Gracefully"
---

## ASG and Spot Instance Interruptions: Handling the 2-Minute Warning Gracefully

When you run applications on AWS Spot instances, you get access to unused compute capacity at a steep discount—often 70 to 90 percent cheaper than On-Demand pricing. But that bargain comes with a tradeoff: AWS can reclaim Spot instances with just two minutes' notice when capacity is needed elsewhere. For many teams, this uncertainty feels too risky. Yet with the right architecture and a few AWS services working in concert, you can build Spot-based fleets that handle interruptions gracefully, drain in-flight requests cleanly, and maintain service availability. This article walks you through that journey.

### Why Spot Interruptions Matter

Spot instances are genuinely valuable for cost-sensitive workloads—batch processing, non-critical services, development environments, and even parts of production infrastructure. The challenge isn't that interruptions happen; it's that they can happen suddenly and without your direct control. When an interruption occurs, AWS gives your instance a notification via a special metadata endpoint, then two minutes later, the instance is forcibly stopped.

Without a strategy to handle this window, your in-flight requests get dropped, database connections are torn apart ungracefully, and users see errors. That's not just a bad experience—it can mean lost work, corrupted state, and a spike in operational alerts. The good news is that two minutes is enough time to do real work: drain connections, complete short-lived requests, update service registries, and initiate a graceful shutdown.

### How AWS Signals a Spot Interruption

AWS uses two complementary mechanisms to notify you of an impending interruption. Understanding both is essential to building a robust response.

The first mechanism is the EC2 Instance Metadata Service. Every EC2 instance can query its own metadata via an HTTP endpoint at `http://169.254.169.254/latest/meta-data/` and `http://169.254.169.254/latest/api/token`. When a Spot interruption is scheduled, a special metadata endpoint called the Spot Instance Interruption Notice becomes populated. Your code or a monitoring agent running on the instance can poll this endpoint periodically to check for an interruption notice. The notice includes the approximate time until termination, typically shown as "action": "terminate" and an "instance-action" field containing the notice.

The second mechanism is EventBridge, which AWS's own systems publish to on your behalf. When a Spot interruption is triggered, AWS publishes an event to the default EventBridge event bus. This event has a source of `aws.ec2` and a detail-type of `EC2 Instance State-change Notification` or the more specific `EC2 Spot Instance Interruption Warning`. This event is visible across your AWS account and can be routed to Lambda functions, SQS queues, SNS topics, or other targets. EventBridge offers a cleaner, more event-driven approach than polling the metadata endpoint, especially when you want to trigger actions outside the instance itself.

### The Auto Scaling Group Integration

An Auto Scaling Group (ASG) is the natural home for managing a fleet of Spot instances. An ASG monitors instance health, replaces failed instances, and scales up or down based on demand. However, an ASG's default behavior when an instance is terminated is simply to remove it and spin up a replacement. This doesn't give your application time to clean up.

This is where ASG lifecycle hooks enter the picture. A lifecycle hook pauses the termination process, giving your application a window to respond. When an instance is set to be terminated—whether due to a Spot interruption, manual termination, or scale-down—the ASG can pause the transition and send a notification to a target you specify. Your application then processes that notification, performs cleanup, and signals the lifecycle hook to proceed or abort.

To integrate Spot interruption handling into your ASG, you'll create a lifecycle hook that targets the `EC2_INSTANCE_TERMINATING` transition. When this hook is triggered, it sends a message to a queue or Lambda function. That consumer then coordinates the graceful shutdown of the instance.

### Combining EventBridge, Lifecycle Hooks, and SQS

The most robust pattern combines three elements: an EventBridge rule that catches the Spot interruption event, an ASG lifecycle hook that pauses termination, and an SQS queue that orchestrates the response.

Here's how it works in practice. First, you create an EventBridge rule that matches Spot Instance Interruption Warnings:

```json
{
  "Name": "spot-interruption-rule",
  "EventPattern": {
    "source": ["aws.ec2"],
    "detail-type": ["EC2 Spot Instance Interruption Warning"]
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:spot-interruption-queue",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeToSQSRole"
    }
  ]
}
```

This rule routes every Spot interruption notice to an SQS queue. Meanwhile, in your ASG configuration, you add a lifecycle hook:

```json
{
  "LifecycleHookName": "graceful-shutdown-hook",
  "AutoScalingGroupName": "my-spot-asg",
  "LifecycleTransition": "autoscaling:EC2_INSTANCE_TERMINATING",
  "DefaultResult": "CONTINUE",
  "HeartbeatTimeout": 300,
  "NotificationTargetARN": "arn:aws:sqs:us-east-1:123456789012:asg-termination-queue",
  "RoleARN": "arn:aws:iam::123456789012:role/ASGLifecycleRole"
}
```

This lifecycle hook pauses any instance termination for up to five minutes (the heartbeat timeout) and publishes a message to a separate SQS queue. Now you have two queues: one fed by EventBridge (proactive warning) and one fed by the ASG lifecycle hook (the actual termination event).

A Lambda function or long-running worker subscribes to both queues. When a message arrives on the EventBridge queue, it knows a Spot interruption is coming. It can then:

1. Deregister the instance from the load balancer to stop sending new requests.
2. Begin draining existing connections, either by signaling the application or by waiting for in-flight requests to complete.
3. Alert other services that this instance is going away (for example, updating a service registry).

When the actual termination message arrives on the lifecycle hook queue, your worker performs final cleanup—flushing logs, closing database connections—and then signals the lifecycle hook to proceed with termination.

### Building the Graceful Shutdown Worker

Let's look at a practical Lambda-based implementation. This function handles messages from both the EventBridge queue and the ASG lifecycle hook queue:

```python
import json
import boto3
import os
from datetime import datetime

autoscaling = boto3.client('autoscaling')
elb = boto3.client('elbv2')

def lambda_handler(event, context):
    # Parse the SQS message
    for record in event['Records']:
        body = json.loads(record['Sns']['Message'])
        
        # Determine if this is a Spot interruption warning or lifecycle hook
        if 'detail-type' in str(body) and 'Spot Instance Interruption' in str(body):
            handle_spot_warning(body)
        elif 'LifecycleHookName' in body:
            handle_lifecycle_termination(body)

def handle_spot_warning(event):
    """Called when we get a 2-minute warning from EventBridge."""
    instance_id = event['detail']['instance-id']
    print(f"Spot interruption warning for {instance_id}")
    
    # Deregister from load balancer
    deregister_instance(instance_id)
    
    # Signal the application to stop accepting new requests
    # This could be an HTTP call to the instance's local drain endpoint
    drain_connections(instance_id)

def handle_lifecycle_termination(event):
    """Called when ASG lifecycle hook triggers termination."""
    lifecycle_hook_name = event['LifecycleHookName']
    asg_name = event['AutoScalingGroupName']
    instance_id = event['EC2InstanceId']
    
    print(f"Lifecycle termination for {instance_id}")
    
    # Final cleanup
    cleanup_instance(instance_id)
    
    # Complete the lifecycle action
    autoscaling.complete_lifecycle_action(
        LifecycleHookName=lifecycle_hook_name,
        AutoScalingGroupName=asg_name,
        InstanceId=instance_id,
        LifecycleActionResult='CONTINUE'
    )

def deregister_instance(instance_id):
    """Remove instance from all load balancer target groups."""
    # Fetch target groups and deregister
    # (Implementation depends on ALB/NLB target group structure)
    pass

def drain_connections(instance_id):
    """Signal the instance to stop accepting new requests."""
    # For example, call a local HTTP endpoint on the instance
    # POST /shutdown/drain
    pass

def cleanup_instance(instance_id):
    """Perform final cleanup before termination."""
    # Close database connections, flush logs, etc.
    pass
```

This is a simplified example, but it illustrates the flow. In a real system, you'd add error handling, logging, and possibly retry logic. The key insight is that you have a synchronous window (from the EventBridge warning) and then a second window (from the lifecycle hook) to ensure everything is cleaned up before the instance is truly terminated.

### Capacity Rebalancing: Proactive Replacement

There's another powerful tool in the Spot interruption toolkit: capacity rebalancing. Instead of waiting for an interruption to happen, ASGs can proactively replace Spot instances when AWS signals that the instance might be at higher risk of interruption. This happens before the actual two-minute warning.

Capacity rebalancing is enabled on an ASG with a simple configuration. When enabled, the ASG listens for an `EC2 Spot Instance Interruption Warning` event and immediately launches a replacement instance. The old instance is given a termination notice, but the new one is already spinning up. By the time the old instance is terminated, traffic can begin flowing to the replacement.

To enable capacity rebalancing:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name my-spot-asg \
  --capacity-rebalance
```

Capacity rebalancing is particularly valuable for stateless services and batch workloads. For stateful applications, you still want the graceful shutdown patterns described earlier because capacity rebalancing alone doesn't drain connections—it just ensures a replacement is coming online.

### Handling Spot Interruption Metadata on the Instance

Some teams prefer to handle the interruption directly on the instance by polling the metadata endpoint. This approach is useful if you want the instance itself to react immediately without depending on external systems.

Here's a simple agent that could run on your instance:

```python
import requests
import time
import signal
import sys

METADATA_URL = "http://169.254.169.254/latest/meta-data/spot/instance-action.json"
POLL_INTERVAL = 5  # Check every 5 seconds

def check_spot_interruption():
    """Poll the metadata endpoint for interruption notice."""
    try:
        response = requests.get(METADATA_URL, timeout=1)
        if response.status_code == 200:
            return response.json()
    except requests.RequestException:
        pass
    return None

def graceful_shutdown():
    """Initiate graceful shutdown sequence."""
    print("Spot interruption detected. Starting graceful shutdown...")
    # Signal your application
    # This could be SIGTERM, an HTTP call, etc.
    signal.send(pid, signal.SIGTERM)

def main():
    while True:
        interruption = check_spot_interruption()
        if interruption:
            graceful_shutdown()
            # Give the app time to shut down
            time.sleep(30)
            sys.exit(0)
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
```

The advantage of on-instance polling is low latency and direct control. The disadvantage is that it requires an agent running on every instance and adds operational complexity. For most teams, the EventBridge and lifecycle hook approach is cleaner because it externalizes the orchestration logic.

### Designing Your Application for Graceful Shutdown

Regardless of which detection method you use, your application must be designed to handle a shutdown signal gracefully. This typically means:

**Stopping the acceptance of new requests.** Use a drain endpoint or in-process flag to signal that the service is shutting down. New HTTP requests should receive a 503 Service Unavailable or be routed elsewhere by the load balancer.

**Draining existing connections.** Give in-flight requests time to complete. For HTTP services, this might mean waiting for all active requests to finish (up to a timeout). For persistent connections like WebSockets or gRPC, you'll need application-specific drain logic.

**Closing resources cleanly.** Database connections, file handles, and other stateful resources should be closed in a controlled manner. This prevents data corruption and resource leaks.

**Acknowledging the shutdown.** Once everything is drained, signal back to the orchestrating system (the lifecycle hook) that shutdown is complete.

A typical implementation on a Node.js/Express server might look like this:

```javascript
const express = require('express');
const app = express();

let isShuttingDown = false;
let activeConnections = 0;

app.use((req, res, next) => {
  if (isShuttingDown) {
    res.status(503).send('Service shutting down');
    return;
  }
  activeConnections++;
  res.on('finish', () => {
    activeConnections--;
  });
  next();
});

app.post('/drain', (req, res) => {
  isShuttingDown = true;
  res.send('Draining');
  
  // Wait for active connections to drain
  const drainInterval = setInterval(() => {
    if (activeConnections === 0) {
      clearInterval(drainInterval);
      // Signal completion to ASG lifecycle hook
      notifyLifecycleComplete();
    }
  }, 100);
  
  // Timeout after 2 minutes
  setTimeout(() => {
    clearInterval(drainInterval);
    notifyLifecycleComplete();
  }, 120000);
});

function notifyLifecycleComplete() {
  // HTTP call to Lambda or local service that signals the ASG
  console.log('Shutdown complete');
}
```

### Monitoring and Observability

Building resilience around Spot interruptions is only half the battle. You need visibility into what's happening. Set up CloudWatch alarms and dashboards that track:

The number of Spot interruption warnings received and how your system responds to them. You can emit custom metrics from your Lambda functions or on-instance agents.

The success rate of graceful shutdowns. Log when a shutdown is initiated, when it completes, and if it times out. Over time, you'll identify bottlenecks or unexpected failures.

The replacement instance launch time. After a Spot interruption, how long until a new instance is healthy and in service? This metric tells you whether your capacity rebalancing strategy is working.

Use structured logging to correlate interruption events with application-level events. When you see a spike in request failures, you want to quickly know whether it was due to an unhandled interruption or an application bug.

### Putting It All Together

A production-grade Spot-based ASG architecture typically combines several elements:

1. **Capacity rebalancing** enabled on the ASG to proactively spin up replacements.
2. **EventBridge rules** that catch Spot interruption warnings and send them to an SQS queue or Lambda.
3. **ASG lifecycle hooks** that pause termination and notify a queue.
4. **A Lambda function or worker** that orchestrates graceful shutdown, deregisters from load balancers, and signals lifecycle completion.
5. **Application-level drain endpoints** that the orchestrator calls to cleanly shut down services.
6. **CloudWatch monitoring** to alert you if anything goes wrong.

Together, these pieces create a system that handles the full lifecycle of a Spot interruption: early warning, proactive replacement, graceful connection draining, and clean termination. The result is a cost-effective fleet that remains resilient in the face of AWS's reclamation needs.

### Conclusion

Spot interruptions are not a failure of AWS—they're a consequence of using surplus capacity at a discount. The two-minute warning window is your opportunity to prove that Spot instances can be just as reliable as On-Demand instances, provided you architect around them thoughtfully. By combining Auto Scaling Groups, lifecycle hooks, EventBridge, and application-level drain logic, you can build fleets that tolerate interruptions gracefully. Start with capacity rebalancing to reduce the impact of interruptions, add lifecycle hooks for controlled shutdown, and instrument your application to drain cleanly. The extra effort pays dividends in reduced costs and improved reliability.
