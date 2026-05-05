---
title: "Connection Draining vs Deregistration Delay: Graceful Scale-In with ALB and NLB"
---

## Connection Draining vs Deregistration Delay: Graceful Scale-In with ALB and NLB

When you scale down a fleet of servers, you want existing requests to finish cleanly. The last thing users want is to see their half-completed transactions or streaming connections abruptly severed. This is where connection draining and deregistration delay come in—a critical load balancer feature that ensures graceful termination of instances without dropping in-flight requests. Understanding how these mechanisms work and how to tune them properly is essential for building resilient, user-friendly applications on AWS.

### Why Graceful Termination Matters

Imagine you're running a web application during a traffic dip. Your Auto Scaling Group decides to terminate an instance to save costs. Without any special handling, the load balancer would immediately stop sending new requests to that instance, but what about the request currently being processed? Or the one that started 5 seconds ago and takes 10 seconds to complete? If the instance shuts down abruptly, those requests fail, and your users see errors or incomplete operations.

Graceful termination gives in-flight requests a chance to complete before the instance is deregistered from the load balancer and eventually terminated. This mechanism is one of the quieter but more important features in building production-grade systems on AWS. It's the difference between a seamless scaling experience and a flurry of failed requests in your logs.

### Connection Draining on Classic Load Balancer

Before we dive into the modern load balancers, let's establish the terminology. The original Elastic Load Balancer (ELB), often called the Classic Load Balancer, uses the term **connection draining** to describe this feature. When connection draining is enabled, the Classic Load Balancer will not send any new requests to an instance that's been marked for deregistration, but it will allow existing connections to complete within a configurable timeout window.

Connection draining on the Classic Load Balancer is configured as a single timeout value—the maximum number of seconds to wait for in-flight requests to complete. The default is 300 seconds (5 minutes), and you can adjust this from 0 to 3,600 seconds. When a deregistration request is made, any connections that finish before the timeout expires are allowed to close naturally. Connections that haven't completed when the timeout is reached are forcefully closed.

The beauty of this approach is its simplicity: it's a one-lever mechanism that works for most HTTP and TCP workloads. However, the Classic Load Balancer itself is rarely the focus of modern deployments, as AWS has shifted the industry toward Application Load Balancers and Network Load Balancers for new workloads.

### Deregistration Delay on ALB and NLB

When AWS introduced the Application Load Balancer (ALB) and Network Load Balancer (NLB), they renamed the feature to **deregistration delay** to reflect that you're controlling the delay before an instance is fully deregistered from the load balancer. Functionally, it's the same concept, but the terminology is clearer: it's the delay between when deregistration begins and when the instance is considered fully deregistered.

Deregistration delay on ALB and NLB operates identically to connection draining on the Classic Load Balancer. When a target (an EC2 instance or container) is being deregistered, the load balancer stops routing new requests to it but allows existing connections to finish. The default timeout is again 300 seconds, and you can configure it from 0 to 3,600 seconds.

You configure deregistration delay at the target group level, not at the individual target level. This means all targets in a target group share the same deregistration delay setting. You can adjust this via the AWS Management Console, AWS CLI, or infrastructure-as-code tools.

Here's an example using the AWS CLI to set a deregistration delay of 120 seconds:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/1234567890abcdef \
  --attributes Key=deregistration_delay.timeout_seconds,Value=120
```

### Understanding the Lifecycle: When Deregistration Delay Takes Effect

To fully appreciate deregistration delay, you need to understand what happens in the lifecycle of a scale-down event. When an Auto Scaling Group scales in (terminates an instance), several things happen in sequence.

First, if the instance is a target in a load balancer target group, the ASG initiates deregistration. At this point, the load balancer immediately stops sending new requests to the instance. However, any requests that are already in flight are allowed to continue. The load balancer will wait up to the deregistration delay timeout for these in-flight requests to complete.

Second, while the load balancer is waiting for connections to drain, the ASG respects this delay through lifecycle hooks. If your ASG has a terminating lifecycle hook configured, it will not immediately terminate the instance; instead, it will wait for the deregistration delay to expire or for the connections to complete, whichever comes first. This prevents the instance from shutting down while requests are still being processed.

The sequence looks like this: instance becomes terminating → load balancer initiates deregistration (stops routing new traffic) → instance continues processing in-flight requests → deregistration delay timeout expires or all connections complete → load balancer fully deregisters the instance → ASG terminates the instance (if no lifecycle hook, this happens automatically; if a lifecycle hook exists, it triggers a hook action).

This coordination is crucial. Without deregistration delay, an instance could be terminated while it's still trying to process requests, leading to connection resets and errors. With it properly configured, the shutdown is orderly and transparent to your users.

### Tuning Deregistration Delay: Finding the Right Balance

Choosing the right deregistration delay value requires understanding your application's characteristics. Set it too low, and you risk dropping requests that take longer to complete. Set it too high, and you're keeping instances running longer than necessary, increasing costs and delaying other scaling operations.

The default 300 seconds works well for many synchronous HTTP APIs, where most requests complete in under a minute. However, your specific value should reflect your actual request patterns. If you're running a REST API where 99% of requests finish in under 10 seconds, setting deregistration delay to 60 seconds is probably reasonable—it gives you a healthy margin for outliers without being excessive.

For applications with truly long-running operations (like document conversion, video encoding, or batch processing), you might need to increase deregistration delay significantly. In such cases, consider whether those long operations should really be blocking HTTP requests, or whether they should be offloaded to asynchronous job queues using Amazon SQS or similar services.

A practical approach is to enable detailed request logging on your load balancer and analyze the distribution of request completion times. CloudWatch Logs can store this data, and you can query it to determine percentiles. If 99% of your requests complete in 20 seconds, setting deregistration delay to 30 or 45 seconds provides a comfortable safety margin.

### Long-Lived Connections: WebSockets and Streaming

Deregistration delay becomes particularly important when your application uses long-lived connections like WebSockets or server-sent events. These connections can remain open for minutes, hours, or even days in some cases. When deregistration begins, the load balancer will not forcefully terminate these connections during the deregistration delay window.

However, here's a critical detail: once the deregistration delay timeout is reached, the load balancer *will* forcefully close any remaining connections, including WebSocket connections. This means if you have WebSocket clients that maintain persistent connections, and deregistration delay expires, those clients will experience an abrupt disconnection.

For applications heavily reliant on WebSocket persistence, you have a few options. The simplest is to increase deregistration delay substantially, perhaps to 600 or 900 seconds, if your application architecture can tolerate keeping instances running that long during scale-down events. A more sophisticated approach is to implement graceful WebSocket closure logic in your application. When your application receives a signal that it's being terminated, it can proactively send a close frame to connected clients, giving them a chance to reconnect to another instance.

The NLB is often a better choice than the ALB for WebSocket and streaming workloads, as it operates at Layer 4 (transport layer) and is more efficient at handling persistent connections. It also allows you to tune connection timeouts independently of HTTP request timeouts.

### Interaction with Auto Scaling Lifecycle Hooks

Auto Scaling lifecycle hooks provide a mechanism to perform custom actions during scale-in events. When you create a terminating lifecycle hook, the ASG will pause before terminating an instance, allowing your code to perform cleanup tasks.

Lifecycle hooks and deregistration delay work together elegantly. When an instance enters the terminating state due to scale-down, the lifecycle hook triggers. If the target is part of a load balancer, deregistration begins simultaneously. Your lifecycle hook handler can monitor the deregistration status and perform additional cleanup tasks.

A common pattern is to configure the lifecycle hook timeout to match or slightly exceed your deregistration delay. For example, if deregistration delay is set to 120 seconds, set your lifecycle hook timeout to 150 seconds. This ensures the ASG waits long enough for deregistration to complete before terminating the instance. You can use a Lambda function or SNS notification to handle the lifecycle hook, allowing you to run custom shutdown logic if needed.

Here's a conceptual flow: instance marked for termination → ASG triggers terminating lifecycle hook → load balancer begins deregistration (stops routing new traffic) → your lifecycle hook handler runs (if applicable) and allows in-flight requests to complete → deregistration delay timeout expires → lifecycle hook completes → instance is terminated.

### Detecting Connection Drops and Monitoring

Despite your best efforts to configure deregistration delay appropriately, you should monitor whether connections are actually completing gracefully. CloudWatch provides several metrics that help you detect issues.

The primary metric to watch is **TargetConnectionCount**, which shows the number of connections from the load balancer to each target. You should also monitor **UnHealthyHostCount** to ensure that instances aren't being marked unhealthy prematurely during scale-down events. If you see a spike in 5xx errors from your application during scale-down, it's a sign that connections are being dropped before they can complete.

The **DeregistrationDelay** metric (though not always visible in the console) reflects the configured delay value. More importantly, check your application logs and ALB access logs to see how many requests are failing with connection reset errors during scale-in events. These logs are invaluable for tuning deregistration delay.

You can query ALB access logs stored in S3 using Athena to find how many requests were terminated due to the target being removed. Look for the `elb_status_code` field; codes in the 5xx range that coincide with scale-down events are a red flag. If your scale-down events consistently result in dropped connections, your deregistration delay is too short for your workload.

### Practical Configuration Examples

Let's walk through a real-world scenario. Suppose you're running a payment processing API on an ALB with an Auto Scaling Group. Your typical request takes 2–5 seconds to complete. You want to ensure that during scale-down, in-flight payment requests are never dropped.

First, you'd set deregistration delay to 60 seconds, giving a healthy margin above your maximum expected request duration:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/payments-api/50dc6c495c30cf54 \
  --attributes Key=deregistration_delay.timeout_seconds,Value=60
```

Next, you'd configure your ASG with a terminating lifecycle hook to ensure the hook timeout aligns with the deregistration delay:

```bash
aws autoscaling put-lifecycle-hook \
  --lifecycle-hook-name graceful-shutdown \
  --auto-scaling-group-name payment-api-asg \
  --lifecycle-transition autoscaling:EC2_INSTANCE_TERMINATING \
  --default-result CONTINUE \
  --heartbeat-timeout 90
```

Note that the heartbeat timeout is 90 seconds—longer than the deregistration delay—to ensure the ASG waits for deregistration to complete. You could also attach a Lambda function to handle the hook, performing graceful shutdown logic if needed.

For a WebSocket application with persistent connections that may last hours, you might take a different approach:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:targetgroup/websocket-app/30dc6c495c30cf54 \
  --attributes Key=deregistration_delay.timeout_seconds,Value=900
```

This 900-second (15-minute) deregistration delay allows even very long-lived WebSocket connections to survive a scale-down event. Combined with graceful closure logic in your application, this ensures clients can reconnect without undue disruption.

### Common Pitfalls and How to Avoid Them

One common mistake is setting deregistration delay too low in hopes of faster scale-down. While a 10-second deregistration delay might speed up your scale-in by a few seconds, it almost certainly will cause request failures if any requests take longer than that to complete. The performance gain is minimal compared to the risk.

Another pitfall is forgetting to configure deregistration delay at all, relying on the default. While 300 seconds is reasonable for many workloads, it's not necessarily optimal. It's worth analyzing your actual request patterns and tuning to a more appropriate value.

A third mistake is configuring deregistration delay without corresponding lifecycle hooks or monitoring. If you set a high deregistration delay but don't ensure your ASG respects it via lifecycle hooks, instances might be forcefully terminated before the deregistration delay window closes, defeating the purpose.

Finally, developers sometimes confuse deregistration delay with connection timeout settings on the target itself. Deregistration delay is a load balancer feature; it doesn't change your application's connection handling. Your application still needs to properly close connections and handle graceful shutdown signals (like SIGTERM).

### Deregistration Delay and Container Orchestration

If you're running containers on Amazon ECS with an ALB, deregistration delay still applies at the target group level, but you need to coordinate it with your container's shutdown behavior. When a task is being stopped, the ECS agent initiates deregistration of the container from the target group. Simultaneously, it sends a SIGTERM signal to the container.

Your container should handle SIGTERM by gracefully shutting down: closing new request handlers, allowing in-flight requests to complete, and exiting cleanly. The deregistration delay gives the container time to do this. Set your container's stop timeout (typically 30–120 seconds in your task definition) to be slightly shorter than your deregistration delay. This ensures the container has a chance to shut down gracefully before the task is forcefully killed.

For Kubernetes on AWS (via EKS), the same principle applies. Configure your pod's termination grace period to align with your load balancer's deregistration delay, ensuring proper coordination.

### Fine-Tuning for Different Workload Patterns

Different application types benefit from different deregistration delay values. A microservice that handles individual API requests might thrive with a 30-second deregistration delay. A batch processing service that handles long-running jobs might need 600 seconds or more. A real-time streaming service might require careful consideration of how long clients can tolerate buffered data before reconnection.

The key is to understand your application's request distribution. Use your load balancer's access logs and application logs to determine the 95th and 99th percentile request completion times. Set deregistration delay to something higher than the 99th percentile, perhaps 20–30% higher to provide a safety margin for outliers.

If you're unsure, start conservative. A deregistration delay that's too long is preferable to one that's too short—you'll see slower scale-down, but you won't see dropped requests. Once you have production data, you can confidently reduce it.

### Key Takeaways

Deregistration delay (or connection draining on Classic Load Balancers) is a foundational feature for graceful scale-down. It ensures that in-flight requests complete before instances are terminated, preventing user-visible errors and maintaining the integrity of transactions and operations.

The default 300-second timeout works for many applications, but you should tune it based on your actual request patterns. Long-lived connections like WebSockets require special consideration, as do applications with custom termination logic. Coordinate deregistration delay with Auto Scaling lifecycle hooks to ensure proper ordering of events during scale-down.

Monitor your scale-down events via CloudWatch metrics and load balancer access logs to detect connection drops, then adjust your configuration accordingly. With proper configuration, your application will scale down gracefully, providing a seamless experience for your users even as your infrastructure shrinks.
