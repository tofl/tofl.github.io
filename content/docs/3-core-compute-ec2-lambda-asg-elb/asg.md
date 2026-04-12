---
title: "7. ASG"
type: docs
weight: 3
---

## Auto Scaling Groups (ASG)

An Auto Scaling Group is an EC2 fleet management service that automatically adjusts the number of running instances based on demand, health, or a schedule. The core problem it solves is twofold: you don't want to over-provision (wasting money on idle capacity), and you don't want to under-provision (degrading user experience under load). ASG handles both by adding instances when demand rises and terminating them when it drops — all without manual intervention. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)

### Launch Templates vs. Launch Configurations

Before ASG can launch an instance, it needs to know *what* to launch. This is defined in either a **launch template** or a **launch configuration**.

A **launch template** is the modern, recommended approach. It supports versioning, which means you can maintain multiple versions and specify which one the ASG should use (or always use the latest). Launch templates also unlock access to newer features like mixed instance types, Spot allocation strategies, and T3/T4 unlimited burst settings. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html)

A **launch configuration** is the older, legacy alternative. It's a flat, immutable object — once created, it cannot be modified, only replaced. No versioning, no mixed instances, no newer instance features. For the exam, know that AWS recommends migrating to launch templates, and any scenario involving mixed Spot/On-Demand fleets requires a launch template. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-configurations.html)

### Scaling Policies

ASG supports three scaling policy types, and choosing the right one depends on whether you're reacting to real-time metrics, changes in load magnitude, or predictable patterns.

**Target tracking scaling** is the simplest and most commonly used. You declare a target value for a metric — for example, keep average CPU utilization at 50% — and ASG continuously adjusts capacity to maintain that target, both scaling out and scaling in automatically. This is analogous to a thermostat: set the temperature, and the system handles the rest. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html)

**Step scaling** gives you finer-grained control by defining scaling adjustments that vary based on how far the metric breaches an alarm threshold. For instance, add 1 instance if CPU is between 60–80%, but add 3 instances if it exceeds 80%. This is useful when the appropriate response to a small spike differs significantly from the response to a large one. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html)

**Scheduled scaling** is used when load patterns are predictable — for example, scaling out every weekday at 08:00 before business hours begin, and scaling in at 20:00. Scheduled actions don't react to metrics; they simply change the desired, minimum, or maximum capacity at a specified time. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/scheduled_scaling.html)

### Lifecycle Hooks

By default, when ASG launches or terminates an instance, it moves quickly — the instance either starts serving traffic or disappears almost immediately. **Lifecycle hooks** let you pause that transition so you can run custom logic at critical moments. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html)

There are two hook points:

- **`EC2_INSTANCE_LAUNCHING` (Pending state)** — Triggered after the instance is launched but before it's put in service. Useful for installing software, pulling configuration from Parameter Store, or registering the instance with an external service.
- **`EC2_INSTANCE_TERMINATING` (Terminating state)** — Triggered before the instance is actually terminated. Useful for draining in-flight jobs, flushing logs to S3, or deregistering from a service registry.

While a lifecycle hook is active, the instance is held in a `Pending:Wait` or `Terminating:Wait` state. You signal completion by calling `complete-lifecycle-action` via the CLI or SDK — or the hook times out after a configurable period (default 1 hour, maximum 48 hours) and the transition proceeds automatically.

A common exam pattern is: *an ASG must run a bootstrap script before instances receive traffic* — the answer is a lifecycle hook on the `Pending` state combined with a script that signals completion.

### Warm Pools

Cold start latency is a real concern when scaling out: a freshly launched instance takes time to boot, run User Data, and become healthy. **Warm pools** solve this by maintaining a pool of pre-initialized, stopped (or running) instances that are ready to be quickly promoted into the active fleet when demand increases. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-warm-pools.html)

Instances in the warm pool count against your account's EC2 limits but are cheaper to run if kept in a stopped state. When ASG needs to scale out, it pulls from the warm pool first before launching brand-new instances, significantly reducing the time-to-serve for new capacity.

### ASG Health Checks

ASG needs a way to determine whether an instance is healthy and should continue serving traffic, or whether it should be replaced. It supports two health check sources: [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)

- **EC2 health checks** (default) — ASG marks an instance unhealthy only if the underlying EC2 instance itself is in an impaired state (e.g., hardware failure, instance stopping unexpectedly). This check knows nothing about whether your application is actually responding correctly.
- **ELB health checks** — When an ASG is integrated with an Elastic Load Balancer, you can configure ASG to also trust the ELB's health check results. If the load balancer marks an instance as unhealthy (e.g., the application is returning 5xx errors or failing TCP checks), ASG will terminate and replace it.

For production workloads, ELB health checks are strongly preferred because they reflect actual application health, not just EC2 instance state. This is a frequent exam distinction: EC2 health checks alone won't replace an instance whose application has crashed but whose underlying VM is still running.

### Integration with ELB and ALB

ASG and ELB are almost always used together in exam scenarios. The integration works through **target groups**: you register the ASG with a target group, and the load balancer's listener rules route traffic to that group. As ASG scales out, new instances are automatically registered with the target group; as it scales in, they are deregistered before termination. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/attach-load-balancer-asg.html)

One important behavior to understand here is **connection draining** (called *deregistration delay* on ALB/NLB). When an instance is marked for termination, the load balancer stops sending new requests to it but allows in-flight requests to complete within a configurable grace period (default 300 seconds). This prevents abrupt connection drops for users whose requests are mid-flight. Combined with a lifecycle hook on the `Terminating` state, this gives you a clean, zero-disruption scale-in path.

For the exam, a common scenario looks like: *instances are being terminated while users experience dropped connections* — the fix is ensuring connection draining is enabled with an appropriate timeout, or extending the lifecycle hook timeout to allow graceful shutdown.

{{< qcm >}}
[
{
"question": "A company wants to deploy an Auto Scaling Group that uses a mix of On-Demand and Spot instances to reduce costs. Which configuration artifact is required to support this setup?",
"answers": [
{
"answer": "Launch Configuration",
"isCorrect": false,
"explanation": "Launch Configurations are legacy, immutable objects that do not support mixed instance types or Spot allocation strategies. They cannot be used for mixed On-Demand/Spot fleets."
},
{
"answer": "Launch Template",
"isCorrect": true,
"explanation": "Launch Templates are the modern, recommended approach and are required for mixed instance type fleets, including On-Demand and Spot combinations. They support Spot allocation strategies and other advanced features unavailable in Launch Configurations."
},
{
"answer": "Instance Profile",
"isCorrect": false,
"explanation": "An Instance Profile is an IAM construct used to pass a role to an EC2 instance. It defines permissions, not the launch configuration of an ASG fleet."
},
{
"answer": "Auto Scaling Plan",
"isCorrect": false,
"explanation": "An Auto Scaling Plan is a higher-level feature for scaling strategy management. It does not define what type of instances to launch and does not enable mixed Spot/On-Demand fleets on its own."
}
]
},
{
"question": "A developer needs to update a Launch Configuration attached to an existing Auto Scaling Group to change the instance type. What is the correct approach?",
"answers": [
{
"answer": "Edit the existing Launch Configuration and save the changes.",
"isCorrect": false,
"explanation": "Launch Configurations are immutable. Once created, they cannot be modified. You must create a new one and associate it with the ASG."
},
{
"answer": "Create a new Launch Configuration with the desired instance type and update the ASG to use it.",
"isCorrect": true,
"explanation": "Because Launch Configurations are immutable (cannot be edited after creation), the correct approach is to create a new Launch Configuration and then update the ASG to reference the new one."
},
{
"answer": "Create a new version of the existing Launch Configuration.",
"isCorrect": false,
"explanation": "Versioning is a feature of Launch Templates, not Launch Configurations. Launch Configurations have no versioning support."
},
{
"answer": "Delete the ASG and recreate it with a new Launch Configuration.",
"isCorrect": false,
"explanation": "Deleting the ASG is unnecessary and disruptive. You only need to create a new Launch Configuration and associate it with the existing ASG."
}
]
},
{
"question": "An application experiences highly variable traffic, with occasional sudden large spikes. The team wants the ASG to add significantly more instances during severe spikes than during minor ones. Which scaling policy best fits this requirement?",
"answers": [
{
"answer": "Target Tracking Scaling",
"isCorrect": false,
"explanation": "Target Tracking adjusts capacity to maintain a target metric value automatically, but it does not allow you to define differentiated scaling responses based on the magnitude of the breach."
},
{
"answer": "Scheduled Scaling",
"isCorrect": false,
"explanation": "Scheduled Scaling is based on time, not real-time metric values. It cannot react to sudden unpredictable traffic spikes."
},
{
"answer": "Step Scaling",
"isCorrect": true,
"explanation": "Step Scaling allows you to define multiple scaling adjustments tied to different alarm threshold ranges. For example, add 1 instance if CPU is 60–80%, but add 3 instances if CPU exceeds 80%. This is ideal when the appropriate response varies based on how severe the load spike is."
},
{
"answer": "Simple Scaling",
"isCorrect": false,
"explanation": "Simple Scaling triggers a single fixed adjustment when an alarm fires and then waits for a cooldown period before acting again. It does not support differentiated responses based on how far the metric breaches the threshold."
}
]
},
{
"question": "A company's web application receives heavy traffic every weekday from 9 AM to 6 PM and very little traffic at other times. Traffic patterns are consistent and predictable. Which ASG scaling policy is most appropriate?",
"answers": [
{
"answer": "Target Tracking Scaling",
"isCorrect": false,
"explanation": "Target Tracking is a reactive policy that adjusts capacity based on real-time metric values. While it works, it is not the most optimal choice when load patterns are entirely predictable, as there will be a lag before it reacts."
},
{
"answer": "Step Scaling",
"isCorrect": false,
"explanation": "Step Scaling is designed for reacting to metric breaches of varying magnitude, not for predictable, time-based load patterns."
},
{
"answer": "Scheduled Scaling",
"isCorrect": true,
"explanation": "Scheduled Scaling is purpose-built for predictable load patterns. You can schedule a scale-out action before business hours begin (e.g., 8:45 AM) and a scale-in action after they end (e.g., 6:15 PM), ensuring capacity is ready before traffic arrives."
},
{
"answer": "Manual Scaling",
"isCorrect": false,
"explanation": "Manual Scaling requires human intervention to adjust capacity and does not automate the process, making it error-prone and operationally burdensome for a recurring daily pattern."
}
]
},
{
"question": "An ASG is configured to launch new EC2 instances when demand increases. However, instances take 8 minutes to download application dependencies and complete initialization before they can serve traffic. During this time, the load balancer is already routing requests to the new instances, causing errors. What is the recommended solution?",
"answers": [
{
"answer": "Increase the ASG health check grace period.",
"isCorrect": false,
"explanation": "The health check grace period delays health checks but does not prevent the load balancer from sending traffic to the instance once it is registered. It does not pause the instance before it enters service."
},
{
"answer": "Use a lifecycle hook on the EC2_INSTANCE_LAUNCHING event to pause the instance in a Pending:Wait state until initialization is complete, then signal completion.",
"isCorrect": true,
"explanation": "A lifecycle hook on the Pending state holds the instance in Pending:Wait, preventing it from being put into service until the bootstrap script completes and calls complete-lifecycle-action. This is the canonical pattern for ensuring instances are fully initialized before receiving traffic."
},
{
"answer": "Use a lifecycle hook on the EC2_INSTANCE_TERMINATING event.",
"isCorrect": false,
"explanation": "The EC2_INSTANCE_TERMINATING hook fires before an instance is terminated, not before it enters service. It is used for graceful shutdown, not initialization."
},
{
"answer": "Switch from a Launch Configuration to a Launch Template.",
"isCorrect": false,
"explanation": "Switching to a Launch Template provides access to modern features like mixed instance types, but does not by itself prevent new instances from receiving traffic before they are initialized."
}
]
},
{
"question": "An instance in an ASG with a lifecycle hook on the EC2_INSTANCE_LAUNCHING event is currently in the Pending:Wait state. The bootstrap script has successfully completed. What must happen for the instance to transition to the InService state?",
"answers": [
{
"answer": "The instance will automatically transition after the EC2 status checks pass.",
"isCorrect": false,
"explanation": "EC2 status checks passing does not signal lifecycle hook completion. The hook holds the instance in Pending:Wait regardless of EC2 status until explicitly signaled or timed out."
},
{
"answer": "Call complete-lifecycle-action via the CLI or SDK to signal that the hook is complete.",
"isCorrect": true,
"explanation": "When a lifecycle hook is active, the instance stays in the Wait state until you explicitly signal completion by calling complete-lifecycle-action. Without this signal, the instance will remain in Pending:Wait until the hook timeout expires."
},
{
"answer": "The instance transitions automatically after 24 hours.",
"isCorrect": false,
"explanation": "The default hook timeout is 1 hour (not 24 hours), and the maximum is 48 hours. However, relying on the timeout is not the intended approach — the bootstrap script should signal completion explicitly."
},
{
"answer": "Reboot the instance to trigger the state transition.",
"isCorrect": false,
"explanation": "Rebooting the instance does not signal lifecycle hook completion. The correct mechanism is calling complete-lifecycle-action."
}
]
},
{
"question": "A company wants to reduce scale-out latency for their ASG because newly launched instances take several minutes to boot and run User Data scripts. They want new capacity to be available within seconds when needed. Which ASG feature addresses this?",
"answers": [
{
"answer": "Scheduled Scaling",
"isCorrect": false,
"explanation": "Scheduled Scaling adds capacity at predefined times but does not solve cold start latency for on-demand scale-out events outside the schedule."
},
{
"answer": "Warm Pools",
"isCorrect": true,
"explanation": "Warm Pools maintain a set of pre-initialized, stopped (or running) instances. When ASG needs to scale out, it pulls from the warm pool first, avoiding full boot and User Data execution time, significantly reducing time-to-serve for new capacity."
},
{
"answer": "Lifecycle Hooks",
"isCorrect": false,
"explanation": "Lifecycle Hooks actually add time to the launch process by pausing instances in a Wait state. They are useful for ensuring readiness, not for reducing total launch time."
},
{
"answer": "Step Scaling",
"isCorrect": false,
"explanation": "Step Scaling determines how many instances to add and when, but does not affect how long it takes for a new instance to become available after it is launched."
}
]
},
{
"question": "An EC2 instance in an ASG is running, but the application process has crashed and is returning 503 errors. The underlying EC2 instance hardware is healthy. With only EC2 health checks configured, what will happen?",
"answers": [
{
"answer": "ASG will detect the unhealthy application and terminate and replace the instance.",
"isCorrect": false,
"explanation": "EC2 health checks only evaluate the state of the EC2 instance itself (e.g., hardware failure, unexpected stop). They are unaware of application-level health, so a crashed application on a running VM will not trigger replacement."
},
{
"answer": "The instance will remain in service and continue to receive traffic, even though the application is down.",
"isCorrect": true,
"explanation": "EC2 health checks mark an instance unhealthy only when the underlying VM is in an impaired state. Since the EC2 instance is still running normally, ASG considers it healthy and will not replace it, even though the application is returning errors."
},
{
"answer": "The load balancer will automatically notify ASG to terminate the instance.",
"isCorrect": false,
"explanation": "This behavior requires ELB health checks to be enabled in the ASG configuration. Without enabling ELB health checks on the ASG, it will not act on the load balancer's findings."
},
{
"answer": "ASG will reboot the instance to attempt recovery.",
"isCorrect": false,
"explanation": "ASG does not reboot instances. When it determines an instance is unhealthy (based on its configured health check source), it terminates and replaces it — it does not attempt reboots."
}
]
},
{
"question": "A production ASG is integrated with an Application Load Balancer. The team wants the ASG to automatically replace instances when the application is returning 5xx errors, even if the EC2 instance itself is still running. What must be configured?",
"answers": [
{
"answer": "Enable ELB health checks on the ASG in addition to EC2 health checks.",
"isCorrect": true,
"explanation": "When ELB health checks are enabled on the ASG, the ASG trusts the load balancer's health evaluation. If the ALB marks an instance unhealthy (e.g., due to 5xx errors or failed TCP checks), the ASG will terminate and replace that instance."
},
{
"answer": "Configure a CloudWatch alarm that triggers a scaling policy when 5xx errors are detected.",
"isCorrect": false,
"explanation": "A CloudWatch alarm on 5xx errors could trigger a scale-out policy, but it would not automatically terminate the specific unhealthy instance. ELB health checks integrated with ASG are the direct mechanism for replacing unhealthy instances."
},
{
"answer": "Enable detailed monitoring on the EC2 instances.",
"isCorrect": false,
"explanation": "Detailed monitoring increases the frequency of CloudWatch metric reporting but does not add application-level health awareness to ASG. It will not cause ASG to replace instances based on HTTP errors."
},
{
"answer": "Configure a lifecycle hook on the EC2_INSTANCE_TERMINATING event.",
"isCorrect": false,
"explanation": "A termination lifecycle hook delays termination to allow graceful shutdown. It does not help detect or trigger replacement of unhealthy instances."
}
]
},
{
"question": "Users are reporting dropped connections during ASG scale-in events. Instances are being terminated while their requests are still being processed. Which two configurations would best resolve this issue? (Select TWO)",
"answers": [
{
"answer": "Enable connection draining (deregistration delay) on the ALB target group with an appropriate timeout.",
"isCorrect": true,
"explanation": "Connection draining (called deregistration delay on ALB/NLB) tells the load balancer to stop sending new requests to a deregistering instance while allowing in-flight requests to complete within the configured grace period (default 300 seconds). This prevents abrupt connection drops."
},
{
"answer": "Add a lifecycle hook on the EC2_INSTANCE_TERMINATING event to delay termination until in-flight requests complete.",
"isCorrect": true,
"explanation": "A termination lifecycle hook pauses the instance in Terminating:Wait state, giving time for in-flight requests to finish, logs to be flushed, or other graceful shutdown logic to run before the instance is actually terminated."
},
{
"answer": "Switch from Target Tracking to Step Scaling.",
"isCorrect": false,
"explanation": "Changing the scaling policy type does not affect how instances are terminated or how in-flight connections are handled. The issue is with the termination behavior, not the scaling trigger."
},
{
"answer": "Increase the minimum number of instances in the ASG.",
"isCorrect": false,
"explanation": "Increasing the minimum capacity reduces scale-in frequency but does not solve the connection-dropping issue when scale-in does occur. The root problem is the termination behavior."
},
{
"answer": "Enable EC2 health checks instead of ELB health checks.",
"isCorrect": false,
"explanation": "EC2 health checks are less capable than ELB health checks for production workloads and have no bearing on connection draining behavior during scale-in."
}
]
},
{
"question": "Which of the following statements about Launch Templates are correct? (Select TWO)",
"answers": [
{
"answer": "Launch Templates support versioning, allowing you to maintain and reference multiple versions.",
"isCorrect": true,
"explanation": "Unlike Launch Configurations, Launch Templates support versioning. You can create new versions and configure the ASG to use a specific version or always use the latest version."
},
{
"answer": "Launch Templates support mixed instance types and Spot allocation strategies.",
"isCorrect": true,
"explanation": "Launch Templates unlock access to advanced fleet features including mixed On-Demand/Spot configurations and Spot allocation strategies, which are unavailable with Launch Configurations."
},
{
"answer": "Launch Templates are immutable and cannot be modified after creation.",
"isCorrect": false,
"explanation": "Immutability applies to Launch Configurations, not Launch Templates. Launch Templates support versioning, so changes are made by creating a new version rather than modifying in place."
},
{
"answer": "AWS recommends using Launch Configurations for all new ASG deployments.",
"isCorrect": false,
"explanation": "AWS recommends migrating away from Launch Configurations to Launch Templates. Launch Configurations are the legacy approach and lack support for modern EC2 features."
}
]
},
{
"question": "An ASG is set up to maintain an average CPU utilization of 60% across all instances. When CPU rises to 75%, the ASG adds instances. When it drops below 60%, the ASG removes instances. Which scaling policy type is being used?",
"answers": [
{
"answer": "Step Scaling",
"isCorrect": false,
"explanation": "Step Scaling requires you to manually define scaling adjustments for different alarm breach ranges. The described behavior — automatically maintaining a target metric — is characteristic of Target Tracking, not Step Scaling."
},
{
"answer": "Scheduled Scaling",
"isCorrect": false,
"explanation": "Scheduled Scaling changes capacity at predefined times and does not react to metric values like CPU utilization."
},
{
"answer": "Target Tracking Scaling",
"isCorrect": true,
"explanation": "Target Tracking Scaling is analogous to a thermostat: you set a target metric value (e.g., 60% CPU), and ASG continuously adjusts the number of instances — both scaling out and scaling in — to maintain that target automatically."
},
{
"answer": "Predictive Scaling",
"isCorrect": false,
"explanation": "Predictive Scaling uses machine learning to forecast future load and proactively adjusts capacity. The described scenario is reactive to a live metric target, which is Target Tracking behavior."
}
]
},
{
"question": "An ASG is integrated with an ALB. When the ASG scales out, what automatically happens to newly launched instances in relation to the load balancer?",
"answers": [
{
"answer": "They must be manually registered with the ALB target group.",
"isCorrect": false,
"explanation": "When an ASG is registered with a target group, new instances are automatically registered as they are launched. Manual registration is not required."
},
{
"answer": "They are automatically registered with the ALB target group.",
"isCorrect": true,
"explanation": "When an ASG is associated with a target group, it automatically registers new instances with the target group as they are launched, and deregisters them when they are terminated, making the integration seamless."
},
{
"answer": "They receive traffic only after a manual health check is triggered.",
"isCorrect": false,
"explanation": "Health checks are performed automatically by the load balancer after registration. No manual health check trigger is required."
},
{
"answer": "The ALB must be restarted to discover new instances.",
"isCorrect": false,
"explanation": "ALB does not need to be restarted. The target group integration with ASG handles instance registration dynamically and automatically."
}
]
},
{
"question": "What is the default timeout for an ASG lifecycle hook, and what is the maximum configurable timeout?",
"answers": [
{
"answer": "Default: 5 minutes, Maximum: 1 hour",
"isCorrect": false,
"explanation": "The default lifecycle hook timeout is 1 hour, not 5 minutes. The maximum is 48 hours."
},
{
"answer": "Default: 1 hour, Maximum: 48 hours",
"isCorrect": true,
"explanation": "ASG lifecycle hooks default to a 1-hour timeout. If the hook is not completed (via complete-lifecycle-action) within the configured period, the transition proceeds automatically. The maximum configurable timeout is 48 hours."
},
{
"answer": "Default: 30 minutes, Maximum: 24 hours",
"isCorrect": false,
"explanation": "Neither of these values is correct. The default is 1 hour and the maximum is 48 hours."
},
{
"answer": "Default: 1 hour, Maximum: 72 hours",
"isCorrect": false,
"explanation": "The default of 1 hour is correct, but the maximum is 48 hours, not 72 hours."
}
]
},
{
"question": "A developer is designing a solution where instances being removed from an ASG must flush application logs to Amazon S3 before they are terminated. Which approach is correct?",
"answers": [
{
"answer": "Use a lifecycle hook on the EC2_INSTANCE_LAUNCHING event to pause the instance and run the log flush script.",
"isCorrect": false,
"explanation": "The EC2_INSTANCE_LAUNCHING hook fires during instance startup, before the instance enters service. It is not triggered during termination and cannot be used to run pre-termination logic."
},
{
"answer": "Use a lifecycle hook on the EC2_INSTANCE_TERMINATING event to pause the instance in Terminating:Wait, run the log flush script, and then call complete-lifecycle-action.",
"isCorrect": true,
"explanation": "The EC2_INSTANCE_TERMINATING hook fires before an instance is terminated, holding it in Terminating:Wait. This gives custom scripts time to flush logs to S3, deregister from services, or drain jobs. Once done, complete-lifecycle-action is called to allow termination to proceed."
},
{
"answer": "Enable connection draining on the ALB to ensure logs are flushed before termination.",
"isCorrect": false,
"explanation": "Connection draining manages in-flight HTTP requests, not application log flushing. It does not pause the instance or run custom scripts."
},
{
"answer": "Configure a CloudWatch Events rule to trigger a Lambda function that flushes logs when an instance is terminated.",
"isCorrect": false,
"explanation": "While this could work as an external mechanism, it does not pause the instance termination to ensure logs are flushed before the instance disappears. A lifecycle hook is the correct in-band mechanism to pause and control the termination flow."
}
]
}
]
{{< /qcm >}}