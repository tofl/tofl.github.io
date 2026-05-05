---
title: "Running Windows Containers on ECS Fargate"
---

## Running Windows Containers on ECS Fargate

When you're managing containerized .NET applications or legacy Windows workloads in AWS, Elastic Container Service (ECS) with Fargate offers a compelling option: serverless container orchestration without the overhead of managing EC2 instances. But Windows containers on Fargate aren't simply a straightforward port of the Linux experience. They operate under a distinct set of constraints, offer different pricing, and support a narrower range of configurations. Understanding these differences is essential if you want to make informed decisions about whether Fargate is right for your Windows workloads.

In this article, we'll explore the practical realities of running Windows containers on ECS Fargate. You'll learn which Windows Server base images are available, what CPU and memory combinations the platform supports, how costs differ from their Linux counterparts, and where Fargate's limitations might push you toward alternative architectures. By the end, you'll have a clear picture of when Fargate is an excellent fit for your Windows containers and when it isn't.

### The Windows Container Landscape on AWS

Before diving into Fargate specifics, let's establish context. Windows containers differ fundamentally from Linux containers in how they work. A Windows container requires a Windows host OS to run; you can't run a Windows container on a Linux host. This architectural reality cascades through every decision about how you deploy and manage Windows workloads on AWS.

On ECS, you have two primary options for running Windows containers: EC2 launch type and Fargate launch type. EC2 gives you full control and flexibility—you choose the instance type, manage the underlying Windows Server host, and handle scaling yourself. Fargate abstracts away infrastructure management entirely, similar to how it works for Linux containers. AWS provisions and manages the underlying capacity for you.

The catch? Windows Fargate is more limited in scope than Linux Fargate. AWS didn't simply flip a switch and enable Windows on Fargate; instead, the team built Windows Fargate support with specific constraints and trade-offs in mind. Your job is to understand whether those trade-offs align with your requirements.

### Supported Windows Server Base Images

The first practical constraint you'll encounter is the limited set of Windows Server base images available for Fargate. Currently, AWS supports Windows Server 2019 and Windows Server 2022 on Fargate. These are the only options.

Windows Server 2019 is based on the Semi-Annual Channel (SAC) release, while Windows Server 2022 is more recent and receives longer support. If you're starting a new Windows Fargate project today, 2022 is almost always the better choice. It's more actively maintained, receives security patches regularly, and will remain supported longer than 2019.

However, here's where legacy applications complicate things. If your .NET Framework application or Windows service was built against Windows Server 2016 or an older LTSC (Long-Term Servicing Channel) release, you might not be able to simply upgrade the base image without testing and potential code changes. Windows Server 2019 and 2022 both include significant updates to the .NET Framework, WinRM, PowerShell, and system components compared to older releases.

When you're evaluating whether to move a legacy Windows application to Fargate, always start by testing your application container image against Windows Server 2022. Build and test locally, push it to Amazon ECR, and validate it runs. If you encounter compatibility issues, Windows Server 2019 is your fallback, though it's farther in its support lifecycle.

Inside these base images, you'll typically layer your application on top. For .NET Framework applications, you'd build FROM an official Microsoft Windows Server image, install your application, and include any required dependencies. Here's a simplified example:

```dockerfile
FROM mcr.microsoft.com/windows/servercore:ltsc2022

WORKDIR /app
COPY MyApplication/ .
RUN setx PATH "%PATH%;C:\app"

ENTRYPOINT ["MyApp.exe"]
```

The Microsoft Container Registry (mcr.microsoft.com) is the canonical source for official Windows Server images. Always pull from there rather than Docker Hub to ensure you're getting properly maintained, secure images.

### CPU and Memory Configuration: A Different Model

One of the most important differences between Windows Fargate and Linux Fargate is the CPU and memory combinations available. With Linux Fargate, you have considerable flexibility. You can run a task with 256 MB of memory and 0.25 vCPU, or you can mix and match various combinations up to 30 GB of memory and 4 vCPU (or higher with specific configurations). The platform is quite permissive.

Windows Fargate operates under stricter constraints. AWS requires larger minimum allocations and supports fewer combinations. The minimum memory for Windows on Fargate is 2 GB, compared to 512 MB for Linux (and technically 256 MB with a 0.25 vCPU). This reflects Windows Server's baseline resource requirements—the OS itself consumes considerably more memory than a Linux kernel.

Here are the supported CPU and memory combinations for Windows Fargate:

For a 1 vCPU task, you can allocate 2 GB, 3 GB, or 4 GB of memory. For 2 vCPU, the range is 4 GB through 8 GB. For 4 vCPU, you can go from 8 GB to 30 GB. These combinations represent the sweet spot where AWS can efficiently provision and manage Windows Fargate capacity.

This constraint has practical implications. If you have a lightweight microservice that would comfortably run with 512 MB on Linux, you're still paying for a minimum 2 GB allocation on Windows. That overhead is baked into the cost model and can't be avoided.

When designing Windows Fargate tasks, be realistic about your memory requirements and don't over-allocate just because the platform allows it. A .NET Framework application that genuinely needs 3 GB should be configured for exactly that, not 8 GB. Monitor your CloudWatch metrics after deployment to validate that your allocation assumptions are correct. You can always adjust the task definition later.

### Understanding Windows Fargate Pricing

Cost is often the deciding factor in infrastructure decisions, and Windows Fargate pricing tells an important story about platform priorities and economics.

Windows Fargate carries a significant premium compared to Linux Fargate. As of the most recent pricing models, Windows tasks cost roughly 70-80% more per vCPU-hour than equivalent Linux tasks. This difference reflects several factors: the licensing cost of Windows Server, the additional infrastructure overhead required to run Windows, and the smaller scale at which AWS operates Windows Fargate (which reduces economies of scale).

The memory pricing also differs. Windows memory pricing is higher than Linux, though the difference is less dramatic than the vCPU premium.

To make this concrete, consider a simple example. A task running 1 vCPU and 2 GB of memory on Linux Fargate might cost around $0.02 per hour. The same task on Windows Fargate would cost roughly $0.035 per hour—nearly double. If that task runs 24/7 for a month, you're looking at $15 versus $25, a $300 annual difference for a single task.

These costs accumulate quickly at scale. If you're running dozens of Windows containers, the cumulative cost premium becomes substantial. This is why it's worth evaluating whether EC2 launch type might be more economical for your workload. With EC2, you're paying for the instance and its licensing, but you can pack multiple tasks onto a single instance, spreading the cost across several containers.

The pricing model also explains why AWS hasn't provided GPU support or some advanced networking features for Windows Fargate—the smaller addressable market and higher operational costs make those features less economically justified.

### Limitations and Feature Gaps

Windows Fargate doesn't support GPU acceleration. If your .NET application requires GPU compute for machine learning, image processing, or other accelerated workloads, you'll need to use ECS with EC2 launch type and GPU-enabled instance types like the g3 or p3 families.

Windows Fargate also doesn't support some advanced networking features available on Linux. Elastic Fabric Adapter (EFA) is not available for Windows tasks. If you need high-performance networking between containers or require low-latency communication patterns, this is a limitation worth noting upfront.

Logging and observability integrations are more limited. While CloudWatch Logs integration works, some third-party observability agents and monitoring tools have incomplete or slower Windows support compared to Linux. Always verify that your preferred monitoring solution supports Windows containers before committing to a Windows Fargate architecture.

Windows Fargate also has stricter task isolation and placement constraints. You can't use placement strategies to pack tasks densely on underlying capacity, as you could with EC2 launch type. Each task gets its own isolated environment, which is good for security and stability but means you don't have fine-grained control over resource utilization.

Secrets management works, but with caveats. You can use AWS Secrets Manager and Systems Manager Parameter Store with Windows Fargate, but you need to ensure your application knows how to retrieve and use those secrets. The init containers pattern common in Linux Fargate deployments (where a sidecar container fetches secrets and writes them to shared volumes) is less mature for Windows.

### Ideal Use Cases for Windows Fargate

Despite these limitations, Windows Fargate excels in specific scenarios. The primary and most compelling use case is running .NET Framework applications that require Windows.

.NET Framework (the older, Windows-only version of .NET, as opposed to .NET Core or modern .NET which runs cross-platform) applications often represent legacy enterprise systems. These applications were written when .NET Core didn't exist or wasn't suitable for the use case. Containerizing them has always been tricky because you need a Windows host, and managing Windows infrastructure is more complex than Linux for many organizations.

Fargate solves this problem beautifully. You container your .NET Framework app, push the image to ECR, create a Fargate task definition, and run it. AWS handles all the Windows Server infrastructure, patching, capacity management, and scaling. Your team focuses on the application, not the underlying operating system.

Another strong use case is Windows services and background jobs. If you have a Windows service that performs scheduled maintenance, batch processing, or asynchronous work, Fargate can run it on a managed schedule using EventBridge triggers. You don't need a long-lived EC2 instance; the service container starts when needed and stops when complete.

.NET applications that use Windows-specific APIs or COM interop are natural fits. If your code calls into Win32 APIs, uses Active Directory integration, or depends on COM components, you're locked into Windows anyway. Fargate makes that less painful by removing infrastructure overhead.

Applications requiring Windows authentication and domain integration can also work on Fargate, though you'll need to configure networking appropriately to allow the container to reach your domain controllers.

### When to Consider Alternatives

Windows Fargate isn't always the right choice, and understanding when to look elsewhere is equally important.

If cost is a primary concern and you're running multiple Windows containers continuously, ECS with EC2 launch type is almost certainly cheaper. A single m5.xlarge instance can run multiple .NET Framework containers simultaneously, and you're paying for the instance and licensing once, not per-container. You sacrifice the operational simplicity of Fargate, but you gain significant cost efficiency.

If you need GPU support, Windows Fargate is immediately off the table. You'll use EC2 with GPU instance types, though be aware that GPU support for Windows containers is less mature than for Linux and requires specific setup.

If your application needs to scale to thousands of concurrent instances or requires sub-second scaling response times, the provisioning overhead of Fargate might not align with your requirements. EC2 offers more granular control and the ability to pre-warm capacity.

Applications with complex networking requirements, high-throughput inter-container communication, or needs for Elastic Fabric Adapter should evaluate EC2 launch type. Windows Fargate's networking capabilities, while functional, are less flexible than EC2.

### Designing a Windows Fargate Task

Let's walk through what actually designing and deploying a Windows Fargate task involves. Start by creating a task definition. Unlike with Linux, you must explicitly specify that your task uses Windows platform.

```bash
aws ecs register-task-definition \
  --family my-windows-app \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu 1024 \
  --memory 2048 \
  --runtime-platform operatingSystemFamily=WINDOWS \
  --container-definitions file://container-definitions.json
```

That `runtime-platform` parameter is critical. If you omit it or set it to LINUX, your task will fail immediately when it tries to pull a Windows container image onto what it assumes is a Linux host.

Your container definitions JSON specifies your image (from ECR), port mappings, environment variables, logging configuration, and resource reservations. For a .NET Framework application, you might have something like:

```json
{
  "name": "dotnet-app",
  "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
  "cpu": 1024,
  "memory": 2048,
  "portMappings": [
    {
      "containerPort": 8080,
      "hostPort": 8080,
      "protocol": "tcp"
    }
  ],
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/my-windows-app",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs"
    }
  },
  "environment": [
    {
      "name": "ASPNETCORE_ENVIRONMENT",
      "value": "Production"
    }
  ]
}
```

One important consideration: Windows Fargate tasks take longer to start than Linux tasks, often 1-2 minutes for the task to reach the running state. This isn't a bug; it's the nature of provisioning and initializing a Windows environment. When designing your infrastructure or setting timeout expectations, account for this startup time.

Health checks are crucial for Windows Fargate, just as they are for Linux. Define a reasonable health check that validates your application is actually ready to serve traffic. For a .NET web application, an HTTP endpoint is typical:

```json
"healthCheck": {
  "command": ["CMD-SHELL", "powershell -Command try { $response = Invoke-WebRequest http://localhost:8080/health -UseBasicParsing; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"],
  "interval": 30,
  "timeout": 5,
  "retries": 3,
  "startPeriod": 60
}
```

That `startPeriod` is important—give your Windows application enough time to initialize before health checks begin failing it.

### Monitoring and Troubleshooting

Once your Windows Fargate task is running, monitoring and troubleshooting follow familiar patterns but with Windows-specific considerations.

CloudWatch Logs integration works reliably. Configure your containers to send logs to CloudWatch, and you can search, filter, and analyze application logs in the CloudWatch console. For .NET applications, ensure you're sending application logs (from your logging framework) and system events to CloudWatch so you have visibility into what's happening.

CloudWatch Container Insights provides metrics like CPU, memory, and network utilization. These metrics help you understand whether your vCPU and memory allocations are appropriate. If CPU is consistently at 90%+ utilization, you might need to increase your task's vCPU allocation. If memory is consistently low, you might be overprovisioning.

Performance baseline matters more for Windows than Linux. Because of the startup overhead and higher base resource consumption, Windows Fargate tasks often show different performance characteristics than equivalent Linux containers. Run load tests against your Windows task definition in a staging environment before moving to production, and validate that response times and throughput meet your requirements.

For troubleshooting a misbehaving Windows Fargate task, you have fewer options than with EC2. You can't SSH into the task's host. You're dependent on your application's logging and CloudWatch metrics. Make sure your application logs are comprehensive and include error details, stack traces, and diagnostic information. Consider adding application performance monitoring (APM) or detailed tracing if debugging is difficult with basic logs.

### Making the Decision

Choosing Windows Fargate comes down to a straightforward evaluation. Do you have a Windows-specific application that needs to run in AWS? Can you tolerate the higher cost relative to Linux? Can you work within the platform's constraints (no GPU, limited networking features, longer startup times)?

If you answered yes to all three, Windows Fargate probably makes sense. You gain operational simplicity, automatic scaling, built-in fault tolerance, and the ability to focus on your application rather than infrastructure. That operational simplicity often pays for itself in reduced DevOps overhead, even if the per-container cost is higher.

If cost is paramount, or if you need features Fargate doesn't support, evaluate EC2 launch type. You'll trade operational simplicity for cost efficiency and flexibility. That trade-off is often worthwhile for production workloads at scale.

Windows containers on Fargate represent a pragmatic solution to a real problem: how do you run Windows-dependent applications with modern container orchestration without managing Windows servers yourself? The platform has constraints, but within those constraints, it delivers genuine value. Understanding what Windows Fargate can and can't do lets you make that decision with confidence.
