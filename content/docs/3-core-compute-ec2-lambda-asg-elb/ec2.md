---
title: "5. EC2"
type: docs
weight: 1
---

## EC2 (Elastic Compute Cloud)

Amazon EC2 (Elastic Compute Cloud) [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html) is AWS's service for renting virtual servers in the cloud. Before managed compute services like Lambda existed, every application needed a server — EC2 is that server, virtualized and billed by the second. Understanding EC2 gives you the mental model for what higher-level services like Lambda are actually abstracting away: OS management, patching, capacity planning, and runtime configuration.

For the DVA-C02 exam, EC2 is foundational context rather than the primary focus. That said, several EC2 concepts — security groups, IAM roles on instances, and purchasing options — appear regularly in scenario questions.

---

### Instance Types and Families

EC2 instances come in families optimized for different workloads [🔗](https://aws.amazon.com/ec2/instance-types/). The naming convention follows a pattern like `m7g.large`: the letter(s) indicate the family, the number is the generation, and the suffix is the size.

- **General purpose** (`t`, `m`) — balanced CPU/memory; `t` instances are burstable (useful for dev/test workloads with variable load)
- **Compute optimized** (`c`) — high CPU-to-memory ratio; suited for batch processing, gaming servers, HPC
- **Memory optimized** (`r`, `x`, `z`) — large RAM; suited for in-memory databases, caching layers, real-time analytics
- **Storage optimized** (`i`, `d`, `h`) — high sequential read/write throughput; suited for data warehousing, distributed file systems
- **Accelerated computing** (`p`, `g`, `inf`) — GPUs or custom chips; suited for ML inference and training

For the exam, you don't need to memorize every family — focus on recognizing which family fits a described workload.

### AMIs (Amazon Machine Images)

An AMI [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html) is a pre-configured template that defines the OS, software, and configuration baked into an instance at launch. Think of it as a snapshot of a server's root volume plus metadata.

AMIs can be:
- **AWS-provided** — standard Amazon Linux 2, Ubuntu, Windows Server images
- **AWS Marketplace** — pre-built commercial or community images (e.g., a pre-configured NGINX or database appliance)
- **Custom** — you build and register your own; useful for "golden image" patterns where every instance in your fleet starts from an identical, pre-hardened baseline

AMIs are region-specific but can be copied across regions. When you launch an instance, you select an AMI — from that point forward the instance is a running copy of that template.

### EC2 User Data

User Data [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html) is a bootstrap script that runs once on the very first launch of an instance, executed as `root`. This is where you automate post-launch setup: installing packages, pulling application code, starting services, or registering the instance with a configuration management tool.

A typical User Data script for an Amazon Linux 2 instance:

```bash
#!/bin/bash
yum update -y
yum install -y httpd
systemctl start httpd
systemctl enable httpd
echo "<h1>Hello from EC2</h1>" > /var/www/html/index.html
```

User Data runs at boot time before the instance is available, so it adds to launch time. For more complex configuration management at scale, tools like AWS Systems Manager or third-party tools (Ansible, Chef) are preferred — but User Data is the simplest entry point and appears in exam scenarios about automating instance configuration.

### Instance Purchasing Options

EC2 offers several purchasing models [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-purchasing-options.html) that trade flexibility for cost savings.

- **On-Demand** — pay per second, no commitment. Use for unpredictable workloads or short-lived tasks. Most expensive per hour but zero lock-in.
- **Reserved Instances (RI)** — commit to a 1 or 3-year term for a specific instance type and region; up to 72% cheaper than On-Demand. Best for steady-state production workloads. Convertible RIs allow changing instance families at a lower discount.
- **Savings Plans** — a more flexible alternative to RIs; commit to a spend rate ($/hour) rather than a specific instance type. [🔗](https://aws.amazon.com/savingsplans/)
- **Spot Instances** — bid for unused EC2 capacity; up to 90% cheaper than On-Demand. AWS can reclaim the instance with a 2-minute warning. Use for fault-tolerant, stateless, or interruptible workloads (batch jobs, CI pipelines, rendering).
- **Dedicated Hosts** — a physical server fully allocated to you. Required for software licenses tied to physical cores/sockets (e.g., Windows Server, Oracle DB), or for compliance requirements mandating single-tenant hardware.

For the exam, the key decision points are: *predictable workload → Reserved/Savings Plans*, *interruptible batch work → Spot*, *strict licensing/compliance → Dedicated Host*.

### Security Groups

A Security Group [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html) is a **stateful** virtual firewall applied at the instance (ENI) level. "Stateful" means that if you allow inbound traffic on a port, the corresponding outbound response is automatically permitted — you don't need a separate outbound rule for it.

Key behaviors to internalize:
- Security groups are **allow-only** — there is no concept of a deny rule. Traffic not explicitly allowed is dropped.
- They can reference other security groups as sources, not just IP ranges. This is a common pattern: allow traffic from "the load balancer's security group" rather than hardcoding IPs.
- Changes take effect immediately.
- An instance can have multiple security groups; the rules are unioned together.

Security groups are distinct from Network ACLs (NACLs), which are stateless and operate at the subnet level — NACLs are covered under the VPC topic.

### Key Pairs and SSH Access

EC2 uses asymmetric key pairs [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html) for SSH authentication on Linux instances (and for decrypting the Administrator password on Windows). AWS stores the public key; you download the private key (`.pem`) once at creation time — it cannot be retrieved again.

In practice, directly SSH-ing into production instances is increasingly replaced by **AWS Systems Manager Session Manager** [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html), which provides browser-based shell access without opening port 22 or managing key files. This pattern appears in exam questions about secure, auditable instance access.

### Elastic IPs

By default, an EC2 instance gets a public IP that changes every time it stops and restarts. An **Elastic IP (EIP)** [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html) is a static public IPv4 address you allocate to your account and associate with an instance or network interface. This lets you mask instance failures by remapping the EIP to a replacement instance.

EIPs are free while associated with a *running* instance — AWS charges for EIPs that are allocated but unattached, to discourage hoarding of scarce IPv4 addresses. In modern architectures, EIPs are often unnecessary because load balancers provide stable DNS endpoints instead.

### EC2 Instance Store vs EBS

EC2 instances need storage, and there are two fundamentally different options:

**EC2 Instance Store** [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/InstanceStorage.html) is physically attached to the host machine. It offers very high I/O throughput and low latency, but it is **ephemeral** — data is lost when the instance stops, terminates, or the underlying hardware fails. Use it for temporary data: caches, buffers, scratch space.

**Amazon EBS (Elastic Block Store)** [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AmazonEBS.html) is a network-attached, persistent block storage volume. Data survives instance stops and reboots. EBS volumes can be snapshotted to S3, resized, and detached/reattached to different instances (within the same AZ). The root volume of most instances is EBS by default.

The exam distinction is simple: if data must survive instance termination → EBS. If you need maximum raw disk performance for temporary data → Instance Store.

### Placement Groups

Placement groups [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/placement-groups.html) control how EC2 instances are physically distributed across the underlying hardware, giving you influence over latency and fault tolerance.

- **Cluster** — packs instances onto the same physical rack in a single AZ. Lowest possible network latency and highest throughput between instances. The trade-off: if the rack fails, all instances are affected. Use for HPC, tightly-coupled distributed computing, or any workload that needs sub-millisecond inter-node communication.
- **Spread** — places each instance on distinct underlying hardware (different racks, each with its own power and network). Limits you to 7 instances per AZ per group. Use for small numbers of critical instances that must not share a point of failure (e.g., primary + replicas of a database cluster).
- **Partition** — divides instances across logical partitions, each on separate racks, within one or more AZs. Up to 7 partitions per AZ, hundreds of instances per partition. Use for large distributed systems (Hadoop, Cassandra, Kafka) where you want fault isolation between node groups but don't need every instance on its own rack.

### Hibernate

EC2 Hibernate [🔗](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html) lets you pause an instance and resume it later in the exact same state. When you hibernate, the in-memory (RAM) contents are written to the EBS root volume, and the instance stops. On restart, memory is reloaded, processes resume, and the instance appears never to have stopped.

This is useful when you need to preserve application state across interruptions without a full reboot and re-initialization cycle. Key constraint: the root EBS volume must be large enough to hold the RAM contents, and it must be encrypted. Hibernate is not supported for instances with more than 150 GB of RAM.