---
title: "Sizing Fargate Tasks: Right-Sizing CPU and Memory to Avoid Waste"
---

## Sizing Fargate Tasks: Right-Sizing CPU and Memory to Avoid Waste

When you first deploy a containerized application to AWS Fargate, one of the most common mistakes is choosing task CPU and memory specifications based on what feels safe rather than what your application actually needs. You might default to 2 vCPU and 4 GB of memory because it sounds reasonable, only to discover six months later that your workload uses a fraction of that capacity. This miscalibration doesn't just waste money—it can also mask performance problems or prevent you from running more concurrent tasks within your infrastructure budget.

Right-sizing Fargate tasks is both an art and a science. It requires understanding the discrete CPU and memory combinations that Fargate enforces, knowing how to profile your actual workload using CloudWatch Container Insights, and being comfortable with iterative adjustment. This article walks you through the entire process, from initial selection through continuous optimization.

### Understanding Fargate's Discrete CPU and Memory Combinations

Unlike EC2 instances where you can often choose arbitrary resource configurations, Fargate enforces a specific set of valid CPU and memory combinations. This constraint exists to optimize resource allocation across AWS's infrastructure and to ensure predictable performance characteristics. Understanding these combinations is your first step toward effective sizing.

Fargate supports CPU values of 256 CPU units (0.25 vCPU), 512 (0.5 vCPU), 1024 (1 vCPU), 2048 (2 vCPU), 4096 (4 vCPU), 8192 (8 vCPU), and 16384 (16 vCPU) CPU units. However, not every CPU value pairs with every memory option. For example, 256 CPU units only supports memory configurations between 512 MB and 2 GB, while 4096 CPU units supports memory between 8 GB and 30 GB.

These constraints can feel restrictive at first, but they serve a purpose. They ensure that your task gets a predictable CPU-to-memory ratio, which helps AWS schedule tasks efficiently across its infrastructure. Rather than fighting these constraints, you should embrace them as guidelines that point you toward sensible configurations.

A useful mental model is thinking about CPU and memory in terms of application tiers. A simple, stateless API service that doesn't do heavy computation might thrive on 256 CPU and 512 MB memory. A small web application might need 512 CPU and 1 GB memory. A data processing worker might require 2048 CPU and 4 GB memory. A large batch job could benefit from 8192 CPU and 16 GB memory or more.

The key is to avoid jumping straight to large configurations. Start by understanding what your application actually requires, then select the smallest valid Fargate combination that exceeds those requirements by a reasonable margin—typically 10 to 20 percent.

### Profiling Real Workload Usage with CloudWatch Container Insights

Before you can right-size effectively, you need data about how your application actually behaves. This is where CloudWatch Container Insights becomes invaluable. Container Insights is a monitoring solution that collects, aggregates, and summarizes metrics and logs from your containerized applications running on ECS or EKS.

To enable Container Insights for your Fargate tasks, you need to include the CloudWatch Container Insights agent in your task definition. The easiest approach is to use the awslogs log driver and ensure your task execution role has permissions to write to CloudWatch Logs. Then, you can optionally add the Container Insights agent as a sidecar container, though basic metrics are collected automatically without it.

Once Container Insights is enabled, you gain visibility into CPU utilization, memory utilization, network I/O, and storage metrics at both the task and container level. You can view these metrics in the CloudWatch console under Container Insights, or query them directly using CloudWatch Insights with structured logs.

Here's a practical workflow for profiling your workload. First, deploy your task with an initial guess at sizing—something reasonable but conservative, like 1024 CPU and 2 GB memory. Run it under realistic load for a period of time that captures your typical usage patterns. If your application has predictable peaks, make sure to include those in your testing. For a web service, this might be 24 hours of normal traffic. For a batch job, it might be a full run with realistic data volume.

While the task is running, check the CloudWatch Container Insights dashboard. Navigate to your task definition and look at the CPU utilization and memory utilization graphs. These graphs show the percentage of allocated resources actually being used. If your CPU utilization consistently stays below 20 percent, your task is over-provisioned on CPU. If memory utilization never exceeds 30 percent, you have too much memory allocated.

A healthy sizing profile typically shows CPU and memory utilization in the 40 to 70 percent range during normal operation, with brief spikes above that during traffic peaks. This utilization level gives you headroom for unexpected load while avoiding excessive waste.

### Understanding Task-Level Limits Versus Container-Level Reservations and Limits

This is where many developers get confused. A Fargate task definition specifies CPU and memory at the task level, but you can also set CPU and memory reservations and limits at the individual container level. Understanding how these interact is crucial for precise control and accurate monitoring.

The task-level CPU and memory values represent the total resources available to all containers running within that task. If you define a task with 1024 CPU and 2 GB memory, that's the absolute ceiling—all containers combined cannot exceed these values.

At the container level, you can define soft limits (reservations) and hard limits. A container's memory reservation is the amount of memory that is guaranteed to be available to that container. If multiple containers are running in the same task, their reservations should sum to less than or equal to the task's total memory. Hard limits on container memory, if specified, prevent that specific container from consuming more than the limit, even if memory is available elsewhere in the task.

For CPU, the behavior is slightly different. Container-level CPU limits are less commonly used because CPU is generally a shareable resource. If one container isn't using its allocated CPU, another container can use it. Memory, by contrast, is not shareable—once allocated to a container, it cannot be used elsewhere.

In practice, most single-container Fargate tasks don't specify container-level reservations and limits; they rely on the task-level settings. This keeps things simple. However, if you're running multiple containers in a single task (which is common for patterns like a main application plus a logging sidecar), you should carefully allocate memory reservations to each container to avoid conflicts.

For example, suppose you have a task with 2048 CPU and 4 GB memory. Your main application container might have a memory reservation of 3 GB, while your monitoring sidecar has a reservation of 512 MB. This ensures both containers get what they need, and you've left 512 MB as a buffer for unexpected usage spikes.

When monitoring in CloudWatch, keep in mind that Container Insights reports utilization based on task-level allocations, not container-level reservations. So if your task is allocated 4 GB and your main container is only reserving 3 GB, the utilization percentage will be calculated against the full 4 GB, not the 3 GB reserved. This is why it's important to set appropriate task-level limits in the first place.

### Common Over-Sizing Mistakes and How to Avoid Them

Over-sizing Fargate tasks is remarkably common, and it stems from a few predictable patterns of thinking. Understanding these patterns helps you avoid them.

The first mistake is the "just in case" approach. You think, "Well, CPU is cheap, so let me just allocate 4 vCPU to be safe." This mindset ignores the fact that in Fargate, you pay for every vCPU and every GB of memory you allocate, whether you use it or not. If your application typically uses 1 vCPU, allocating 4 vCPU costs four times as much. Multiplied across dozens or hundreds of tasks, this compounds quickly.

The second mistake is extrapolating from peak load without context. You observe a traffic spike that causes CPU utilization to hit 90 percent, and immediately jump to the next CPU tier. But you should ask: how long does that spike last? Is it a daily peak or a monthly outlier? If it's a brief, predictable spike, your current sizing is probably fine—you don't need to maintain 70 percent utilization during off-peak hours just to handle a five-minute peak.

The third mistake is not accounting for startup and shutdown time. When you scale up or down, new tasks take time to initialize. If you provision too conservatively, rapid scale-ups might trigger cascading failures before new tasks are ready. However, this is an argument for testing your scaling behavior, not for over-provisioning everything. Use AWS Auto Scaling with appropriate scaling policies, and test them under realistic load.

The fourth mistake is ignoring the difference between requested resources and actual usage. Just because you're looking at CloudWatch metrics doesn't mean you're looking at the right metrics. CPU utilization percentage is useful, but it's also important to understand your application's absolute CPU usage in a different deployment context. If your application uses 512 CPU units consistently, allocating 256 CPU units will never work, no matter how much headroom you think you're leaving.

Avoiding these mistakes comes down to a simple principle: measure, don't guess. Deploy with a reasonable initial estimate, gather data under realistic conditions, and adjust based on what you see.

### Iterative Tuning and Cost Impact of Resizing

Right-sizing is not a one-time exercise. Your application's resource needs change as your workload evolves, as you optimize code, and as you add features. Establishing a process for regular tuning helps you maintain efficiency over time.

A sensible approach is to review your Fargate task sizing quarterly. Look at your CloudWatch Container Insights metrics over the previous three months. Calculate the average CPU and memory utilization during normal operation (excluding maintenance windows and unusual events). If utilization is consistently below 30 percent, you're probably over-provisioned and can downsize. If it's regularly above 80 percent, you might need to upsize to maintain headroom.

When you do downsize, do it incrementally. If you're running 4 vCPU and averaging 25 percent utilization, don't jump straight to 1 vCPU. Move to 2 vCPU first, monitor for a few weeks, and then re-evaluate. This incremental approach reduces the risk of accidentally under-provisioning and causing performance problems.

Understanding the cost impact of sizing changes helps you prioritize optimization efforts. Suppose you're running 50 tasks on 2 vCPU / 4 GB memory at $0.04768 per hour per task. That's $238.40 per month for CPU and memory costs alone (not including storage or data transfer). If you downsize to 1 vCPU / 2 GB memory at $0.02384 per hour per task, you reduce costs to $119.20 per month—a 50 percent reduction. Even if only 20 percent of your tasks can be safely downsi zed, you're looking at significant savings.

However, cost isn't the only consideration. Smaller tasks also mean you can run more of them within the same infrastructure budget, which improves availability and allows for better distribution of load across your cluster. Smaller tasks also tend to start up faster, improving your application's responsiveness to scaling events.

When testing a resize operation, it's helpful to canary the change. Deploy a small number of tasks with the new sizing while keeping the majority on the old sizing. Monitor these canary tasks for a period of time—at least a few days if possible. Look not just at CPU and memory metrics, but at application-level metrics like request latency, error rates, and throughput. If everything looks good, roll out the change to the rest of your tasks.

### Practical Sizing Examples

Let's walk through a few realistic scenarios to see how the sizing process works in practice.

**Scenario 1: A simple Node.js API service.** You're running a stateless API that handles JSON requests and returns responses after light processing. Under normal load, you expect around 100 concurrent requests. You start with 512 CPU and 1 GB memory, deployed to three tasks for redundancy. After a week of monitoring, you observe that CPU utilization averages 15 percent and memory utilization averages 25 percent. This suggests you can safely move to 256 CPU and 512 MB memory. You do this one task at a time, starting with canary deployments. After two weeks, you confirm that the smaller tasks handle load just as well. Your costs drop from roughly $35 per month (for three 512 CPU tasks) to $17.50 per month. You can now run six tasks on the same budget, improving your availability.

**Scenario 2: A Python data processing worker.** You're running a background job that processes records from an SQS queue, performs some database lookups, and writes results back. Each task processes about 10 records per minute. You start with 2048 CPU and 4 GB memory. After a week of processing various batch sizes, you see that CPU utilization maxes out at 60 percent and memory hovers around 40 percent. You're tempted to downsize, but you notice that during the occasional processing spike (when a large batch arrives), CPU hits 95 percent for a few seconds. You decide to stay at 2048 CPU for now but reduce memory to 2 GB, which is a valid combination and saves some cost without risking underprovisioning on CPU. After a month, you've processed hundreds of batches and CPU patterns remain consistent, so you feel confident keeping this configuration.

**Scenario 3: A service with seasonal demand.** You run a reporting tool that sees heavy usage during the last week of each quarter and minimal usage otherwise. Sizing for quarterly peaks would mean over-provisioning the other 11 weeks. Instead, you use auto-scaling policies that tie task count to CPU utilization. During normal periods, you run with 256 CPU and 512 MB memory per task. As utilization approaches 70 percent, you automatically scale up the task count. During peak periods, you end up running three times as many tasks, each still sized modestly. This approach costs less overall than running large tasks year-round, and it also improves resilience by distributing load across more smaller units.

### Fine-Tuning Beyond Simple CPU and Memory

While CPU and memory are the primary sizing levers, a few other considerations can affect whether your chosen sizes work well in practice.

Task startup time matters more than you might think. Smaller tasks sometimes start up faster because there's less initialization to do and less memory to allocate. If your application has a long startup sequence (database connection pooling, cache warming, etc.), test startup time under your final sizing before declaring it sufficient.

The type of workload also matters. CPU-bound workloads (heavy computation, cryptography, image processing) are more sensitive to CPU sizing than I/O-bound workloads (web requests, database queries, API calls). For I/O-bound workloads, memory is often more important because you need to buffer and cache data. For CPU-bound workloads, CPU is the constraint. Understanding your application's bottleneck helps you know which resource to prioritize.

Network performance in Fargate depends partly on task size. Larger tasks generally get higher network bandwidth. If your application sends or receives large amounts of data, verify that network performance is adequate for your smaller sizing before committing to it. You can check network metrics in CloudWatch Container Insights.

### Establishing a Sizing Review Process

To make right-sizing a sustainable practice rather than a one-off exercise, establish a regular review process. This doesn't need to be complicated. Quarterly, pull your CloudWatch Container Insights data for each critical task definition. Calculate average and peak CPU and memory utilization. Document your findings in a spreadsheet or wiki. Identify which task definitions are obvious candidates for upsizing or downsizing.

Prioritize optimization efforts by cost impact. A task that runs on 100 instances is worth more time to optimize than one that runs on two instances, even if it's over-provisioned by the same percentage. Batch changes together so you don't create a state of continuous churn; aim to update sizing quarterly or biannually unless you see a clear problem.

Include application teams in this conversation. Engineers who work with a service daily often have intuition about whether it's undersized. They might notice that response times increase under load, or that the application sometimes runs out of memory. Combine this qualitative feedback with quantitative CloudWatch data to make the best decisions.

Finally, keep documentation of your sizing decisions and the reasoning behind them. Over time, this helps you understand whether certain patterns (like "all Node.js services need at least 512 CPU") are actually true for your organization, or whether they're just habits worth questioning.

### Conclusion

Right-sizing Fargate tasks is an exercise in balancing safety with efficiency. Fargate's discrete CPU and memory combinations might feel limiting at first, but they actually guide you toward sensible configurations. By using CloudWatch Container Insights to profile your actual workload, understanding the difference between task-level and container-level resource settings, and avoiding common over-sizing pitfalls, you can achieve significant cost reductions while maintaining or improving application performance.

The process is iterative. Start with an educated guess based on your application's characteristics, gather data, analyze it, and adjust. Over time, you'll develop intuition for what different types of workloads actually need. This not only saves money but also improves your ability to scale applications efficiently, respond to demand spikes, and operate infrastructure that's right-sized for real-world needs rather than worst-case imagined scenarios. The key is to make sizing decisions based on evidence rather than assumptions, and to revisit those decisions regularly as your application evolves.
