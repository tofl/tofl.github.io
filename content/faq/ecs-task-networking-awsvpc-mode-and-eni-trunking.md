---
title: "ECS Task Networking: awsvpc Mode and ENI Trunking"
---

## ECS Task Networking: awsvpc Mode and ENI Trunking

When you first deploy containers on Amazon ECS, the networking story can feel surprisingly complex. Unlike running a single application on an EC2 instance where networking is relatively straightforward, ECS introduces a layer of abstraction that lets you pack multiple independent tasks onto the same underlying compute resource. The networking mode you choose fundamentally shapes how those tasks communicate, how you secure them, and ultimately how many tasks you can run on a single instance.

The `awsvpc` networking mode represents a significant shift in how container networking works in ECS. Instead of tasks sharing the instance's network interface, each task gets its own elastic network interface (ENI) with a dedicated private IP address from your VPC. This architectural choice brings powerful capabilities—like per-task security groups and fine-grained network access control—but it also introduces constraints that many developers encounter only after scaling their clusters. Understanding these tradeoffs, the inherent ENI limits, and how ENI trunking solves them is essential for building reliable ECS systems.

### Understanding awsvpc Networking Mode

Before diving into the mechanics, let's establish what awsvpc actually does. The name itself hints at the concept: AWS VPC native networking for containers. When you launch an ECS task with `awsvpc` mode, the task isn't simply assigned a port on the host's network interface. Instead, ECS provisions a separate elastic network interface and attaches it directly to the EC2 instance. The task then gets a private IP address from your VPC's subnet, just as if it were its own independent EC2 instance.

This is fundamentally different from the older `bridge` networking mode, where containers share the host's ENI and are assigned ephemeral ports that map to container ports. In bridge mode, a task running an application on port 8080 might be accessible via the host's IP on port 32000, for example. The host's single ENI handles all network traffic for all tasks on that instance.

With `awsvpc`, each task has its own network identity. A task running a web service on port 8080 is genuinely listening on port 8080 from the perspective of the VPC. There's no port mapping layer. This directness brings clarity to networking and makes service discovery more intuitive. If you have a task with IP address `10.0.1.25` running a service on port 8080, any other resource in your VPC can reach it at `10.0.1.25:8080` without worrying about which physical EC2 instance is hosting it.

The networking mode decision happens at the ECS task definition level. When you define your task, you specify the `networkMode` parameter. For ECS on EC2 (the EC2 launch type), you have choices: `bridge`, `host`, `awsvpc`, or `none`. Fargate, AWS's serverless container platform, actually has only one option: `awsvpc`. This design choice for Fargate reflects AWS's philosophy that awsvpc networking is the modern, preferred approach for containerized workloads.

### The Per-Task ENI Model and Its Advantages

The architecture of awsvpc unfolds elegantly when you understand what's happening under the hood. When ECS launches a task with `networkMode: awsvpc`, it:

First, creates a new elastic network interface and attaches it to the EC2 instance hosting the task. This ENI gets a primary private IP address from your subnet's available IP pool. The ENI also receives a primary security group that you've specified in your task definition.

Second, associates the task's network namespace with this ENI. The containerized application inside the task sees this ENI as its sole network interface, just as if the application were running directly on an EC2 instance with that ENI.

Third, maintains the ENI on the instance for the lifetime of the task. When the task stops, ECS detaches and deletes the ENI, freeing both the network interface and the IP address back to your VPC.

This per-task ENI model unlocks several powerful capabilities. Most notably, you can apply a different security group to each task, even if they're running on the same physical EC2 instance. Imagine you have a cluster with two tasks on one instance: one running your authentication service and another running a worker process. The auth service might have a security group allowing inbound traffic on port 443 from anywhere, while the worker process has a security group allowing traffic only from specific internal services. Traditional bridge networking couldn't achieve this level of granularity without additional tools.

This security isolation also extends to network policies and monitoring. CloudWatch and VPC Flow Logs can track network activity per task's IP address, giving you clear visibility into which task is making which network requests. If a compromised container starts making suspicious outbound connections, you can identify it precisely and isolate it without affecting sibling tasks on the same instance.

Additionally, awsvpc simplifies service discovery. Container orchestration tools and Kubernetes-style service meshes expect each container to have its own IP address. Awsvpc mode aligns ECS with that expectation, making it easier to integrate with tools like AWS Cloud Map or third-party service discovery systems.

### The ENI Limit Problem

Here's where the story gets complicated. Elastic network interfaces are a limited resource per EC2 instance, and the limit varies by instance type. This is an AWS-imposed constraint based on instance sizing. A `t3.small` instance can have at most three ENIs, while a larger `c5.2xlarge` can have up to ten. There's a direct correlation between instance size and ENI capacity.

Why does AWS impose these limits? ENIs are tied to network cards and interrupt handling in the hypervisor, and larger instance types have more hardware resources to manage them. It's a reflection of the underlying virtualized network infrastructure.

The implications for ECS are straightforward. If you're running a `t3.small` instance in your cluster with a maximum of three ENIs, and the primary ENI (the one the instance itself uses for its own networking) takes one slot, you have exactly two ENIs remaining for tasks. That means you can run at most two tasks with `awsvpc` networking on that instance, regardless of CPU and memory availability.

This constraint catches many teams off guard. You might have a `t3.small` with 2 CPU and 2GB of memory, and your tasks only need 512 CPU and 256MB of memory. Mathematically, you could fit eight tasks in those resources. But the ENI limit prevents you from running more than two, leaving significant compute capacity unused.

The problem becomes more pronounced in development and testing environments where teams might use smaller instance types to control costs. A single developer-facing microservice running on a `t3.micro` instance can run exactly one task—the second task has nowhere to attach its ENI.

### How ENI Trunking Multiplies Capacity

AWS recognized this limitation and introduced ENI trunking, a feature that fundamentally changes the equation. With trunking enabled, a single physical ENI can host multiple virtual network interfaces called trunk ENIs or branch ENIs. Instead of each task requiring its own physical ENI, multiple tasks can share one physical ENI by using these virtual interfaces.

Enabling ENI trunking involves two steps. First, you must launch your EC2 instances with trunking enabled using the `--eni-trunk` parameter, or enable it on existing instances through the EC2 console or AWS CLI. Second, you configure your ECS task definitions to use `awsvpcConfiguration` with `eni-trunk` support by setting the `trunkENiConfiguration`.

Once enabled, the capacity math changes dramatically. Instead of being limited by physical ENI count, you're limited by the number of trunk ENI interfaces that can attach to a single physical ENI. AWS allows up to 127 trunk ENIs per physical ENI. This means a `t3.small` instance, previously capable of hosting only two awsvpc tasks, can now host up to 127 tasks (though CPU and memory limits would kick in much sooner in practice).

For example, consider a real scenario. You're running a cluster of `t3.medium` instances for your microservices. Each instance normally supports four ENIs. Without trunking, with one ENI reserved for the instance itself, you can run three tasks. If your tasks are small—say 256 CPU and 256MB memory—the instance has plenty of spare capacity. You might ideally fit sixteen such tasks, but you're capped at three by ENI limits.

Enabling ENI trunking on these instances immediately multiplies your capacity. Now that same `t3.medium` can run the full sixteen tasks (or theoretically many more, limited only by trunk interface availability). Your cost efficiency jumps because you're actually using the instance's compute resources, not burning money on idle CPUs and memory.

### Configuring ENI Trunking in Your ECS Tasks

The configuration of ENI trunking requires changes both to your EC2 instances and your ECS task definitions. Let's walk through the practical steps.

On the EC2 instance side, when you launch an instance that will participate in an ECS cluster with trunking-enabled tasks, you specify the ENI trunking parameter. Using the AWS CLI, this looks like:

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ecs-cluster-instance}]' \
  --network-interfaces 'DeviceIndex=0,InterfaceType=trunk'
```

The `InterfaceType=trunk` parameter tells AWS to enable ENI trunking support on the instance. Alternatively, if you're managing instances through Auto Scaling, you'd specify this in your launch template.

For existing instances, you can enable trunking through the console by navigating to the instance details and modifying the network interface configuration, though this typically requires stopping the instance first. The AWS CLI approach would be to detach the current ENI, modify it to enable trunking mode, and reattach it.

On the ECS task definition side, you configure your tasks to use trunk interfaces. The relevant configuration appears in your task definition JSON:

```json
{
  "family": "my-web-service",
  "networkMode": "awsvpc",
  "containerDefinitions": [
    {
      "name": "web-container",
      "image": "my-registry/web-app:latest",
      "memory": 512,
      "cpu": 256,
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ]
    }
  ],
  "requiresCompatibilities": ["EC2"],
  "cpu": "256",
  "memory": "512",
  "trunkENiConfiguration": {
    "enabled": true
  }
}
```

The `trunkENiConfiguration` with `"enabled": true` tells ECS to use trunk interfaces for this task when running on EC2 instances that support trunking. When you launch tasks with this configuration on an instance with trunking enabled, ECS automatically provisions a branch interface (trunk ENI) instead of a full physical ENI.

One important detail: all tasks on the same physical ENI share the trunk. This means they all effectively share the primary ENI's MAC address from the hypervisor's perspective, though each still has its own distinct IP address and security group configuration. In practice, this distinction rarely matters for application-level behavior, but it's worth understanding if you're debugging network-level issues.

### Why Fargate Always Uses awsvpc

Understanding Fargate's networking model provides additional insight into why awsvpc became the standard. Fargate is AWS's serverless container compute offering, where you don't manage EC2 instances. Instead, you define task CPU and memory requirements, and AWS handles the underlying infrastructure.

Fargate exclusively uses `awsvpc` networking mode. This isn't arbitrary—it's a consequence of Fargate's architecture. When Fargate runs a task, that task is the primary workload on its allocated compute resources. There's no instance concept from the user's perspective. Each task gets its own ENI in the VPC, just as it would on EC2 with awsvpc mode.

This design choice has cascading implications. Fargate tasks have their own security groups, their own IP addresses, and their own network identities. They integrate seamlessly with VPC security models, service discovery, and observability tools. The lack of heterogeneous networking modes simplifies the Fargate platform—there's no bridge mode variant, no compatibility considerations.

For developers, the implication is clear: if you ever plan to run a workload on Fargate (or if you might in the future), using awsvpc mode on EC2 ensures consistency. Your task definitions work unchanged across both compute options. This operational flexibility is increasingly valuable as organizations adopt hybrid container strategies.

### IP Address Planning in awsvpc Architectures

When every task gets its own IP address, IP address management becomes a first-order concern in your cluster design. In bridge networking, you could potentially run hundreds of tasks on a single instance without consuming additional VPC IP addresses—the instance had one IP, and all containers shared it through port mapping. With awsvpc, every task consumes one private IP from your subnet.

This reality demands careful IP address planning. Consider a typical three-tier ECS cluster: you have maybe five application instances, and you want to run eight tasks on each, with 40 tasks total. In awsvpc mode, you're consuming 40 private IP addresses from your VPC subnets. If those subnets are carved out of a `/24` network (256 addresses), and you've already allocated addresses for NAT gateways, RDS databases, and ElastiCache clusters, you need to ensure you have sufficient IP space.

The standard approach is to plan your VPC subnets with container workloads in mind. If you know you'll run a cluster with potentially 100 tasks, you need a subnet (or subnets) with at least 100 available addresses, plus overhead for other services. AWS provides subnet size calculators and guidance, but the mental model is simple: every task is an IP consumer.

This constraint actually points toward best practices. Rather than allocating a single large subnet for everything, many teams create dedicated subnets for their ECS clusters, separate from databases, caches, and other infrastructure. This segregation makes capacity planning clearer and aligns with security group strategies—tasks in one subnet can have different ingress/egress rules than infrastructure in another.

For multi-AZ deployments (which are highly recommended for production), you distribute your cluster across multiple subnets in different availability zones. If you have a `/24` per AZ (256 addresses per zone), and your cluster can scale to 150 tasks, you might distribute them across two AZs with 75 tasks each. If a zone fails, you might temporarily exceed capacity in the remaining zone while you scale, so planning overhead above your expected maximum is prudent.

### Monitoring and Observability with awsvpc

The per-task IP model also enhances observability. With `awsvpc`, each task has a distinct network identity that persists through its lifetime. VPC Flow Logs capture traffic for each task's IP address, creating an audit trail of network activity. CloudWatch can correlate logs and metrics to specific IP addresses, making it straightforward to track which container made which request.

Consider a production incident where you need to understand which tasks were communicating with an external service during a specific time window. With awsvpc and VPC Flow Logs, you query flow logs filtered by the destination IP of that external service, and you get a list of task IPs involved. You can then cross-reference those IPs with your ECS task metadata (available through the ECS API or CloudWatch) to identify the exact task definition, container, cluster, and service involved.

This observability extends to security investigations. If you discover suspicious outbound traffic, VPC Flow Logs pinpoint the task IP responsible. You can immediately identify and isolate the problematic task using security group rules, or scale down the service without affecting other tasks on the same instance.

### Security Considerations and Isolation

The per-task security group capability of awsvpc mode enables fine-grained network security policies. In a microservices architecture, this is particularly valuable. Your API gateway service might have a security group allowing inbound HTTPS traffic from the internet but restrictive outbound rules. Your backend workers might have security groups allowing inbound traffic only from specific service IPs and restrictive outbound rules except for database access.

This approach reduces blast radius in case of compromise. If a web service is compromised and an attacker attempts to pivot to other services, network-level restrictions (security group rules) act as a second control layer. The attacker can't simply make requests to arbitrary services; security groups enforce network segmentation.

However, this capability comes with a management burden. With dozens or hundreds of tasks, managing individual security group associations becomes complex. Most teams abstract this through infrastructure-as-code tools like Terraform or AWS CloudFormation, defining security groups as logical units rather than individual resources. A "backend-worker" security group applies to all backend worker tasks, not to individual tasks.

### Migration Considerations from Bridge to awsvpc

If you have an existing ECS cluster running in bridge mode, migrating to awsvpc requires careful planning. The change is not transparent to applications because the networking architecture changes fundamentally.

In bridge mode, applications often rely on localhost to communicate with other services on the same instance. A sidecar logging agent running on the same instance is accessible via `127.0.0.1:9999`. In awsvpc mode, that sidecar has its own IP address; localhost doesn't work across tasks. You'd need to use the sidecar's actual IP address or DNS name, which requires service discovery or configuration changes.

Additionally, applications in bridge mode sometimes bind to `0.0.0.0` on all available ports and rely on port mapping to control exposure. In awsvpc mode, binding to `0.0.0.0` exposes all ports on the task's IP address in the VPC. If you've previously relied on port mapping as a security boundary, you'll need to adjust your security group rules and potentially containerized application configurations.

The migration path typically involves creating new task definitions in awsvpc mode, gradually rolling out the new definitions in a canary or blue-green deployment, and monitoring for issues before fully deprecating bridge mode definitions. Given that Fargate requires awsvpc anyway, and that awsvpc is considered the modern standard, most teams make this migration a priority in their container infrastructure evolution.

### Performance Implications

A natural question is whether the per-task ENI model incurs performance overhead compared to bridge mode. The reality is that for most workloads, the difference is negligible. Each task still gets direct network connectivity through the instance's physical network card. The hypervisor's virtual network layer is optimized for this scenario, and ENI attachment overhead happens at task creation time, not during packet processing.

Where you might notice differences is in highly latency-sensitive workloads sending millions of packets per second, but these are rare and usually benefit from instance-level optimizations like enhanced networking anyway. For typical microservices, the performance difference is immeasurable.

What does change is resource utilization. Each ENI (or trunk ENI) consumes a small amount of instance memory for the hypervisor's tracking and configuration. With hundreds of tasks, this overhead becomes more noticeable, but it's still typically a small percentage of overall instance memory. More significant is the IP address consumption—if you run out of IP addresses in your subnet, you can't launch more tasks, even if compute resources remain available.

### Best Practices for awsvpc Deployments

Drawing from the concepts covered, several best practices emerge for operating ECS clusters with awsvpc networking.

First, plan IP address space generously. Know your expected task scale and allocate subnets with overhead. When capacity planning, assume you'll need more tasks than you currently estimate—growth always happens. If your cluster might grow to 200 tasks, ensure your subnets have at least 250 available addresses after accounting for other infrastructure.

Second, use ENI trunking if you're running many small tasks on modest instance types. The capacity multiplier is significant, and the operational overhead is minimal. Enable it from the start if you anticipate scaling; retrofitting is possible but requires careful instance management.

Third, establish a security group strategy before you have dozens of services. Define logical security groups (frontend, backend, data, cache-access) and apply them systematically through infrastructure-as-code. This consistency prevents sprawl and makes auditing easier.

Fourth, integrate VPC Flow Logs and CloudWatch monitoring into your observability strategy. The per-task IP model makes this possible; take advantage of it to build a clear picture of network behavior across your cluster.

Fifth, standardize on awsvpc mode even if you're only running on EC2 now. The compatibility with Fargate, the observability benefits, and the alignment with modern container orchestration make it the right choice. Don't let bridge mode's apparent simplicity tempt you into technical debt.

### Conclusion

The `awsvpc` networking mode represents a maturation in how ECS manages container networking. By giving each task its own network identity, ECS enables security practices, observability, and operational models that bridge mode simply can't match. Understanding this architectural choice and its implications—the ENI limits, the IP address planning requirements, and the solutions like ENI trunking—is essential for building scalable, secure container systems on AWS.

The per-task ENI model does introduce constraints that require thoughtful infrastructure planning. You can't infinitely pack tasks onto instances without considering network interface availability, and you must ensure your VPC has sufficient IP address space. But these constraints are manageable with proper design, and the benefits in security, observability, and operational flexibility far outweigh the planning effort. Whether you're building new ECS clusters or migrating from bridge mode, awsvpc should be your default choice, and ENI trunking should be your scaling strategy for high-density deployments.
