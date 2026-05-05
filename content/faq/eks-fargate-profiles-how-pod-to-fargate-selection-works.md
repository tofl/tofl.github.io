---
title: "EKS Fargate Profiles: How Pod-to-Fargate Selection Works"
---

## EKS Fargate Profiles: How Pod-to-Fargate Selection Works

When you're running containerized applications on Amazon EKS, you face a fundamental decision: should your pods run on Amazon EC2 instances that you manage (or that AWS manages through node groups), or should they run on AWS Fargate, where you don't manage the underlying infrastructure at all? The answer isn't one-size-fits-all, and AWS gives you the flexibility to run both simultaneously within the same cluster using Fargate profiles. This article walks you through how Fargate profiles work, how they decide which pods land on Fargate, and the practical trade-offs you need to understand.

### Understanding Fargate Profiles and Pod Selection

A Fargate profile is essentially a set of rules that tells your EKS cluster: "Hey, if a pod matches these criteria, schedule it on Fargate instead of on an EC2 node." Without a Fargate profile, all your pods default to running on the node groups you've provisioned. With profiles in place, you gain fine-grained control over workload placement.

The selection mechanism works through two primary filters: **namespaces** and **labels**. When a pod is created, the EKS control plane checks all your Fargate profiles in sequence. The first profile whose namespace and label criteria match the pod will claim it and schedule it on Fargate. If no profile matches, the pod falls back to your traditional node groups.

Think of it like a routing system at an airport. You can say "all passengers traveling to New York go through gate 5, and all business class passengers go through gate 7." A passenger could match multiple rules, but the first matching rule wins. Similarly, your pods get routed to Fargate or traditional nodes based on the first matching profile.

### Namespaces: The First Layer of Selection

Namespace matching is straightforward. When you create a Fargate profile, you specify one or more Kubernetes namespaces. Any pod launched in those namespaces becomes a candidate for Fargate scheduling, assuming the label criteria also match (we'll cover that next).

For example, imagine you want all pods in your `analytics` and `batch-jobs` namespaces to run on Fargate because they're bursty workloads that don't need constant resources. You'd create a Fargate profile and assign it those two namespaces. Every pod created in `analytics` or `batch-jobs` would then be evaluated for Fargate scheduling.

You can have multiple Fargate profiles, each targeting different namespaces. You might have one profile for your web tier, another for batch processing, and a third for your CI/CD tools. This flexibility allows you to tune resource allocation and cost per workload type.

One important caveat: the `kube-system` and `kube-node-lease` namespaces cannot run on Fargate. AWS system pods that manage the cluster's core functions must run on EC2 nodes or other managed infrastructure. This is a hard constraint by design.

### Labels: The Second Layer of Selection

Namespace selection alone isn't always granular enough. Within a namespace, you might want only certain pods on Fargate. This is where **label selectors** come in. Each Fargate profile can include one or more label selector pairs. A pod must match at least one of the label selectors in the profile *and* be in one of the specified namespaces to qualify for Fargate.

Let's make this concrete. Suppose your `production` namespace contains both long-running web services and short-lived batch jobs. You might create a Fargate profile that targets the `production` namespace but only matches pods with the label `workload-type: batch`. Now, web service pods in `production` without that label would run on your traditional node groups, while batch jobs with the label would run on Fargate.

Label selectors use Kubernetes' standard label matching syntax. You can specify exact key-value pairs, or leave the value empty to match any pod that has the key present. For instance, a selector of `fargate-eligible: ""` would match any pod with a `fargate-eligible` key, regardless of the value.

This dual-layer approach—namespace *and* labels—gives you surgical precision over pod placement without needing to modify your workloads themselves.

### Creating Fargate Profiles: eksctl vs. the Console

There are two primary ways to create Fargate profiles: the `eksctl` command-line tool and the AWS Management Console. Both work well; the choice depends on your infrastructure-as-code practices and personal preference.

#### Using eksctl

The `eksctl` tool is AWS's preferred way to manage EKS clusters from the command line. Creating a Fargate profile is straightforward:

```bash
eksctl create fargateprofile \
  --cluster my-cluster \
  --name batch-profile \
  --namespace batch-jobs \
  --labels workload-type=batch
```

This creates a Fargate profile named `batch-profile` in the cluster `my-cluster`. It targets pods in the `batch-jobs` namespace that also have the label `workload-type: batch`.

If you want to target multiple namespaces or add multiple label selectors, you can repeat the `--namespace` and `--labels` flags:

```bash
eksctl create fargateprofile \
  --cluster my-cluster \
  --name multi-profile \
  --namespace analytics \
  --namespace reporting \
  --labels app=data-processing \
  --labels team=data-eng
```

This profile would match pods in *either* the `analytics` or `reporting` namespaces *that also have* at least one of the specified labels.

You can list existing profiles with `eksctl get fargateprofile --cluster my-cluster`, and delete a profile with `eksctl delete fargateprofile --cluster my-cluster --name batch-profile`. Deleting a profile doesn't immediately evict running pods, but new pods matching that profile won't be scheduled on Fargate anymore.

#### Using the AWS Management Console

If you prefer the graphical interface, navigate to the EKS console, select your cluster, and find the "Fargate profiles" tab. Click "Create Fargate profile," give it a name, select the namespace(s), and optionally add label selectors. The form-based approach is intuitive and good for one-off tasks, though it's less suitable for managing infrastructure at scale.

#### Infrastructure as Code

For production environments, storing your Fargate profile configuration in version control is best practice. You can define profiles in CloudFormation, Terraform, or other infrastructure-as-code tools. These approaches integrate nicely with CI/CD pipelines and ensure your infrastructure remains declarative and reproducible.

### Pod Execution Roles vs. Task Execution Roles

Here's where many developers get confused: when a pod runs on Fargate, it needs permissions to interact with AWS services. This is handled through two distinct IAM roles, and conflating them causes serious troubleshooting headaches.

The **pod execution role** (also called the task role) is the IAM role that your application code assumes. If your application needs to read from an S3 bucket or write to DynamoDB, the pod execution role grants those permissions. This is equivalent to the role you'd assign to an EC2 instance running your application.

The **task execution role** (also called the Fargate execution role) is a separate role that EKS uses to pull container images from ECR, log to CloudWatch, and manage the pod's infrastructure. AWS needs these permissions to do things like decrypt your container images if they're encrypted, or to write logs to CloudWatch Logs on your behalf.

Here's the key distinction: you define the pod execution role in your pod's service account (via IAM Roles for Service Accounts, or IRSA). You define the task execution role when you create the Fargate profile. Both are necessary; both serve different purposes.

Let me illustrate with a concrete scenario. You have a data processing application that needs to read from S3 and write logs to CloudWatch. Your pod execution role should allow `s3:GetObject` for your specific bucket. Your task execution role should allow `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` so Fargate can deliver those logs. Additionally, the task execution role needs permissions for `ecr:GetAuthorizationToken` and `ecr:BatchGetImage` to pull your container images.

When you create a Fargate profile via `eksctl`, it automatically creates a default task execution role with basic permissions. You can customize it if needed, but the defaults usually suffice. The pod execution role is configured separately through your Kubernetes service account setup using IRSA.

### Key Limitations of EKS on Fargate

Fargate is powerful, but it's not a drop-in replacement for EC2 node groups in every scenario. Understanding its limitations will prevent you from trying to fit a square peg in a round hole.

**DaemonSets don't run on Fargate.** A DaemonSet ensures a pod runs on every node in your cluster. Since Fargate abstracts away the underlying nodes and you don't have direct visibility or control over the infrastructure layer, DaemonSets fundamentally don't work. This rules out Fargate for monitoring agents that need to run everywhere, like Prometheus node exporters or security scanners. If your workload relies on DaemonSets, you need traditional node groups, at least for those specific pods.

**Privileged containers are not supported.** Fargate isolates each pod more aggressively than traditional nodes. You cannot run containers with privileged mode, and you cannot grant Linux capabilities like `NET_ADMIN` or `SYS_ADMIN`. If your application requires low-level system access or elevated privileges, Fargate won't work. This eliminates some legacy applications and certain infrastructure tools from Fargate.

**HostPort is not available.** On traditional nodes, you can map a container port to the host's network interface using HostPort. This allows direct network access to specific ports on the node. Fargate doesn't support this because there's no "host" in the traditional sense. Instead, you're limited to ClusterIP and LoadBalancer services for network exposure. For most applications, this isn't an issue, but if your application hardcodes assumptions about HostPort, you'll need to refactor.

**Storage options are limited.** Fargate supports ephemeral storage (for temporary scratch space) and certain managed storage options like EBS volumes attached via the Amazon EBS CSI driver. However, you cannot use local node storage, and some advanced storage configurations don't work. If your workload requires very large or high-performance persistent volumes, traditional nodes might be more suitable.

**No GPU or Accelerator Support.** At the time of writing, Fargate pods cannot be scheduled on GPU instances. If your workload requires specialized hardware like GPUs or custom accelerators, you must use traditional node groups.

These limitations aren't criticisms of Fargate—they're deliberate design choices to maintain isolation, simplicity, and security. Understanding them helps you make the right choice for each workload.

### When to Choose Fargate Over Managed Node Groups

So when should you actually use Fargate? Here are the scenarios where it shines.

**Burstable, event-driven workloads** are Fargate's sweet spot. Imagine a batch processing job that runs for a few minutes once an hour, consuming significant resources. On traditional nodes, you'd have to keep instances running all the time, paying for idle capacity. With Fargate, you pay only for the compute resources your containers actually use, down to fine-grained intervals. The same applies to scheduled jobs, webhooks, or any workload with predictable but infrequent spikes.

**Microservices with simple requirements** benefit from Fargate's operational simplicity. If you have dozens of small services that don't need special networking, privileged access, or exotic storage configurations, running them on Fargate means you don't have to manage EC2 instances, patch operating systems, or handle node autoscaling. AWS handles all of that invisibly.

**Cost optimization for variable workloads** is another classic use case. If you have workloads whose resource consumption fluctuates unpredictably—like analytics queries that sometimes take seconds and sometimes minutes—Fargate's pay-per-use model can be more economical than reserved capacity on traditional nodes.

**Development and testing environments** are good candidates too. You might use Fargate for non-critical workloads, reserving your fixed EC2 capacity for production services that need guaranteed performance or special features.

Conversely, **stateful applications with complex storage needs**, **monitoring and infrastructure tools that require DaemonSets**, **workloads needing GPU acceleration**, and **legacy applications requiring privileged containers** should stick with traditional node groups.

Many real-world clusters use both. You might run your core microservices on Fargate and your Prometheus stack, Elasticsearch cluster, and GPU-based model inference on traditional node groups. Fargate profiles make this hybrid approach seamless—you don't have to choose between one or the other for your entire cluster.

### Practical Considerations and Best Practices

When designing your Fargate profile strategy, think about workload isolation and operational clarity. Create separate profiles for distinct workload types—one for web services, one for batch jobs, one for CI/CD. This makes it easier to reason about resource allocation and troubleshoot issues.

Use labels consistently across your organization. Establish naming conventions early (e.g., `workload-type`, `team`, `tier`, `cost-center`) and document them in your internal wiki. This prevents chaos when multiple teams deploy to the same cluster.

Remember that Fargate pricing is based on vCPU and memory reservation, not actual usage. You specify the exact CPU and memory your pod needs via requests and limits, and you pay for that full reservation. Choose your resource limits carefully—too generous and you overpay; too stingy and your pods get OOMKilled or throttled. Monitor your actual usage and adjust over time.

When troubleshooting a pod that should be on Fargate but isn't, check three things: Does the pod's namespace match the profile? Does the pod's labels match the profile's selectors? Are there other profiles that might be matching first? The pod events in `kubectl describe pod` often provide clues.

Finally, test your Fargate profiles in a non-production environment first. Create a test cluster, launch some sample pods, and verify they're scheduled on Fargate. Look at the pod details to confirm it's running on Fargate (it will show a Fargate node name) and that it has the expected CPU and memory allocation.

### Conclusion

Fargate profiles are a powerful feature for fine-grained pod scheduling in EKS, allowing you to run some workloads on managed Fargate infrastructure while keeping others on traditional EC2 node groups. By using namespace and label selectors, you gain surgical control over which pods land where without modifying your application manifests. The distinction between pod execution roles and task execution roles is crucial to getting IAM permissions right. And while Fargate has limitations—no DaemonSets, no privileged containers, no HostPort—it excels for burstable, cost-sensitive, and operationally simple workloads.

The key to success is understanding your workloads' requirements and making deliberate choices about where they should run. Use Fargate for what it's designed for, and traditional node groups for what requires their capabilities. In many cases, the answer isn't either-or; it's both, orchestrated through profiles that keep everything simple and efficient.
