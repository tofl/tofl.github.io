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

{{< qcm >}}
[
{
"question": "A developer deploys a Lambda function inside a VPC in a private subnet. The function needs to fetch configuration data from AWS Secrets Manager. What is the MOST cost-effective way to enable this access?",
"answers": [
{
"answer": "Add a NAT Gateway in a public subnet and route outbound traffic through it.",
"isCorrect": false,
"explanation": "A NAT Gateway would work, but it incurs hourly charges plus per-GB data fees. For accessing AWS services like Secrets Manager from within a VPC, this is not the most cost-effective solution."
},
{
"answer": "Create an Interface Endpoint (PrivateLink) for Secrets Manager in the VPC.",
"isCorrect": true,
"explanation": "An Interface Endpoint powered by AWS PrivateLink allows the Lambda function to reach Secrets Manager privately within the AWS network, without routing through a NAT Gateway. This avoids NAT costs and is the recommended approach for most AWS services."
},
{
"answer": "Create a Gateway Endpoint for Secrets Manager in the VPC.",
"isCorrect": false,
"explanation": "Gateway Endpoints are only available for S3 and DynamoDB, not for Secrets Manager. You must use an Interface Endpoint (PrivateLink) for Secrets Manager."
},
{
"answer": "Move the Lambda function to a public subnet and assign it a public IP.",
"isCorrect": false,
"explanation": "Moving the function to a public subnet would expose it unnecessarily to the internet. It also defeats the purpose of running it in a VPC for network isolation."
}
]
},
{
"question": "Which of the following statements correctly describe the difference between Security Groups and Network ACLs (NACLs)? (Select TWO)",
"answers": [
{
"answer": "Security Groups are stateful; return traffic is automatically allowed.",
"isCorrect": true,
"explanation": "Security Groups are stateful: if inbound traffic on a port is allowed, the corresponding response traffic is automatically permitted outbound without an explicit rule."
},
{
"answer": "NACLs are stateful; you only need to define inbound rules.",
"isCorrect": false,
"explanation": "NACLs are stateless, not stateful. Both inbound and outbound rules must be explicitly defined, as they are evaluated independently."
},
{
"answer": "NACLs apply at the subnet level and evaluate rules in numbered order.",
"isCorrect": true,
"explanation": "NACLs operate at the subnet level and process rules in ascending numerical order, stopping at the first matching rule. This is different from Security Groups, which evaluate all rules together."
},
{
"answer": "Security Groups apply at the subnet level.",
"isCorrect": false,
"explanation": "Security Groups are attached to individual resources (EC2 instances, Lambda functions, RDS instances, etc.), not to subnets. NACLs are the subnet-level control."
},
{
"answer": "By default, a Security Group denies all inbound traffic.",
"isCorrect": false,
"explanation": "This is partially correct — Security Groups do deny all inbound by default — but the statement is listed here alongside other false ones. The key distinction tested is statefulness and scope, not just defaults."
}
]
},
{
"question": "A company runs an ECS task in a private subnet. The task must download OS patches from the internet but must NOT be directly reachable from the internet. What should the developer configure?",
"answers": [
{
"answer": "Attach an Internet Gateway directly to the private subnet's route table.",
"isCorrect": false,
"explanation": "Routing a private subnet directly to an Internet Gateway would make it a public subnet, exposing resources to inbound internet traffic — which violates the requirement."
},
{
"answer": "Place a NAT Gateway in a public subnet and add a route from the private subnet to the NAT Gateway.",
"isCorrect": true,
"explanation": "A NAT Gateway in a public subnet allows resources in a private subnet to initiate outbound internet connections while blocking inbound connections initiated from the internet — exactly the described requirement."
},
{
"answer": "Create a VPC Gateway Endpoint for the patch repository.",
"isCorrect": false,
"explanation": "Gateway Endpoints only support S3 and DynamoDB. They cannot be used to reach arbitrary internet endpoints such as OS patch repositories."
},
{
"answer": "Enable VPC Flow Logs and configure an inbound deny rule.",
"isCorrect": false,
"explanation": "VPC Flow Logs are a diagnostic tool for capturing traffic metadata — they don't control routing or traffic access."
}
]
},
{
"question": "A developer sets up a VPC with CIDR block 10.0.0.0/16. They create a subnet with CIDR 10.0.1.0/24. Which statement about this subnet is true?",
"answers": [
{
"answer": "The subnet spans all Availability Zones in the region.",
"isCorrect": false,
"explanation": "Subnets are tied to a single Availability Zone. It is the VPC itself that spans all AZs in a region."
},
{
"answer": "The subnet is public by default because it has a routable CIDR block.",
"isCorrect": false,
"explanation": "A subnet is public only if it has a route to an Internet Gateway. The CIDR block alone does not determine public vs. private status."
},
{
"answer": "The subnet resides in a single Availability Zone and provides up to 256 IP addresses.",
"isCorrect": true,
"explanation": "A /24 CIDR block provides 256 addresses, and each subnet is tied to exactly one Availability Zone. (AWS reserves 5 addresses per subnet, so 251 are usable in practice.)"
},
{
"answer": "The VPC CIDR and subnet CIDR can overlap with other VPCs without issue.",
"isCorrect": false,
"explanation": "Overlapping CIDR blocks cause problems, especially when peering VPCs. Peered VPCs must have non-overlapping CIDR ranges."
}
]
},
{
"question": "VPC A is peered with VPC B. VPC B is peered with VPC C. A resource in VPC A tries to communicate with a resource in VPC C using private IPs. What will happen?",
"answers": [
{
"answer": "The traffic will route through VPC B automatically.",
"isCorrect": false,
"explanation": "VPC Peering is non-transitive. Traffic does not flow through an intermediate VPC — there is no automatic transit routing."
},
{
"answer": "The communication will fail because VPC Peering is non-transitive.",
"isCorrect": true,
"explanation": "VPC Peering connections are not transitive. VPC A can only communicate with VPC B, and VPC B can communicate with VPC C, but VPC A cannot reach VPC C unless a direct peering is established between them."
},
{
"answer": "The traffic will be routed over the public internet.",
"isCorrect": false,
"explanation": "VPC Peering uses private IP addresses within the AWS network. There is no internet routing involved — but the connection between A and C simply doesn't exist without a direct peering."
},
{
"answer": "The communication will succeed if both VPCs are in the same AWS account.",
"isCorrect": false,
"explanation": "Being in the same account does not change the non-transitive nature of VPC Peering. A direct peering between VPC A and VPC C is required regardless of account."
}
]
},
{
"question": "Which two AWS services are supported by VPC Gateway Endpoints? (Select TWO)",
"answers": [
{
"answer": "Amazon S3",
"isCorrect": true,
"explanation": "S3 is one of the two services that support Gateway Endpoints. Using one is free and keeps S3 traffic within the AWS network, eliminating NAT Gateway costs."
},
{
"answer": "Amazon DynamoDB",
"isCorrect": true,
"explanation": "DynamoDB is the other service that supports Gateway Endpoints. Like S3, it is free and recommended for any VPC workload accessing DynamoDB."
},
{
"answer": "Amazon SQS",
"isCorrect": false,
"explanation": "SQS is not supported by Gateway Endpoints. It requires an Interface Endpoint (PrivateLink), which has an hourly cost."
},
{
"answer": "AWS Secrets Manager",
"isCorrect": false,
"explanation": "Secrets Manager requires an Interface Endpoint, not a Gateway Endpoint. Gateway Endpoints are exclusively for S3 and DynamoDB."
},
{
"answer": "Amazon SNS",
"isCorrect": false,
"explanation": "SNS also requires an Interface Endpoint. Only S3 and DynamoDB are supported by the free Gateway Endpoint type."
}
]
},
{
"question": "A developer notices that a Lambda function deployed inside a VPC cannot connect to an RDS instance in the same VPC. VPC Flow Logs show that the traffic is being rejected. What is the MOST likely cause?",
"answers": [
{
"answer": "The Lambda function is in a public subnet and RDS is in a private subnet.",
"isCorrect": false,
"explanation": "Subnet type alone does not prevent communication within the same VPC. The rejection is more specifically about access control rules, not subnet visibility."
},
{
"answer": "The Security Group attached to the RDS instance does not allow inbound traffic from the Lambda function's Security Group.",
"isCorrect": true,
"explanation": "Security Groups are the primary access control mechanism at the resource level. If the RDS Security Group doesn't allow inbound traffic on the database port from the Lambda's Security Group (or IP range), connections will be rejected — which is what the Flow Logs would show."
},
{
"answer": "VPC Flow Logs are blocking the traffic.",
"isCorrect": false,
"explanation": "VPC Flow Logs only capture metadata about traffic — they do not filter or block any traffic. They are a diagnostic tool only."
},
{
"answer": "A NAT Gateway is required for Lambda to communicate with RDS within the same VPC.",
"isCorrect": false,
"explanation": "A NAT Gateway is for outbound internet access from private subnets. Resources within the same VPC communicate directly using private IPs — no NAT Gateway is needed."
}
]
},
{
"question": "What is captured by VPC Flow Logs?",
"answers": [
{
"answer": "The full packet payload of all traffic traversing the VPC.",
"isCorrect": false,
"explanation": "VPC Flow Logs capture only metadata — not packet payloads. You can see that traffic was blocked, but not the contents of the packets."
},
{
"answer": "Metadata about IP traffic including source/destination IPs, ports, protocol, and whether traffic was accepted or rejected.",
"isCorrect": true,
"explanation": "Flow Logs record traffic metadata: source IP, destination IP, port, protocol, packet/byte count, and the accept/reject decision. This is sufficient to diagnose most network misconfigurations."
},
{
"answer": "Application-layer logs such as HTTP request headers and response bodies.",
"isCorrect": false,
"explanation": "VPC Flow Logs operate at the network (IP) layer, not the application layer. HTTP-level details require application logs or tools like AWS WAF logs."
},
{
"answer": "Only rejected traffic — accepted traffic is not logged.",
"isCorrect": false,
"explanation": "VPC Flow Logs capture both accepted and rejected traffic. You can filter by action in the logs, but both types are recorded by default."
}
]
},
{
"question": "A company wants to connect its on-premises data center to AWS with consistent low latency, high throughput, and without traversing the public internet due to compliance requirements. Which solution should they use?",
"answers": [
{
"answer": "Site-to-Site VPN",
"isCorrect": false,
"explanation": "Site-to-Site VPN creates an encrypted tunnel over the public internet. While encrypted, it still traverses the internet, which does not meet the requirement of avoiding the public internet. Latency is also variable."
},
{
"answer": "AWS Direct Connect",
"isCorrect": true,
"explanation": "AWS Direct Connect establishes a dedicated private physical connection between the on-premises network and AWS, bypassing the public internet entirely. It provides consistent low latency and high throughput — ideal for compliance-sensitive or high-bandwidth workloads."
},
{
"answer": "VPC Peering",
"isCorrect": false,
"explanation": "VPC Peering connects two AWS VPCs, not an on-premises network to AWS. It cannot be used to bridge a physical data center to the cloud."
},
{
"answer": "NAT Gateway",
"isCorrect": false,
"explanation": "A NAT Gateway enables outbound internet access from private subnets within AWS. It does not connect on-premises networks to AWS."
}
]
},
{
"question": "A developer wants to allow a Lambda function in a private subnet to access S3 without incurring NAT Gateway costs. What is the recommended solution?",
"answers": [
{
"answer": "Move the Lambda function to a public subnet.",
"isCorrect": false,
"explanation": "Moving to a public subnet exposes the function unnecessarily and doesn't follow the best practice of keeping Lambda in private subnets when placed in a VPC."
},
{
"answer": "Create a Gateway Endpoint for S3 in the VPC.",
"isCorrect": true,
"explanation": "Gateway Endpoints for S3 are free and route S3 traffic entirely within the AWS network, eliminating the need for a NAT Gateway and its associated data processing costs."
},
{
"answer": "Create an Interface Endpoint for S3 in the VPC.",
"isCorrect": false,
"explanation": "While an Interface Endpoint for S3 exists and works, Gateway Endpoints for S3 are the preferred and free alternative. Interface Endpoints carry an hourly cost per AZ."
},
{
"answer": "Peer the VPC with an S3-dedicated VPC.",
"isCorrect": false,
"explanation": "S3 is a managed AWS service, not a VPC resource. VPC Peering is used to connect two customer VPCs, not to access AWS managed services."
}
]
},
{
"question": "Which of the following are TRUE about VPC Peering? (Select TWO)",
"answers": [
{
"answer": "VPC Peering supports connections across different AWS accounts and regions.",
"isCorrect": true,
"explanation": "VPC Peering works across AWS accounts and across regions (inter-region peering), which makes it common in multi-account or multi-region architectures."
},
{
"answer": "Peered VPCs can share the same CIDR block as long as subnets don't overlap.",
"isCorrect": false,
"explanation": "The CIDR blocks of peered VPCs must not overlap at all. Overlapping CIDRs will prevent the peering connection from being established."
},
{
"answer": "VPC Peering is non-transitive — routing does not pass through an intermediate VPC.",
"isCorrect": true,
"explanation": "Peering connections are point-to-point and non-transitive. If A peers with B and B peers with C, A cannot reach C without a direct A-to-C peering."
},
{
"answer": "Once peered, all traffic between VPCs is automatically allowed without configuring Security Groups.",
"isCorrect": false,
"explanation": "VPC Peering establishes network connectivity, but Security Groups and NACLs still control which traffic is allowed. You must update the relevant Security Groups to permit cross-VPC traffic."
}
]
},
{
"question": "What makes a subnet 'public' in an AWS VPC?",
"answers": [
{
"answer": "It has a name that includes the word 'public'.",
"isCorrect": false,
"explanation": "The subnet name has no functional significance. AWS does not treat subnets differently based on naming."
},
{
"answer": "It contains resources that have public IP addresses.",
"isCorrect": false,
"explanation": "Assigning a public IP to a resource is not sufficient. Without a route to an Internet Gateway in the subnet's route table, the resource is still not reachable from or able to reach the internet."
},
{
"answer": "Its route table contains a route to an Internet Gateway.",
"isCorrect": true,
"explanation": "A subnet is considered public when its route table has a route directing internet-bound traffic (0.0.0.0/0) to an Internet Gateway. This is the defining characteristic — not naming, IP assignment, or any other attribute."
},
{
"answer": "It is located in the default VPC.",
"isCorrect": false,
"explanation": "While the default VPC does come with public subnets pre-configured, being in the default VPC is not what makes a subnet public. The route table route to an IGW is what matters."
}
]
},
{
"question": "A developer needs to block all traffic from a specific IP range (e.g., a known malicious CIDR) across an entire subnet, regardless of Security Group rules. Which tool should they use?",
"answers": [
{
"answer": "Security Group with a deny rule for the IP range.",
"isCorrect": false,
"explanation": "Security Groups do not support explicit deny rules — they are allow-only. You can only remove allow rules; you cannot add a deny. NACLs support explicit deny rules."
},
{
"answer": "Network ACL (NACL) with a deny rule for the IP range.",
"isCorrect": true,
"explanation": "NACLs operate at the subnet level, support explicit deny rules, and are evaluated before traffic reaches any resource. They are the appropriate tool for broad subnet-wide IP blocks."
},
{
"answer": "VPC Flow Logs with a filter for the IP range.",
"isCorrect": false,
"explanation": "VPC Flow Logs are a passive diagnostic tool — they record traffic metadata but do not block or filter traffic."
},
{
"answer": "Remove the Internet Gateway from the VPC.",
"isCorrect": false,
"explanation": "Removing the IGW would cut internet access for all public subnets in the VPC — a far too broad action that affects all traffic, not just the target IP range."
}
]
},
{
"question": "A developer is reviewing an architecture diagram and sees 'Virtual Private Gateway' mentioned. What context does this most likely indicate?",
"answers": [
{
"answer": "The architecture uses VPC Peering between two VPCs.",
"isCorrect": false,
"explanation": "VPC Peering does not use a Virtual Private Gateway. Peering is established directly between two VPCs."
},
{
"answer": "The architecture includes a Site-to-Site VPN connection between on-premises and AWS.",
"isCorrect": true,
"explanation": "A Virtual Private Gateway is the AWS-side endpoint of a Site-to-Site VPN connection. It terminates the IPsec tunnel coming from the on-premises router."
},
{
"answer": "The architecture uses AWS Direct Connect.",
"isCorrect": false,
"explanation": "Direct Connect uses a Direct Connect Gateway or a Virtual Interface — not necessarily a Virtual Private Gateway in the same sense. The Virtual Private Gateway is specifically associated with Site-to-Site VPN."
},
{
"answer": "The architecture uses a NAT Gateway for outbound internet access.",
"isCorrect": false,
"explanation": "A NAT Gateway is a separate concept for enabling outbound internet access from private subnets. It is unrelated to Virtual Private Gateways."
}
]
},
{
"question": "Where are VPC Flow Logs delivered? (Select TWO)",
"answers": [
{
"answer": "Amazon CloudWatch Logs",
"isCorrect": true,
"explanation": "CloudWatch Logs is one of the two supported destinations for VPC Flow Logs, allowing log querying and alerting via CloudWatch."
},
{
"answer": "Amazon S3",
"isCorrect": true,
"explanation": "S3 is the other supported destination. Storing logs in S3 is useful for long-term retention and querying with tools like Amazon Athena."
},
{
"answer": "Amazon DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is not a supported destination for VPC Flow Logs. Only CloudWatch Logs and S3 are supported."
},
{
"answer": "AWS CloudTrail",
"isCorrect": false,
"explanation": "CloudTrail records API calls, not network traffic metadata. It is a separate service and not a destination for Flow Logs."
}
]
}
]
{{< /qcm >}}