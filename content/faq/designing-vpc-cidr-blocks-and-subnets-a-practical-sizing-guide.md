---
title: "Designing VPC CIDR Blocks and Subnets: A Practical Sizing Guide"
---

## Designing VPC CIDR Blocks and Subnets: A Practical Sizing Guide

When you first create an Amazon VPC, you make a choice that ripples through your entire infrastructure: the CIDR block. It sounds like a simple decision, but get it wrong and you'll face painful refactoring months down the line. Too small, and you'll run out of IP addresses when your application scales. Too large, and you waste address space while introducing unnecessary complexity. This guide walks you through the real-world decisions you need to make when designing your VPC's network topology.

### Understanding CIDR Notation and IP Address Allocation

Before diving into VPC-specific considerations, let's ground ourselves in CIDR notation, which you'll use constantly when designing network architecture. CIDR stands for Classless Inter-Domain Routing, and it's a compact way to express an IP address range along with the number of available addresses.

The notation looks like this: `10.0.0.0/16`. The number after the slash—the prefix length—tells you how many of the 32 bits in an IPv4 address are fixed as the network portion. A `/16` means the first 16 bits are fixed, leaving 16 bits variable for host addresses. That gives you 2^16 minus some reserved addresses, or roughly 65,536 total IP addresses.

Here's the practical relationship: each increment in the prefix length cuts the available addresses in half. So a `/17` has half the addresses of a `/16`, a `/18` has half of a `/17`, and so on. This relationship is crucial when you're dividing a larger network into smaller subnets.

### RFC 1918 Private Address Ranges: Your Starting Point

AWS VPCs must use private IP addresses as defined in RFC 1918. You have three ranges to choose from, each with different sizes:

The first range is `10.0.0.0/8`, which provides over 16 million addresses. This is the largest private range and is ideal for large enterprises or organizations expecting significant growth. The `/8` prefix means only the first 8 bits are fixed, giving you enormous flexibility.

The second range is `172.16.0.0/12`, providing roughly 1 million addresses. This middle-ground option is suitable for medium-sized organizations or divisions within a larger company.

The third range is `192.168.0.0/16`, which offers about 65,000 addresses. This is the most constrained but still sufficient for many smaller deployments or organizations with a single primary VPC.

Most AWS practitioners start with a `/16` block from one of these ranges because it strikes a balance between having enough addresses to grow into while remaining manageable. A `/16` gives you roughly 65,000 addresses to work with—plenty for public subnets, private application tiers, data tiers, and future expansion. When you're just starting out, you'll rarely need to consume all of those addresses, but they're there if you need them.

The key decision here is forward-looking: which range should you pick if you're building infrastructure for an organization that might span multiple VPCs across different regions or AWS accounts? Many teams pick `10.0.0.0/8` and then allocate progressively smaller blocks to different regions or business units. For example, you might use `10.1.0.0/16` for your primary region in the us-east-1 region, `10.2.0.0/16` for us-west-2, and `10.3.0.0/16` for eu-west-1. This strategy makes cross-VPC peering straightforward and leaves no ambiguity about which addresses belong where.

### AWS Reserved IP Addresses: The Hidden Tax

Here's something that surprises many developers: AWS reserves five IP addresses in every subnet for its own use, and these are never available for your instances or containers. Understanding this is critical for accurate capacity planning.

In any subnet, AWS reserves:
- The first address (the network address)
- The second address (reserved by AWS for the VPC router)
- The third address (reserved by AWS for DNS)
- The fourth address (reserved for future AWS use)
- The last address (the broadcast address)

Let's say you create a subnet with a `/24` CIDR block (`10.0.1.0/24`). In standard CIDR math, a `/24` provides 256 addresses (2^8). But after AWS's five reservations, you're left with 251 usable addresses. For a `/25` subnet, you'd have 128 total addresses minus five reserved, leaving 123 usable. This pattern holds across all subnet sizes.

This becomes important when you're capacity planning. If you expect to run 250 EC2 instances in a single subnet, a `/24` won't quite fit—you'd need something slightly larger like a `/23` to account for the reserved addresses. In practice, many teams build extra buffer into their sizing to avoid this trap.

### Non-Overlapping CIDR Blocks: A Non-Negotiable Rule

One of the hardest-to-fix mistakes in AWS networking is choosing overlapping CIDR blocks. Once you've created a VPC and started peering it with other VPCs or connecting it to on-premises infrastructure via AWS Direct Connect or a VPN, changing the VPC CIDR becomes nearly impossible.

The core rule is simple: no two networks that communicate with each other can have overlapping CIDR blocks. If you're planning to peer VPC A (`10.0.0.0/16`) with VPC B, then VPC B cannot use anything in the `10.0.0.0/16` range. Even a small overlap like `10.0.5.0/24` would be a problem—when traffic destined for that range tries to route, the system won't know which VPC to use.

This constraint extends beyond your AWS VPCs. If you have an on-premises data center using `10.0.0.0/8` internally, and you want to connect it to AWS via Direct Connect or a site-to-site VPN, your VPCs cannot use that same range. You'd need to pick `172.16.0.0/12` or `192.168.0.0/16` instead.

Many large enterprises manage this by maintaining a central "IP address registry"—essentially a spreadsheet or database tracking which CIDR blocks are allocated to which VPCs, environments, and regions. It sounds bureaucratic, but it prevents the kind of panicked emergency replatforming that happens when someone accidentally creates a VPC in the same range as a critical peering partner.

### Architecting Subnets Across Availability Zones and Application Tiers

Once you've chosen your VPC CIDR block, the next decision is how to carve it up into subnets. Most real-world VPC designs follow a tiered approach with multiple subnets spread across different availability zones for redundancy.

Let's walk through a concrete example. You're designing a VPC in the `10.0.0.0/16` range for a three-tier application (web, application, database) and you want redundancy across two availability zones. You might allocate like this:

For availability zone us-east-1a, you'd create a public subnet (`10.0.1.0/24` for web tier), a private application subnet (`10.0.11.0/24`), and a private data subnet (`10.0.21.0/24`). For availability zone us-east-1b, you'd mirror this structure with slightly different addresses: public subnet (`10.0.2.0/24`), private application subnet (`10.0.12.0/24`), and private data subnet (`10.0.22.0/24`).

This design ensures traffic can be distributed across AZs for fault tolerance, and it cleanly separates network concerns. Load balancers sit in the public subnets, application servers sit in the private application tier, and databases sit in the most restricted private data tier. Each tier can have different security group rules appropriate to its function.

The `/24` choice here is deliberate. With five IPs reserved by AWS, you get 251 usable addresses per subnet. For small to medium deployments, this is comfortable. If you're running three EC2 instances plus a few NAT instances in a public subnet, you're nowhere near capacity. The real constraint is usually not IP addresses but rather the availability zone topology itself—you can only have one subnet per AZ per VPC CIDR block, so you need to plan how many AZs you'll use upfront.

If you're designing for a larger application, you might use `/23` subnets (506 usable addresses each) or even `/22` subnets (2,046 usable addresses each) to give yourself more breathing room. The math is straightforward: a `/16` can accommodate sixteen `/20` subnets, or thirty-two `/21` subnets, or sixty-four `/22` subnets, and so on. You're trading off the number of subnets you can create against the size of each individual subnet.

### Practical Sizing for Growth

The question of "how big should my subnets be" depends on your growth trajectory and deployment model. Let's consider a few scenarios.

If you're building a traditional EC2-based architecture where each instance gets a single elastic network interface with one or a few IP addresses, then `/24` subnets often work well. You might have dozens of instances across a subnet, but you're not hitting the IP address limit unless you're scaling to hundreds of instances in a single tier.

But here's where it gets interesting: if you're using container services like Amazon ECS or Amazon EKS, or deploying AWS Fargate tasks, your IP consumption can be much higher. Each container often gets its own ENI (or in Fargate's case, shares an ENI with a few other containers from the same task), meaning you burn through addresses faster. If you're planning to run 500 Fargate tasks in a single AZ, and each task consumes one IP address, you'll need subnets with hundreds of available addresses. A `/24` would be dangerously tight; you'd want to scale up to `/22` or larger.

Similarly, AWS Lambda functions don't consume IP addresses when they run in the default Lambda environment, but if you're configuring them to run within a VPC (which is necessary when they need to access private databases or other VPC resources), they do consume addresses. Orchestrating hundreds of concurrent Lambda invocations across VPC subnets can strain address availability if you haven't sized properly.

A practical rule of thumb: calculate your current peak concurrent workload in terms of IP-consuming resources (EC2 instances, container tasks, or any other resource that requires an ENI), multiply that by 1.5 to 2 for growth buffer, and then choose a subnet size that comfortably accommodates that number while leaving plenty of headroom. If you expect 100 concurrent tasks, aim for a subnet with 500+ usable addresses, not just 100.

### Using Secondary CIDR Blocks for Expansion

Sometimes you design a VPC beautifully with a `/16` block, deploy it successfully, and then realize two years later that you're approaching the limits. Rather than the nuclear option of creating a new VPC and migrating everything, AWS lets you add secondary CIDR blocks to an existing VPC.

A secondary CIDR block is exactly what it sounds like: an additional network range associated with the same VPC. If your primary VPC uses `10.0.0.0/16`, you could add `10.1.0.0/16` as a secondary block. All instances in the VPC, whether they're in subnets from the primary block or the secondary block, can communicate freely.

The advantage is continuity. Your existing infrastructure keeps working; you're just expanding the address space available for new subnets. The disadvantage is complexity—you now have two disjointed ranges, and any external systems peering with your VPC need to accept routes for both ranges. VPC peering connections can actually map multiple CIDR blocks, so it's not a showstopper, but it's additional operational overhead.

In practice, secondary CIDR blocks are a band-aid. They work, but they're a sign that initial sizing wasn't quite right. A better approach is to choose a large enough primary CIDR block upfront—even if you don't use all of it immediately—rather than painting yourself into a corner.

### Peering and Hybrid Connectivity Constraints

When your VPC needs to communicate with other VPCs, on-premises networks, or other AWS resources, the non-overlapping CIDR rule becomes your primary constraint. But there are other architectural considerations worth understanding.

VPC peering connections are simple point-to-point relationships between two VPCs. If you peer VPC A with VPC B, instances in VPC A can communicate with instances in VPC B as if they're on the same network (subject to security groups and network ACLs). This requires that the CIDR blocks don't overlap. If you're planning a hub-and-spoke topology—one central VPC peered with many satellite VPCs—you need to ensure that all satellite VPCs use different, non-overlapping ranges.

For on-premises connectivity, the constraints are similar but the stakes are higher. If you're connecting your AWS VPC to your data center via a site-to-site VPN or AWS Direct Connect, the on-premises network and the VPC must have non-overlapping ranges. If your data center uses `10.0.0.0/8` (a common choice), then all your AWS VPCs must use either `172.16.0.0/12` or `192.168.0.0/16`. This is a fundamental architectural decision that affects all your VPCs in all regions.

Some organizations handle this elegantly by using AWS Transit Gateway, a hub-and-spoke service that simplifies managing connections between multiple VPCs and on-premises networks. But even Transit Gateway can't solve the overlapping CIDR problem—the addresses still have to be unique.

### Choosing Between Public and Private Subnets

Understanding your subnet architecture also means deciding which subnets are public and which are private. A public subnet has a route to the internet via an internet gateway; instances in a public subnet can initiate outbound traffic to the internet and receive inbound traffic from it (if security groups permit). A private subnet has no direct internet route; traffic destined for the internet is routed through a NAT gateway or NAT instance in a public subnet.

This distinction doesn't affect your CIDR block choice—both public and private subnets can use any valid RFC 1918 range. But it does affect your operational model. Public subnets are places where you're okay with instances receiving traffic directly from the internet (load balancers, bastion hosts, NAT gateways). Private subnets are where you put application servers and databases that shouldn't be directly exposed.

Many teams find it helpful to use different `/24` ranges for public and private subnets within the same AZ, just to make the intent clear. For example, in us-east-1a, you might use `10.0.1.0/24` for public subnets and `10.0.11.0/24` for private application subnets. In us-east-1b, you'd use `10.0.2.0/24` and `10.0.12.0/24`. The numbering scheme makes it obvious which subnet serves which purpose.

### Practical Example: Designing a Multi-Tier VPC

Let's put this all together with a concrete example. You're designing a VPC for a production application with the following requirements:

You expect to deploy across three availability zones for high availability. You need separate tiers for web servers, application servers, and databases. You expect significant growth over the next two years, including potential migration of workloads from your on-premises data center.

You'd start by choosing a primary CIDR block. Since you're planning for growth, `10.0.0.0/16` is a solid choice—it gives you 65,536 addresses to work with and leaves the `10.1.0.0/16` and beyond ranges available for secondary blocks or future VPCs.

Next, you'd divide the `/16` into subnets. With three AZs and three tiers, you need at least nine subnets. If you use `/22` subnets, you get sixteen of them from your `/16` block, which leaves breathing room for future expansion. Your allocation might look like:

us-east-1a: public (`10.0.0.0/22`), private app (`10.0.4.0/22`), private data (`10.0.8.0/22`)
us-east-1b: public (`10.0.12.0/22`), private app (`10.0.16.0/22`), private data (`10.0.20.0/22`)
us-east-1c: public (`10.0.24.0/22`), private app (`10.0.28.0/22`), private data (`10.0.32.0/22`)

Each `/22` gives you roughly 4,094 usable addresses, plenty for most application tiers. You've used nine subnets out of sixteen available, leaving room for additional tiers or AZs without needing secondary CIDR blocks.

### Documentation and Governance

Here's something often overlooked: once you've designed your VPC topology, document it clearly and maintain that documentation as the infrastructure evolves. The best VPC design in the world becomes a liability if no one remembers why the subnets are sized the way they are, or which ranges are reserved for future use.

Create a simple spreadsheet or database tracking your VPC CIDR blocks, subnet assignments, and the purpose of each subnet. Include planned future uses—if you know you'll be adding a fourth AZ or a new application tier in six months, mark the CIDR ranges you're reserving for it.

If you're managing VPCs across an organization, establish a naming and numbering convention that scales. Use a consistent pattern like `10.{region-code}.{tier-code}.0/24` or similar, so anyone looking at an IP address can intuit what it's for. This saves hours of debugging and prevents careless mistakes.

### Conclusion

Designing a VPC CIDR block and subnet architecture is one of the foundational decisions in AWS infrastructure, and it's one that's difficult to change after the fact. The key principles are straightforward: choose from RFC 1918 ranges, size generously for growth, ensure non-overlapping ranges with any networks you'll peer or connect to, account for AWS's five reserved IPs per subnet, and distribute subnets across availability zones for redundancy.

The real art lies in balancing current needs with future growth, and in resisting the urge to optimize for space at the expense of flexibility. A `/16` block with some subnets left unallocated is far preferable to one packed densely with no room to expand. And if you do find yourself constrained despite careful planning, secondary CIDR blocks are available as an escape hatch—they're not ideal, but they're better than starting over.

With a well-designed VPC topology in place, the rest of your AWS architecture becomes easier to build and manage. Your security groups, network ACLs, and routing policies all work more smoothly when you've chosen address ranges that truly match your application's needs.
