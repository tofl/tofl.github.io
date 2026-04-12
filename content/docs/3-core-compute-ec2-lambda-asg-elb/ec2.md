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

{{< qcm >}}
[
{
"question": "A company runs a large Hadoop cluster that needs fault isolation between groups of nodes, but expects hundreds of instances per group. Which EC2 placement group strategy should a developer use?",
"answers": [
{
"answer": "Cluster placement group",
"isCorrect": false,
"explanation": "Cluster placement groups pack instances onto the same physical rack for lowest latency, but provide no fault isolation — a rack failure affects all instances. This doesn't meet the requirement."
},
{
"answer": "Spread placement group",
"isCorrect": false,
"explanation": "Spread placement groups provide the highest fault isolation (each instance on a distinct rack), but are limited to 7 instances per AZ — far too few for a large Hadoop cluster."
},
{
"answer": "Partition placement group",
"isCorrect": true,
"explanation": "Partition placement groups divide instances across logical partitions (up to 7 per AZ), each on separate racks, and support hundreds of instances per partition. This is the intended pattern for large distributed systems like Hadoop, Cassandra, and Kafka."
},
{
"answer": "No placement group — let AWS distribute instances automatically",
"isCorrect": false,
"explanation": "Without a placement group, AWS makes no guarantees about fault isolation between node groups. For a large distributed system where fault domain control matters, a partition placement group is the right choice."
}
]
},
{
"question": "A developer needs to run a batch rendering workload that is fault-tolerant and can be restarted if interrupted. The team wants to minimize EC2 costs as much as possible. Which purchasing option is most appropriate?",
"answers": [
{
"answer": "On-Demand Instances",
"isCorrect": false,
"explanation": "On-Demand is the most expensive per-hour option and offers no discount. While flexible, it's not cost-optimal for a workload that can tolerate interruptions."
},
{
"answer": "Reserved Instances",
"isCorrect": false,
"explanation": "Reserved Instances are best for steady-state, predictable workloads committed over 1 or 3 years. A batch rendering job doesn't justify a long-term commitment and wouldn't maximize the RI benefit."
},
{
"answer": "Spot Instances",
"isCorrect": true,
"explanation": "Spot Instances use unused EC2 capacity at up to 90% off On-Demand pricing. They can be reclaimed by AWS with a 2-minute warning, making them ideal for fault-tolerant, interruptible workloads like batch rendering or CI pipelines."
},
{
"answer": "Dedicated Hosts",
"isCorrect": false,
"explanation": "Dedicated Hosts are the most expensive option and are intended for compliance requirements or software licenses tied to physical hardware. They are not appropriate for cost-optimized batch workloads."
}
]
},
{
"question": "An EC2 instance running a web server needs to allow HTTPS traffic from the internet. A developer adds an inbound rule on port 443 to the instance's security group. Do they also need to add an outbound rule to allow the response traffic?",
"answers": [
{
"answer": "Yes, an explicit outbound rule on port 443 must be added for the response to reach the client.",
"isCorrect": false,
"explanation": "Security groups are stateful. Return traffic for an allowed inbound connection is automatically permitted without needing a separate outbound rule."
},
{
"answer": "No, because security groups are stateful and automatically allow response traffic for permitted inbound connections.",
"isCorrect": true,
"explanation": "Security group statefulness means that if inbound traffic on port 443 is allowed, the corresponding outbound response is automatically permitted. No additional outbound rule is needed."
}
]
},
{
"question": "A developer wants every new EC2 instance launched in a fleet to have Apache installed, started, and enabled automatically, without any manual steps after launch. What is the simplest AWS-native way to accomplish this?",
"answers": [
{
"answer": "Use an Elastic IP to remotely run install commands after launch.",
"isCorrect": false,
"explanation": "Elastic IPs are static public IP addresses — they have nothing to do with automating software installation on instances."
},
{
"answer": "Provide a User Data bootstrap script that installs and starts Apache on first launch.",
"isCorrect": true,
"explanation": "EC2 User Data runs a script automatically on the very first launch of an instance, executed as root. This is the standard, simplest mechanism for automating post-launch configuration such as installing packages and starting services."
},
{
"answer": "Create a security group rule that triggers the installation.",
"isCorrect": false,
"explanation": "Security groups are virtual firewalls that control network traffic. They cannot execute commands or install software on instances."
},
{
"answer": "Modify the instance type to a compute-optimized family to enable auto-configuration.",
"isCorrect": false,
"explanation": "Instance type families determine hardware characteristics (CPU, memory, etc.). They have no effect on software installation or instance configuration."
}
]
},
{
"question": "A company runs a production database on EC2 and must ensure the instance's data persists across stops and reboots. Which storage option should be used for the database volume?",
"answers": [
{
"answer": "EC2 Instance Store",
"isCorrect": false,
"explanation": "Instance Store is ephemeral — data is lost when the instance stops, terminates, or the underlying hardware fails. It is unsuitable for any data that must persist."
},
{
"answer": "Amazon EBS (Elastic Block Store)",
"isCorrect": true,
"explanation": "EBS is a persistent, network-attached block storage volume. Data survives instance stops and reboots, making it the correct choice for database volumes or any data that must be durable."
}
]
},
{
"question": "A developer is analyzing EC2 purchasing options for a workload that runs continuously 24/7 and has predictable, steady resource requirements over the next three years. Which option provides the best cost savings?",
"answers": [
{
"answer": "On-Demand Instances",
"isCorrect": false,
"explanation": "On-Demand is the most flexible but most expensive option per hour. For a steady, long-running workload, it results in significantly higher costs than commitment-based options."
},
{
"answer": "Spot Instances",
"isCorrect": false,
"explanation": "Spot Instances are cheapest but can be interrupted with only a 2-minute warning. A 24/7 production workload cannot tolerate arbitrary interruptions."
},
{
"answer": "Reserved Instances with a 3-year term",
"isCorrect": true,
"explanation": "Reserved Instances offer up to 72% savings over On-Demand when committed for 1 or 3 years. For a steady-state, predictable workload running continuously, a 3-year RI provides the maximum cost benefit."
},
{
"answer": "Dedicated Hosts",
"isCorrect": false,
"explanation": "Dedicated Hosts are required for specific software licensing or compliance needs. Without such a requirement, they are more expensive than Reserved Instances and not cost-optimal for a standard workload."
}
]
},
{
"question": "Which of the following statements about EC2 Security Groups are correct? (Select TWO)",
"answers": [
{
"answer": "Security groups support both allow and deny rules.",
"isCorrect": false,
"explanation": "Security groups are allow-only. There is no concept of a deny rule — traffic not explicitly permitted is simply dropped."
},
{
"answer": "Security groups can reference other security groups as traffic sources instead of IP ranges.",
"isCorrect": true,
"explanation": "This is a common and important pattern. For example, you can allow inbound traffic from 'the load balancer's security group' rather than hardcoding specific IP addresses, making rules more dynamic and maintainable."
},
{
"answer": "An instance can belong to multiple security groups, and their rules are combined.",
"isCorrect": true,
"explanation": "Multiple security groups can be attached to a single instance. The effective rule set is the union of all groups — if any group permits traffic, it is allowed."
},
{
"answer": "Security group rule changes take effect only after the instance is restarted.",
"isCorrect": false,
"explanation": "Security group changes take effect immediately — no instance restart is required."
}
]
},
{
"question": "A developer needs SSH access to a production EC2 instance without opening port 22 or distributing private key files, while also ensuring all sessions are logged for auditing. What should they use?",
"answers": [
{
"answer": "Connect using an Elastic IP and a standard SSH client.",
"isCorrect": false,
"explanation": "An Elastic IP is a static public IP address. Using it with a standard SSH client still requires port 22 to be open and private key management — neither requirement is met."
},
{
"answer": "Use AWS Systems Manager Session Manager.",
"isCorrect": true,
"explanation": "Session Manager provides browser-based or CLI shell access to EC2 instances without opening port 22, without managing key pairs, and with built-in session logging for auditability. This is the modern, recommended pattern for secure instance access."
},
{
"answer": "Add an inbound rule on port 22 scoped to the developer's IP address.",
"isCorrect": false,
"explanation": "While narrowing port 22 access to a specific IP is a best practice improvement, it still requires opening port 22 and managing private keys. It does not meet the no-port-22, no-key-file requirements."
},
{
"answer": "Attach the instance to a Cluster placement group to enable secure internal access.",
"isCorrect": false,
"explanation": "Placement groups control physical distribution of instances for latency or fault tolerance. They have no effect on SSH access methods or security."
}
]
},
{
"question": "An AMI has been created in us-east-1. A developer needs to launch instances from the same AMI in eu-west-1. What must be done?",
"answers": [
{
"answer": "Nothing — AMIs are global resources and are automatically available in all regions.",
"isCorrect": false,
"explanation": "AMIs are region-specific, not global. An AMI created in one region is not automatically available in another."
},
{
"answer": "Copy the AMI to eu-west-1, then launch instances from the copied AMI.",
"isCorrect": true,
"explanation": "AMIs are region-specific but can be copied across regions using the 'Copy AMI' feature. Once copied to eu-west-1, it can be used to launch instances there."
},
{
"answer": "Share the AMI with a different AWS account in eu-west-1.",
"isCorrect": false,
"explanation": "Sharing an AMI with another account still doesn't make it available in a different region. Region is an independent concern from account sharing."
},
{
"answer": "Launch the instance in us-east-1 and migrate it to eu-west-1.",
"isCorrect": false,
"explanation": "There is no native 'migrate instance' feature between regions. The correct approach for multi-region AMI reuse is to copy the AMI to the target region."
}
]
},
{
"question": "A developer is setting up a temporary high-performance computing (HPC) job that requires sub-millisecond latency between nodes. Which EC2 placement group type should they choose?",
"answers": [
{
"answer": "Cluster",
"isCorrect": true,
"explanation": "Cluster placement groups pack instances onto the same physical rack within a single AZ, providing the lowest possible network latency and highest throughput between instances. This is the correct choice for tightly-coupled HPC workloads requiring sub-millisecond communication."
},
{
"answer": "Spread",
"isCorrect": false,
"explanation": "Spread placement groups prioritize fault isolation by placing each instance on distinct hardware. This increases physical distance between nodes, which is the opposite of what low-latency HPC requires."
},
{
"answer": "Partition",
"isCorrect": false,
"explanation": "Partition placement groups balance fault isolation with scale. They are designed for large distributed systems needing fault domain control, not for the lowest possible inter-node latency."
}
]
},
{
"question": "A developer needs a static public IP address for an EC2 instance so that DNS records pointing to it remain valid even if the instance is replaced. What should they use?",
"answers": [
{
"answer": "A default public IP assigned at launch",
"isCorrect": false,
"explanation": "Default public IPs assigned at launch are dynamic — they change every time the instance stops and restarts. They cannot be relied upon for stable DNS mappings."
},
{
"answer": "An Elastic IP (EIP)",
"isCorrect": true,
"explanation": "An Elastic IP is a static public IPv4 address that you allocate to your account. It remains associated with your account until you release it, and can be remapped to a different instance in case of failure — keeping DNS records valid."
},
{
"answer": "A security group with a fixed IP rule",
"isCorrect": false,
"explanation": "Security groups control traffic rules, not IP address assignment. They cannot provide a static public IP."
},
{
"answer": "An instance store volume",
"isCorrect": false,
"explanation": "Instance store is an ephemeral local storage option, completely unrelated to IP address management."
}
]
},
{
"question": "An EC2 instance is hibernated. Which of the following correctly describes what happens to the instance's state?",
"answers": [
{
"answer": "All in-memory (RAM) contents are lost, and the instance cold-boots when resumed.",
"isCorrect": false,
"explanation": "This describes a standard stop/start, not hibernation. Hibernation specifically preserves in-memory state by writing it to disk."
},
{
"answer": "RAM contents are saved to the EBS root volume, the instance stops, and on restart memory is restored so processes resume where they left off.",
"isCorrect": true,
"explanation": "This is exactly how EC2 Hibernate works. The in-memory state is written to the encrypted EBS root volume before the instance stops. On restart, the RAM contents are reloaded and processes resume without a full reboot cycle."
},
{
"answer": "The instance is paused in place with memory preserved on the host — no data is written to EBS.",
"isCorrect": false,
"explanation": "Memory is not preserved in-place on the host during hibernation. It is explicitly written to the EBS root volume so it can survive the instance being fully stopped."
},
{
"answer": "Hibernate copies RAM contents to an S3 bucket for durability.",
"isCorrect": false,
"explanation": "Hibernate writes RAM contents to the EBS root volume, not to S3. The root volume must be encrypted and large enough to hold the RAM contents."
}
]
},
{
"question": "A workload needs an EC2 instance with a very large amount of RAM to run an in-memory database. Which instance family is best suited for this requirement?",
"answers": [
{
"answer": "C family (e.g., c7g)",
"isCorrect": false,
"explanation": "The C family is compute-optimized, featuring a high CPU-to-memory ratio. It is not designed for workloads that require large amounts of RAM."
},
{
"answer": "T family (e.g., t3)",
"isCorrect": false,
"explanation": "The T family offers burstable, general-purpose performance suitable for dev/test or variable workloads. It does not provide the large memory footprint needed for in-memory databases."
},
{
"answer": "R family (e.g., r7g)",
"isCorrect": true,
"explanation": "The R family (along with X and Z) is memory-optimized, providing large amounts of RAM. These are the correct instance families for in-memory databases, caching layers, and real-time analytics."
},
{
"answer": "I family (e.g., i4i)",
"isCorrect": false,
"explanation": "The I family is storage-optimized, offering high sequential read/write throughput for workloads like data warehousing. It is not specifically designed for large in-memory workloads."
}
]
},
{
"question": "A software vendor requires their application to run on hardware where physical cores and sockets can be tracked for licensing compliance. Which EC2 purchasing option fulfills this requirement?",
"answers": [
{
"answer": "Spot Instances",
"isCorrect": false,
"explanation": "Spot Instances run on shared, unallocated capacity with no control over physical placement. They cannot guarantee single-tenant hardware or visibility into physical cores/sockets."
},
{
"answer": "Reserved Instances",
"isCorrect": false,
"explanation": "Reserved Instances provide a billing discount for committed usage but do not guarantee dedicated physical hardware. Instances may still share physical hosts with other customers."
},
{
"answer": "Dedicated Hosts",
"isCorrect": true,
"explanation": "Dedicated Hosts give you a physical server fully allocated to your account, with visibility into its physical cores, sockets, and host ID. This is required for software licenses tied to physical hardware (e.g., Windows Server per-core, Oracle DB) and for compliance mandating single-tenant infrastructure."
},
{
"answer": "Savings Plans",
"isCorrect": false,
"explanation": "Savings Plans offer flexible cost savings based on a committed spend rate, but like Reserved Instances, they don't provide dedicated physical hardware."
}
]
},
{
"question": "Which of the following are true about EC2 User Data? (Select TWO)",
"answers": [
{
"answer": "User Data scripts run on every instance reboot by default.",
"isCorrect": false,
"explanation": "By default, User Data runs only once — on the very first launch of the instance. It does not re-execute on subsequent reboots unless explicitly configured to do so."
},
{
"answer": "User Data is executed as the root user.",
"isCorrect": true,
"explanation": "User Data scripts run with root privileges, which is why they can perform administrative tasks like installing packages and starting system services."
},
{
"answer": "User Data adds to the overall launch time of an instance since it runs before the instance becomes available.",
"isCorrect": true,
"explanation": "User Data executes at boot time, before the instance is reported as ready. Complex or long-running scripts will extend the time it takes for an instance to become available."
},
{
"answer": "User Data scripts are limited to 100 lines of bash.",
"isCorrect": false,
"explanation": "There is no line limit for User Data scripts. The only constraint is a 16 KB size limit for the User Data content."
}
]
}
]
{{< /qcm >}}