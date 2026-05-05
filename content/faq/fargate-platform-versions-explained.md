---
title: "Fargate Platform Versions Explained"
---

## Fargate Platform Versions Explained

When you launch a container on AWS Fargate, you're not just specifying which Docker image to run—you're also choosing a platform version that determines which runtime environment, storage capabilities, networking features, and operating system patches your task will use. Yet many developers treat the platform version field as an afterthought, accepting whatever default AWS assigns or upgrading without understanding what they're actually changing. This oversight can lead to unexpected behavior changes, compatibility issues, or missed opportunities to use new features that could improve your application.

In this article, we'll demystify Fargate platform versions: what they represent, what meaningful improvements each major version introduced, how to intentionally pin a version for stability, and how AWS manages upgrades over time. By the end, you'll understand why this seemingly small field in your task definition matters far more than you might think.

### Understanding the Role of Platform Versions in Fargate

Before diving into specific versions, let's clarify what a platform version actually controls. When you run a task on Fargate, AWS launches your container on EC2 infrastructure that it manages on your behalf. That infrastructure runs a specific version of the Fargate platform—which is essentially a combination of the container runtime, the Linux or Windows operating system kernel, networking drivers, storage drivers, and security patches.

Think of the platform version like the operating system and driver stack on a traditional computer. Your application (the container) runs on top of it, and the version you choose affects what capabilities are available, how efficiently your application runs, and which security patches are applied. Unlike EC2, where you control the AMI and patches, Fargate abstracts this away—but you still get to choose which "generation" of that abstraction you want.

This choice matters because different platform versions support different task capabilities. For example, if you want your Fargate task to use Amazon EFS (Elastic File System), mount additional ephemeral storage beyond the root volume, or use certain networking features, you need a platform version that supports those features. Choosing too old a version might leave capabilities locked away; choosing too new a version before you've tested compatibility might introduce unexpected changes.

### The Evolution of Fargate Platform Versions

AWS has released several major platform versions over the years, each bringing incremental but meaningful improvements. Let's walk through the most relevant ones and understand what each introduced.

#### Platform Version 1.3.0 and Earlier

The earliest Fargate platform versions (1.0.0, 1.1.0, 1.2.0, and 1.3.0) established the foundational Fargate experience. Version 1.3.0, in particular, was a stable release that many applications still run on today. At this level, Fargate provided basic container orchestration with task networking via elastic network interfaces (ENIs), CloudWatch logging, service discovery, and the ability to scale tasks based on demand.

However, these earlier versions had notable limitations. The root volume (where your container filesystem lives) was fixed in size—you couldn't request additional ephemeral storage. Networking was functional but less sophisticated than later versions. There was no native support for persistent storage solutions like EFS. And the operating system kernel underneath was older, meaning fewer performance improvements and a larger surface area for security patches.

For many teams, 1.3.0 was perfectly adequate—and honestly, it still works fine for straightforward containerized applications. But as use cases evolved and customers asked for richer features, AWS pushed forward with new versions.

#### Platform Version 1.4.0 and the Major Feature Expansion

Platform version 1.4.0 represented a significant leap forward and is considered by many to be the version that truly matured Fargate. It introduced several capabilities that developers had been requesting:

**Configurable Ephemeral Storage:** Before 1.4.0, each Fargate task came with a fixed amount of ephemeral storage (temporary, instance-level storage that gets wiped when the task stops). With 1.4.0, you gained the ability to request between 20 GB and 200 GB of ephemeral storage—critical for workloads that need to process large files, create temporary caches, or perform batch operations. You specify this in your task definition using the `ephemeralStorage` parameter.

**Amazon EFS Support:** This was a game-changer for applications needing persistent, shared storage. Before 1.4.0, if you wanted your Fargate tasks to read or write to persistent data that could survive task restarts or be shared across multiple tasks, you'd need to use external solutions or manage your own storage infrastructure. With 1.4.0, you could mount an EFS file system directly into your container, opening up new architectural possibilities for stateful workloads.

**Improved ENI Handling:** Fargate 1.4.0 refined how elastic network interfaces are managed. Tasks could now support multiple ENIs (depending on task size), enabling more sophisticated networking scenarios. This was particularly valuable for applications requiring multiple IP addresses or fine-grained network isolation.

**Updated Container Runtime:** The underlying container runtime received updates for better performance and compatibility with newer Docker features, though these changes were largely transparent to users.

These improvements made 1.4.0 the default choice for many new Fargate workloads. If you're starting a new project, 1.4.0 is likely your baseline expectation.

#### Later Platform Versions and Ongoing Improvements

Beyond 1.4.0, AWS continued to release updates (1.4.1, 1.4.2, and so on) that primarily brought security patches, bug fixes, and performance tuning rather than major new features. Each minor version bump represents AWS's commitment to keeping the platform secure and efficient without breaking existing deployments.

The platform version numbering follows semantic versioning logic: a change in the first digit (like 1.x to 2.x) would indicate a breaking change that might require application modifications, while minor version bumps (1.4.0 to 1.4.1) are forward-compatible and mostly transparent.

### Working with the LATEST Platform Version

Many developers specify `LATEST` as their platform version, which tells Fargate to automatically use whatever the newest available version is at the time the task launches. This sounds convenient—you get all the latest features and security patches without lifting a finger—but it comes with a trade-off.

Using `LATEST` means you could experience unexpected behavior changes between deployments. Imagine you deploy your service on a Monday and everything works fine. On Wednesday, AWS releases a new platform version as the new `LATEST`. You redeploy your application (perhaps to fix an unrelated bug), and suddenly your task is running on a different platform with different default behaviors, different kernel parameters, or different networking stack characteristics. Most of the time this is seamless, but occasionally it introduces subtle incompatibilities.

AWS generally supports multiple platform versions simultaneously and doesn't force upgrades—when you specify `LATEST`, you're opting into the upgrade path. AWS is careful about backward compatibility, but the guarantee is "best effort" rather than absolute.

For production workloads, many teams prefer pinning a specific version they've tested thoroughly. For development and non-critical environments, `LATEST` is often fine and ensures you're always getting security patches.

### Pinning Platform Versions for Stability

If you decide to pin a specific platform version—and there are good reasons to do so—you simply specify the exact version number in your task definition. Here's how it looks in a task definition JSON:

```json
{
  "family": "my-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "platformVersion": "1.4.0",
  "containerDefinitions": [
    {
      "name": "my-container",
      "image": "my-app:latest",
      "memory": 512
    }
  ]
}
```

When you specify `platformVersion: "1.4.0"`, every time you launch a task from this definition, it will use platform version 1.4.0 specifically—even if newer versions are available. This gives you control and predictability.

The benefit is straightforward: stability. You can thoroughly test your application against a specific platform version, document any quirks or dependencies, and deploy with confidence knowing the underlying infrastructure won't change beneath you.

The drawback is responsibility. You're now on the hook for eventually testing and upgrading to newer versions as AWS phases out old ones. AWS doesn't force immediate upgrades, but very old platform versions will eventually reach end-of-support dates.

A pragmatic middle ground is to pin major versions but accept minor updates. For instance, specifying `1.4` would pin you to the 1.4.x family but allow AWS to automatically update you within that family (from 1.4.0 to 1.4.2 for security patches). However, the exact syntax for this depends on your infrastructure-as-code tool and AWS API version.

### Linux vs. Windows Platform Families

So far, we've focused on the version number, but there's another dimension to platform selection: the operating system family. Fargate supports both `LINUX` and `WINDOWS` platform families, each with its own platform version timeline.

The Linux platform family is by far the more mature and feature-rich. If you're containerizing a Linux application—Node.js, Python, Go, Java running on Linux, etc.—you'll use the Linux platform family. This is where all the features we've discussed (EFS support, configurable ephemeral storage, etc.) live first. The ecosystem around Linux containers is also simply larger; most container images and best practices assume a Linux base.

The Windows platform family allows you to run Windows containers on Fargate, which is valuable if you have legacy .NET Framework applications, PowerShell scripts, or other Windows-specific workloads. Windows container support on Fargate came later than Linux support, so the feature set and platform version timeline are slightly behind. For example, EFS support on Windows Fargate arrived after it was available on Linux. Windows platform versions follow their own versioning scheme and release schedule.

In your task definition, you specify the platform family via the `requiresCompatibilities` and the `runtimePlatform` field:

```json
{
  "family": "windows-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "runtimePlatform": {
    "operatingSystemFamily": "WINDOWS_2019",
    "cpuArchitecture": "X86_64"
  },
  "cpu": "1024",
  "memory": "2048",
  "platformVersion": "1.4.0",
  "containerDefinitions": [
    {
      "name": "windows-container",
      "image": "windows-app:latest",
      "memory": 2048
    }
  ]
}
```

For Linux, the `runtimePlatform` specification is optional (though becoming more common in modern task definitions), and you'd typically use:

```json
{
  "runtimePlatform": {
    "operatingSystemFamily": "LINUX",
    "cpuArchitecture": "X86_64"
  }
}
```

There's also an `ARM64` CPU architecture option for Linux, which corresponds to Graviton-based Fargate compute. Graviton processors are AWS-built chips that often offer better price-to-performance for many workloads, but they require container images built for ARM64.

### How AWS Manages and Upgrades Platform Versions

Understanding AWS's upgrade strategy helps you plan your versioning approach. AWS doesn't arbitrarily force all customers onto the newest platform version. Instead, it operates a multi-version support model:

**Active Support:** New platform versions are released periodically (roughly every few months, though this varies). When a new version launches, it becomes the new default for tasks that don't specify a platform version. However, old versions remain available and supported.

**Long-Term Support Windows:** AWS maintains older platform versions for an extended period—typically measured in years. This means your pinned version won't suddenly become unavailable tomorrow.

**Communication and Deprecation:** AWS communicates deprecation dates well in advance through AWS Health notifications, documentation updates, and service health dashboards. If you're pinned to an old version, you'll be notified before it goes away, giving you time to test and migrate to a newer version.

**Security and Patches:** Critical security patches are applied to multiple platform versions simultaneously. If a major kernel vulnerability is discovered, AWS will patch active platform versions, even older ones. Minor security updates are more likely to be concentrated on newer versions.

This model balances AWS's desire to move customers forward with the reality that large deployments can't move overnight. It's a lesson in infrastructure maturity.

### Practical Considerations for Choosing Your Platform Version

Here's how to think through the decision in practice:

**For new projects:** Start with `LATEST` or the current stable version (check AWS documentation for what's recommended at the time). You want the newest features and security posture without backward compatibility baggage.

**For existing stable applications:** Pin a specific version you've tested thoroughly. This gives you control and predictability. Plan a quarterly or semi-annual review to assess newer versions.

**For multi-environment setups:** Consider pinning production to a known-stable version while running development and staging on `LATEST`. This lets you test upcoming changes without risking production.

**When adding new features:** If you need a feature like EFS that requires a minimum platform version, check the documentation, upgrade your pinned version accordingly, and test before deploying to production.

**For cost-sensitive workloads:** Platform versions don't directly affect pricing, but newer versions sometimes include performance improvements or support for better-performing compute options (like Graviton). Factor this into your upgrade decisions.

### Checking Your Current Platform Version

If you want to see which platform version a running task is actually using, you can query the ECS API:

```bash
aws ecs describe-tasks \
  --cluster my-cluster \
  --tasks arn:aws:ecs:region:account:task/my-task \
  --query 'tasks[0].platformVersion'
```

This returns the exact platform version the task is running on. For task definitions, you can inspect the definition itself:

```bash
aws ecs describe-task-definition \
  --task-definition my-task-definition \
  --query 'taskDefinition.platformVersion'
```

If the result is null or not shown, it means the task definition doesn't pin a version and will use the default.

### Real-World Example: Upgrading for EFS

Let's walk through a concrete scenario. Suppose you have a batch processing application running on Fargate with platform version 1.3.0. Your application processes large data files, and currently you're downloading them from S3 at the start of each task—which is slow and costs money in data transfer fees.

You want to use EFS to maintain a shared cache of processed files, reducing redundant downloads. But EFS support on Fargate requires platform version 1.4.0 or later.

Here's your upgrade path:

First, you update your task definition to specify platform version 1.4.0:

```json
{
  "family": "batch-processor",
  "platformVersion": "1.4.0",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "ephemeralStorage": {
    "sizeInGiB": 100
  },
  "volumes": [
    {
      "name": "efs-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED"
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "processor",
      "image": "batch-processor:latest",
      "memory": 2048,
      "mountPoints": [
        {
          "sourceVolume": "efs-storage",
          "containerPath": "/cache"
        }
      ]
    }
  ]
}
```

You register this new task definition and test it in a development environment. You verify that EFS mounting works, performance improves, and no new errors appear.

Once tested, you roll out the new version to production, possibly using a canary deployment (running a few tasks on the new version alongside existing tasks) before fully cutting over.

The key insight here is that upgrading your platform version often unlocks new capabilities in your application—it's not just a maintenance task, it's an opportunity to improve.

### Platform Versions and Compliance

One more consideration worth mentioning: if you operate under compliance requirements (like HIPAA, PCI-DSS, or SOC 2), you may need to maintain documentation about which platform version you're running and understand what security patches it includes. Pinning a platform version makes this documentation easier—you have an explicit, unchanging target. With `LATEST`, you'd need to log which version was active at each point in time.

AWS provides detailed release notes for each platform version that document security patches, bug fixes, and feature additions. These are invaluable if you need to demonstrate to auditors that you're running a patched, secure version.

### Conclusion

Fargate platform versions are one of those details that can feel invisible until they matter. But understanding the landscape—knowing that 1.4.0 brought EFS and configurable storage, that LATEST offers convenience at the cost of predictability, that Linux and Windows families evolve on different timelines, and that AWS manages upgrades carefully to balance innovation with stability—gives you the knowledge to make intentional choices.

The practical takeaway is simple: don't accept platform version defaults blindly. For production workloads, decide whether pinning a specific version makes sense for your use case. For development, embrace `LATEST` and stay current. Check the AWS documentation for your region to see what versions are available and what features each one brings. And when you want to use a new Fargate capability, be sure your task definition's platform version supports it.

By treating platform version selection as a deliberate part of your task definition—just as thoughtful as choosing CPU and memory—you'll avoid surprises, unlock capabilities, and maintain better control over your containerized applications on Fargate.
