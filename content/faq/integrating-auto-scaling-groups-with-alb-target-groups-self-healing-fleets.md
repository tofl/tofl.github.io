---
title: "Integrating Auto Scaling Groups with ALB Target Groups: Self-Healing Fleets"
---

## Integrating Auto Scaling Groups with ALB Target Groups: Self-Healing Fleets

Building applications on AWS means more than just spinning up servers—it means designing systems that can heal themselves, scale gracefully, and route traffic intelligently. The combination of Auto Scaling Groups (ASGs) and Application Load Balancers (ALBs) with target groups is one of the most powerful architectural patterns you can implement. When configured correctly, this integration creates a self-healing fleet that automatically recovers from failures, handles traffic spikes, and maintains your application's availability without manual intervention.

In this tutorial, we'll walk through how to wire these components together, understand the critical configuration decisions you'll need to make, and explore a complete practical example that you can use as a template for your own deployments.

### Understanding the Three-Layer Architecture

Before diving into the integration details, let's clarify how these three components work together. Think of them as layers in your application's infrastructure: the Auto Scaling Group manages the *compute layer*, deciding how many instances you need; the Application Load Balancer sits in the *network layer*, distributing traffic across those instances; and the target group acts as the *membership list*, defining which instances should receive traffic and in what condition.

The magic happens when you connect these layers. When an ASG launches a new instance, it can automatically register that instance with an ALB target group. When an instance becomes unhealthy, the ASG can detect it and replace it. When traffic demand drops, the ASG can terminate instances gracefully, allowing the ALB to drain existing connections. This choreography, when properly configured, gives you a fleet that feels alive—constantly adapting to health, demand, and failure.

### Attaching a Target Group to an Auto Scaling Group

The foundation of this integration is straightforward: you attach an ALB target group to your Auto Scaling Group. This tells the ASG, "When you launch instances, register them here. When you terminate instances, deregister them."

When you create or modify an ASG, you specify one or more target groups in the VPC settings. The AWS console calls this the "Load balancing options" section. Via the CLI, you'd use the `TargetGroupARNs` parameter when creating or updating the ASG.

Here's a practical example using the AWS CLI:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-app-asg \
  --launch-template LaunchTemplateName=my-app-template,Version='$Latest' \
  --min-size 2 \
  --max-size 6 \
  --desired-capacity 3 \
  --vpc-zone-identifier "subnet-12345,subnet-67890" \
  --target-group-arns "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-tg/50dc6c495c0c9188"
```

Once attached, the ASG becomes the source of truth for target group membership. When an instance launches, it's automatically registered with the target group. When it terminates, it's automatically deregistered. You don't need to manage this manually—it's one of the key benefits of this integration.

### Automatic Registration and Deregistration

The lifecycle flow is elegant and automatic. When the ASG launches a new instance, AWS immediately registers it with the attached target group. At this point, the instance appears in the target group's list of targets with a status that depends on your health check configuration—typically "Initial" or "Draining" states before becoming "Healthy."

Similarly, when the ASG terminates an instance—whether due to scale-in, instance replacement, or failure—it deregisters the instance from the target group. This triggering of deregistration is what enables connection draining, which we'll explore in detail later.

The key insight here is that the ASG maintains the *desired state* of instances, and the target group maintains the *delivery state* of traffic. They're designed to work in concert.

### Health Check Types: EC2 Status vs. ELB Health Checks

This is where many developers stumble, because the decision you make here profoundly affects how your fleet behaves when things go wrong.

An Auto Scaling Group has a separate health check mechanism from the ALB's health checks, even though both exist on the same instances. When you configure an ASG, you choose a health check type: either "EC2" or "ELB" (which includes ALB health checks).

**EC2 status checks** are AWS's built-in instance-level diagnostics. They monitor system status (physical hardware issues, network connectivity at the hypervisor level) and instance status (kernel panic, out-of-memory, failed network interfaces). These checks run every minute. If an instance fails an EC2 status check, the ASG marks it as unhealthy and replaces it. The advantage is that EC2 checks are independent of your application logic—they catch hardware problems and fundamental system failures. The disadvantage is that they don't know if your application is actually running or responsive.

**ELB health checks** (which includes ALB health checks) are application-aware. The ALB periodically makes HTTP requests to your instances—typically every 30 seconds by default—and checks for a successful response. You define what "healthy" means: perhaps it's an HTTP 200 response from a `/health` endpoint, or it might be checking for specific response codes. If the ALB marks an instance as unhealthy, the ASG can also mark it as unhealthy and replace it.

The choice matters. If you set the ASG health check type to "EC2," the ASG replaces instances only when they suffer catastrophic failures. An instance could be running, receiving traffic from the ALB, but actively serving errors—and the ASG wouldn't replace it because the EC2 status checks pass. Conversely, if you set it to "ELB," the ASG respects the ALB's intelligence about application health, but you need to ensure your health check is properly configured and doesn't have false positives.

Most production deployments use "ELB" health checks for ASGs that are behind ALBs, because you want the system to respond to application-level failures, not just infrastructure failures. Here's how to set this when creating an ASG:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-app-asg \
  --launch-template LaunchTemplateName=my-app-template,Version='$Latest' \
  --min-size 2 \
  --max-size 6 \
  --desired-capacity 3 \
  --vpc-zone-identifier "subnet-12345,subnet-67890" \
  --target-group-arns "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-tg/50dc6c495c0c9188" \
  --health-check-type ELB \
  --health-check-grace-period 300
```

Notice the `--health-check-type ELB` parameter. This tells the ASG to trust the ALB's health checks when deciding whether an instance is healthy.

### The Health Check Grace Period: Patience During Boot

Here's a scenario that trips up many developers: you set the ASG health check type to ELB, launch an instance, and immediately start health checks. The instance is booting up—it's registered with the target group, but your application isn't ready yet. The ALB sends a health check request, gets a connection refused or a 503 error, marks the instance as unhealthy, and the ASG immediately replaces it. The new instance boots up, and the cycle repeats. You end up in a replacement loop, never achieving stability.

The health check grace period prevents this. It's a window of time during which the ASG ignores health check failures. This gives your instance time to boot, your application to start, dependencies to initialize, and warm-up scripts to complete. Only after this grace period expires does the ASG start using health check results to determine instance health.

The grace period is specified in seconds. A typical value is 300 seconds (5 minutes) for applications that start quickly, but applications with long startup times—maybe they're loading large datasets or initializing complex services—might need 600 or even 900 seconds. The trade-off is that a longer grace period means the ASG takes longer to detect and replace a truly broken instance.

You set the grace period when creating or updating the ASG:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name my-app-asg \
  --health-check-grace-period 300
```

A common mistake is setting the grace period too short or forgetting to set it at all. If your application takes 90 seconds to fully start, a 60-second grace period will cause constant replacements. Always match your grace period to your actual application startup time, plus a reasonable buffer for variability.

### Connection Draining on Scale-In

When the ASG decides to terminate instances—because desired capacity decreased, or because the instance is being replaced—a crucial process happens: connection draining. This is how AWS ensures that existing connections aren't abruptly severed.

When you deregister a target from an ALB target group, the ALB stops sending *new* requests to that instance but allows existing connections to complete. It waits for a configurable duration—the deregistration delay, also called the connection draining timeout—for those connections to close naturally. If connections don't close within that window, the ALB forcefully closes them.

Here's the key integration point: the ASG respects this deregistration delay. When terminating an instance, it deregisters the instance from the target group and then waits for the deregistration delay period before actually shutting down the instance. This gives active connections time to complete.

You configure the deregistration delay on the target group itself, not the ASG:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-tg/50dc6c495c0c9188 \
  --attributes Key=deregistration_delay.timeout_seconds,Value=30
```

A deregistration delay of 30 seconds is often reasonable for web applications with short-lived connections. For applications with long-lived connections—streaming, WebSockets, file uploads—you might increase it to 60 or 120 seconds. The trade-off is that longer deregistration delays slow down scale-in operations.

### A Complete Practical Example

Let's bring this all together with a realistic example: a simple Node.js web application running on Amazon Linux 2 instances, behind an ALB, scaled by an ASG.

First, create a launch template that includes a basic health check endpoint:

```bash
aws ec2 create-launch-template \
  --launch-template-name my-app-template \
  --launch-template-data '{
    "ImageId": "ami-0c55b159cbfafe1f0",
    "InstanceType": "t3.micro",
    "IamInstanceProfile": {
      "Name": "ec2-app-role"
    },
    "SecurityGroupIds": ["sg-0123456789abcdef0"],
    "UserData": "IyEvYmluL2Jhc2gKc3VkbyB5dW0gdXBkYXRlIC15CnN1ZG8geXVtIGluc3RhbGwgLXkgbm9kZWpzCmNhdCA+IC9ob21lL2VjMi11c2VyL2FwcC5qcyA8PCBFT0YKXG4gIGNvbnN0IGh0dHAgPSByZXF1aXJlKCdodHRwJyk7CiAgY29uc3Qgc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIoKHJlcSwgcmVzKSA9PiB7CiAgICBpZiAocmVxLnVybCA9PT0gJy9oZWFsdGgnKSB7CiAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7CiAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdoZWFsdGh5JyB9KSk7CiAgICB9IGVsc2UgaWYgKHJlcS51cmwgPT09ICcvJykgewogICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ3RleHQvaHRtbCcgfSk7CiAgICAgIHJlcy5lbmQoJ0hlbGxvIGZyb20gJyArIHJlcS5oZWFkZXJzWydob3N0J10pOwogICAgfSBlbHNlIHsKICAgICAgcmVzLndyaXRlSGVhZCg0MDQpOwogICAgICByZXMuZW5kKCdOb3QgRm91bmQnKTsKICAgIH0KICB9KTsKICBzZXJ2ZXIubGlzdGVuKDMwMDAsICgpID0+IHsKICAgIGNvbnNvbGUubG9nKCdTZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgMzAwMCcpOwogIH0pOwo=",
    "TagSpecifications": [
      {
        "ResourceType": "instance",
        "Tags": [
          {
            "Key": "Name",
            "Value": "my-app-instance"
          }
        ]
      }
    ]
  }'
```

That `UserData` is base64-encoded bash that installs Node.js and starts a simple HTTP server with a `/health` endpoint. When decoded, it sets up a server listening on port 3000 with both a health check endpoint and a basic home page.

Next, create the target group with appropriate health check settings:

```bash
aws elbv2 create-target-group \
  --name my-app-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-12345678 \
  --health-check-protocol HTTP \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --matcher HttpCode=200
```

This configures the ALB to check the `/health` endpoint every 30 seconds, considering an instance healthy after 2 consecutive successful checks and unhealthy after 3 consecutive failures. The instance must respond within 5 seconds.

Now create the Auto Scaling Group, attaching it to the target group:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name my-app-asg \
  --launch-template LaunchTemplateName=my-app-template,Version='$Latest' \
  --min-size 2 \
  --max-size 6 \
  --desired-capacity 3 \
  --vpc-zone-identifier "subnet-12345,subnet-67890" \
  --target-group-arns "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-tg/50dc6c495c0c9188" \
  --health-check-type ELB \
  --health-check-grace-period 300
```

Finally, add a target tracking scaling policy to scale based on CPU utilization:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-app-asg \
  --policy-name cpu-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 300
  }'
```

This policy tells the ASG to maintain an average CPU utilization of 70% across all instances. When utilization rises above 70%, it scales out (launches more instances). When it drops below 70%, it scales in (terminates instances), with a longer cool-down period to avoid rapid oscillation.

Now you have a self-healing, elastically scalable fleet. When an instance fails, the ALB's health check detects it, the ASG marks it unhealthy and replaces it. When traffic spikes, the scaling policy detects increased CPU and launches more instances. When traffic drops, the policy scales back down, gracefully draining connections as instances terminate.

### Monitoring and Troubleshooting Your Integration

In practice, you'll want to monitor how your integrated system behaves. Use CloudWatch to watch key metrics: ASG group terminating instances, target group healthy and unhealthy host count, ALB request count, and application-specific metrics like response time.

Common issues to watch for include health checks failing due to misconfiguration (wrong port, wrong endpoint path), grace periods too short for your application startup time, and deregistration delays too short for long-lived connections. When you see instances being rapidly replaced, it's usually a grace period or health check configuration problem, not a fundamental issue with the architecture.

### Key Takeaways

The integration of Auto Scaling Groups with ALB target groups creates infrastructure that's resilient, scalable, and self-healing. The crucial configuration points are attaching the target group to the ASG (which enables automatic registration and deregistration), choosing ELB health checks as your ASG health check type (to make the ASG aware of application-level failures), setting an appropriate health check grace period (to avoid replacement loops during startup), and configuring a sensible deregistration delay (to allow graceful connection draining).

By understanding how these components work together—from the moment an instance launches and registers with the target group, through the health checks that monitor its condition, to the graceful deregistration that happens when it terminates—you gain the ability to design cloud applications that truly heal themselves. This is one of the most valuable patterns you can master in AWS architecture.
