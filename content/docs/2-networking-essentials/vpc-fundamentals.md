---
title: "3. VPC Fundamentals"
type: docs
weight: 1
---

## VPC Fundamentals

Amazon Virtual Private Cloud (VPC) lets you launch AWS resources inside a logically isolated virtual network that you define. Think of it as your own private data center within AWS — you control the IP address ranges, subnets, routing, and access rules. The core problem it solves is **network isolation**: without a VPC, your resources would be exposed on a flat shared network. With a VPC, you decide what's reachable from the internet, what's reachable only internally, and what can talk to what.

As a developer, you don't need to become a network engineer — but you *do* need a solid mental model of VPC to deploy Lambda functions inside a private network, connect to RDS instances securely, or understand why your ECS task can't reach the internet. That's exactly the scope this section covers. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)

### VPCs, Subnets, and CIDR Blocks

A **VPC** is a regional resource — it spans all Availability Zones in a region. When you create one, you assign it a **CIDR block**: a range of private IP addresses (e.g., `10.0.0.0/16`), which gives you 65,536 addresses to carve up.

Inside your VPC, you create **subnets**, each tied to a single Availability Zone. A subnet is just a smaller slice of your VPC's CIDR block — for example, `10.0.1.0/24` (256 addresses). Subnets come in two flavors:

- **Public subnets** — have a route to an Internet Gateway (explained below), so resources inside them can be reached from, or reach out to, the internet. This is where you'd put a load balancer or a bastion host.
- **Private subnets** — have no direct route to the internet. This is where you put databases, internal services, and Lambda functions that don't need public exposure. They're isolated by default.

The practical rule is simple: **anything you don't want exposed to the internet belongs in a private subnet.** [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)

### Security Groups vs. NACLs

These are your two layers of traffic filtering, and the key distinction is **stateful vs. stateless**.

**Security Groups** act as virtual firewalls attached to individual resources (EC2 instances, Lambda functions, RDS instances, etc.). They are **stateful**: if you allow inbound traffic on port 443, the response traffic is automatically allowed out — you don't need a separate outbound rule. You define rules in terms of protocols, ports, and sources (IP ranges or other security groups). Security groups are your primary, most-used tool for controlling access. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)

**Network ACLs (NACLs)** operate at the subnet level and are **stateless**: inbound and outbound rules are evaluated independently, so you must explicitly allow both directions. NACLs are evaluated before traffic even reaches a resource, making them useful for broad subnet-wide blocks (e.g., blocking an entire IP range). In practice, most developers rarely touch NACLs — Security Groups handle the majority of access control needs. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)

| | Security Group | NACL |
|---|---|---|
| Applies to | Resource (instance, function…) | Subnet |
| Stateful? | ✅ Yes | ❌ No |
| Default | Deny all inbound, allow all outbound | Allow all |
| Rule evaluation | All rules evaluated | Rules evaluated in order (numbered) |

### Internet Gateway vs. NAT Gateway

These two components solve different halves of the same problem: getting traffic in or out of your VPC.

An **Internet Gateway (IGW)** is attached to your VPC and enables **bidirectional** communication between resources in a *public* subnet and the internet. A resource in a public subnet (with a public IP) can receive inbound connections and initiate outbound ones. This is what makes a subnet "public" — without a route to an IGW, the subnet is private regardless of what you call it. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)

A **NAT Gateway** lives in a *public* subnet and solves a specific problem: **resources in a private subnet need to make outbound requests to the internet** (e.g., a Lambda function downloading a package, or an EC2 instance pulling updates) **without being reachable from the internet themselves.** Traffic flows outward through the NAT Gateway, which translates the private IP to its own public IP — but inbound connections initiated from the internet are blocked. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)

A common pattern:
- Public subnet → Internet Gateway → internet (load balancers, bastion hosts)
- Private subnet → NAT Gateway (in public subnet) → internet (Lambda, RDS, ECS tasks making outbound calls)

> **Cost note:** NAT Gateways carry an hourly charge plus per-GB data processing fees. A Lambda function in a VPC that only needs to reach AWS services (S3, DynamoDB) should use VPC Endpoints instead — covered next.

### VPC Endpoints — Accessing AWS Services Without the Internet

By default, when your code in a private subnet calls `s3.amazonaws.com`, that request travels out through a NAT Gateway to the public internet and back — adding latency and cost. **VPC Endpoints** solve this by letting traffic to supported AWS services stay entirely within the AWS network. [🔗](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)

There are two types:

- **Gateway Endpoints** — available only for **S3 and DynamoDB**. Free to use. You add them to your VPC's route table and traffic is automatically redirected. This is the most common endpoint type developers encounter when running Lambda or ECS in a VPC.
- **Interface Endpoints** (powered by AWS PrivateLink) — available for most other AWS services (SQS, SNS, Secrets Manager, API Gateway, etc.). They create an Elastic Network Interface (ENI) with a private IP in your subnet. There is an hourly cost per endpoint per AZ. [🔗](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)

The practical takeaway: **always set up a Gateway Endpoint for S3 and DynamoDB** when your workload runs in a VPC — it's free and eliminates unnecessary NAT traffic.

### VPC Flow Logs

When something network-related breaks — a Lambda can't reach RDS, a container can't pull an image — **VPC Flow Logs** are your first diagnostic tool. They capture metadata about IP traffic flowing through your VPC: source/destination IPs, ports, protocol, whether the traffic was accepted or rejected, and more. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)

Flow Logs can be enabled at the VPC, subnet, or individual network interface level, and logs are sent to **CloudWatch Logs** or **S3**. Note that they capture metadata — not packet payloads — so they tell you *that* traffic was blocked, not *what* was in it. This is usually enough to diagnose a misconfigured Security Group or NACL.

### VPC Peering

**VPC Peering** creates a private network connection between two VPCs, allowing resources in either VPC to communicate using private IP addresses — as if they were on the same network. This is useful when you have separate VPCs per environment (dev/prod) or per team and need them to talk to each other. [🔗](https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html)

A few important constraints to keep in mind:

- Peering is **non-transitive**: if VPC A peers with VPC B, and VPC B peers with VPC C, VPC A cannot reach VPC C through B — you'd need a direct peering between A and C.
- CIDR blocks of peered VPCs **must not overlap** — plan your address ranges upfront.
- Peering works **across accounts and regions**, which makes it common in multi-account architectures.

### Site-to-Site VPN & Direct Connect (Conceptual Awareness)

These two services connect your on-premises network to your AWS VPC — relevant when a company has existing data centers or offices that need access to AWS resources.

- **Site-to-Site VPN** creates an encrypted IPsec tunnel over the public internet between your on-premises router and an AWS Virtual Private Gateway. Quick to set up, lower cost, but bandwidth is limited and latency is variable (it still traverses the internet). [🔗](https://docs.aws.amazon.com/vpn/latest/s2svpn/VPC_VPN.html)
- **AWS Direct Connect** is a dedicated private physical connection between your premises and AWS — bypassing the public internet entirely. Higher throughput, consistent latency, better for large data transfers or compliance requirements, but takes weeks to provision and is significantly more expensive. [🔗](https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html)

As a developer, you're unlikely to configure either — that's infrastructure/ops territory. What matters is recognizing the terms when they appear in architecture diagrams or exam questions, and understanding the core trade-off: **VPN = fast to set up, internet-based; Direct Connect = dedicated, private, higher performance.**