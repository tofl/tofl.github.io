---
title: "Security Group Best Practices: Referencing Other Security Groups vs CIDR Ranges"
---

## Security Group Best Practices: Referencing Other Security Groups vs CIDR Ranges

When you're building applications on AWS, security groups become one of your primary tools for controlling network traffic. Yet many developers treat them as an afterthought, pasting in CIDR ranges without much thought and hoping everything works. The reality is that well-designed security groups scale with your infrastructure, adapt as your architecture evolves, and prevent entire classes of configuration mistakes. The key insight that separates novice and experienced AWS developers is understanding when and how to reference security groups themselves rather than hardcoding IP ranges.

This article explores security group design patterns that will make your infrastructure more maintainable, flexible, and robust. We'll walk through the philosophy behind these patterns, examine concrete scenarios, and discuss the practical limits you'll encounter as your systems grow.

### Understanding Security Groups: The Foundation

Before diving into best practices, let's establish what security groups actually do. A security group is a stateful firewall that controls inbound and outbound traffic for AWS resources, primarily EC2 instances but also RDS databases, Lambda functions in VPCs, and other services. Each rule specifies a protocol, port range, and crucially, a source or destination for traffic.

This third element—the source or destination—is where most developers make their first mistake. When you create a rule, you must specify *where* traffic comes from (for inbound rules) or goes to (for outbound rules). AWS gives you several options: you can specify an IP address, a CIDR block like `10.0.1.0/24`, or you can reference another security group directly. That last option is powerful, and it's the pattern that separates pragmatic infrastructure from fragile infrastructure.

### The CIDR Range Approach: Simple But Fragile

Let's start with the traditional approach: using CIDR ranges. Imagine you're building a three-tier web application with web servers, application servers, and a database. You might create rules like this:

On your application tier security group, you add an inbound rule allowing traffic from `10.0.1.0/24` (your web tier subnet) on port 8080. On your database security group, you add an inbound rule allowing traffic from `10.0.2.0/24` (your application tier subnet) on port 5432.

This works fine in a static, unchanging environment. But real infrastructure is anything but static. What happens when you need to scale your application tier across multiple subnets? You'd need to update that database security group rule to include `10.0.3.0/24`, then `10.0.4.0/24` when you add another AZ. What if you decide to refactor your subnets? You're back in the security group rules making changes.

More problematically, CIDR-based rules create blast radius problems. That CIDR block you specified might contain many instances, not all of which should have database access. You're relying on proper subnet design and instance placement to enforce security, rather than letting the security group itself be the boundary. If someone accidentally launches an instance in the wrong subnet, they might get unintended access.

### The Security Group Reference Approach: Dynamic and Scalable

Now contrast that with security group referencing. Instead of allowing traffic from a CIDR range, you allow traffic from another security group. This seems simple on its surface, but the implications are profound.

Let's reframe that same three-tier application: On your database security group, you add a single inbound rule that says "allow traffic on port 5432 from any instance that has the application tier security group attached." That's it. Now, you can launch application servers in any subnet you want, across any number of availability zones, and they'll automatically have database access—simply by virtue of having that security group attached. No rule updates needed.

The magic here is that security groups are dynamic. When you attach a security group to an EC2 instance, that instance immediately gains all the permissions defined in that group. When you launch five more instances in a different subnet and attach the same security group, they gain access too. There's no configuration lag, no forgotten updates to CIDR blocks, no coordinating changes across multiple rules.

Consider the practical workflow difference. With CIDR-based security groups, if you want to add a new application server cluster in a different subnet, you must:

1. Create or identify the subnet and its CIDR block
2. Identify which security groups need updating
3. Add a new rule or modify existing rules
4. Document the change
5. Coordinate with anyone who might be affected

With security group references, you simply:

1. Attach the existing security group to the new instances
2. Done

### When and Why to Reference Security Groups

Security group referencing shines in several architectural patterns. **Multi-tier architectures** are the most obvious case. Your web tier security group should reference your application tier security group, and your application tier should reference your database security group. Each layer grants access only to the layer below it (or to specific downstream services), creating a clear, maintainable permission hierarchy.

**Cross-tier communication** is another natural fit. If your caching layer (say, ElastiCache) needs to be accessed by both your application servers and batch processors, you can add inbound rules to the cache security group that reference both the app server and batch processor security groups, rather than trying to find a CIDR block that encompasses both.

**Load balancer to target** communication is an excellent use case. Your network or application load balancer lives in a security group, and your target instances live in another. Rather than figuring out the load balancer's IP address or subnet CIDR, you simply add a rule that allows traffic from the load balancer's security group to the target group's security group on the relevant port. This stays correct even if the load balancer scales or changes IP addresses.

**Self-referential rules** are surprisingly useful too. If you want instances within a security group to communicate with each other (for clustering, for instance), you can add a rule that references the security group to itself. An inbound rule allowing traffic on port 9300 from the same security group means any two instances with that group attached can discover and communicate with each other, regardless of their IP addresses or which subnet they land in.

### CIDR Ranges: When They Make Sense

That said, CIDR ranges aren't wrong—they're just the right tool for different scenarios. If you're allowing traffic from outside your VPC, you often have no choice. Traffic from your office network, from a partner's infrastructure, or from the public internet generally requires CIDR notation. You can't reference a security group that doesn't exist in your VPC.

You might also use CIDR ranges for specific regulatory or compliance scenarios where you need to document that access is restricted to certain IP ranges. Some organizations prefer the explicitness of CIDR blocks in their compliance documentation, even if it requires more operational overhead.

Additionally, if you're building infrastructure that integrates with on-premises systems or third-party services with static IP addresses, CIDR rules might be more practical than security group references. For example, if a third-party API provider gives you a set of IPs they'll be calling from, adding those as inbound rules using CIDR notation makes perfect sense.

The key is recognizing the tradeoff: CIDR ranges give you precision about *who* gets access but at the cost of operational flexibility. Security group references give you flexibility and maintainability but work best within your AWS infrastructure.

### Outbound Rules: The Often-Forgotten Half

Many developers focus entirely on inbound security group rules and largely ignore outbound rules. This is understandable—in many cases, the default security group in a VPC allows all outbound traffic, so instances can reach out to anything. But relying on this default creates significant security risks.

Consider a scenario where your application is compromised. If outbound rules are unrestricted, an attacker can potentially exfiltrate data, download malware, or pivot to other systems. A properly designed security group should define both what traffic *can* come in and what traffic *can* go out, following the principle of least privilege.

For your application tier, you probably want to allow outbound traffic only to your database (port 5432), your cache (port 6379), any APIs you call (port 443), and DNS (port 53). You should explicitly deny everything else. This requires being thoughtful during design—you need to know all the destinations your application will reach before you write rules—but it pays dividends in security posture.

Again, security group references shine here. Instead of specifying outbound CIDR ranges, you create a rule that allows your application tier security group to reach your database security group on port 5432. Same benefits: dynamic, scalable, automatically correct.

### Security Group Limits and Scaling Considerations

As your infrastructure grows, you'll eventually encounter AWS limits. Understanding these limits helps you design your security group strategy accordingly.

Each security group can contain up to 120 inbound rules and 120 outbound rules. This is per security group, so in a large organization, you need to think carefully about rule organization. Rather than throwing every possible rule into a single monolithic security group, create purpose-built groups: one for your web tier, one for your app tier, one for your database tier. This keeps rule counts manageable and makes the security posture more transparent.

Each EC2 instance can have up to five security groups attached. This is usually plenty; you rarely need more than two or three. A common pattern is to have a tier-specific group (e.g., "application-tier") and a service-specific group (e.g., "payment-processing-tier") allowing you to layer permissions.

Each elastic network interface (ENI) can be associated with up to five security groups, and each network interface on an instance is a separate ENI. Most instances have one ENI, but some workloads create multiple network interfaces, so it's good to keep in mind.

A security group can contain up to 60 inbound or outbound rules that reference other security groups. This is a softer limit than the overall rule count, and it's specifically about cross-group references. In practice, you're unlikely to hit this unless you're doing something unusual. This limit encourages you to design security groups with clear layering rather than creating a tangled web of cross-references.

### Default vs. Custom Security Groups

When you create a VPC, AWS automatically creates a default security group. By default, this group allows all inbound traffic from instances with the same security group attached and allows all outbound traffic to anywhere. Many developers use this default group for testing and development, then later realize they've been running everything with overly permissive rules.

The best practice is straightforward: never rely on the default security group in production. Create custom security groups with explicit rules tailored to your architecture. Even for development and non-production environments, it's worth building the discipline of defining purpose-built security groups.

A common pattern is to have a baseline security group that all instances belong to—perhaps one that allows outbound DNS and NTP (for keeping time synchronized) and SSH or RDP from bastion hosts. Then, layer on additional security groups that are role-specific. An instance might have both the "baseline" group and the "application-tier" group attached, inheriting rules from both.

### Designing Security Groups for Multi-Tier Architectures

Let's walk through a concrete example of how you'd design security groups for a typical three-tier web application. We'll assume you're building a content management system with a web tier, an application tier, and a database tier, all in a private VPC.

**Web Tier Security Group (`web-sg`):**
- Inbound: Allow HTTP (port 80) and HTTPS (port 443) from `0.0.0.0/0` (the entire internet)
- Inbound: Allow SSH (port 22) from your bastion host security group
- Outbound: Allow traffic to the application tier security group on port 8080
- Outbound: Allow traffic to the internet on port 443 (for any external APIs)
- Outbound: Allow DNS (port 53) to `0.0.0.0/0`

**Application Tier Security Group (`app-sg`):**
- Inbound: Allow traffic on port 8080 from the web tier security group
- Inbound: Allow SSH (port 22) from your bastion host security group
- Outbound: Allow traffic to the database security group on port 5432
- Outbound: Allow traffic to any cache security group on port 6379
- Outbound: Allow DNS (port 53) to `0.0.0.0/0`
- Outbound: Allow traffic to the internet on port 443 (for external APIs)

**Database Tier Security Group (`db-sg`):**
- Inbound: Allow traffic on port 5432 from the application tier security group
- Inbound: Allow traffic on port 5432 from the bastion host security group (for admin access)
- Outbound: Typically restricted; databases usually don't need to initiate outbound connections

**Bastion Host Security Group (`bastion-sg`):**
- Inbound: Allow SSH (port 22) from your office CIDR range or from wherever your operators connect
- Outbound: Allow SSH (port 22) to all other security groups in your VPC

Notice how this design uses security group references wherever possible. The web tier doesn't need to know about the application tier's IP addresses or subnets; it just references the security group. The database security group trusts the application tier implicitly. If you decide to scale the application tier across new subnets or AZs, the database doesn't care. If you need to upgrade from a small instance type to a larger one (which might change its IP), the connectivity still works.

### Common Pitfalls and How to Avoid Them

**Pitfall One: Forgetting Outbound Rules**

Developers often assume outbound traffic is unrestricted (which is true by default but shouldn't be in production). They define inbound rules carefully and then forget about outbound, leaving the default "allow all" in place. The fix is simple: treat outbound rules with the same rigor as inbound. Define exactly what each tier needs to reach, and restrict everything else.

**Pitfall Two: Mixing CIDR and Security Group References Without Clarity**

Some teams use both approaches inconsistently, sometimes referencing security groups, sometimes using CIDR blocks. This creates confusion and makes rules harder to audit. Establish a team standard: prefer security group references within your VPC, use CIDR blocks for external traffic. Document the rationale.

**Pitfall Three: Over-Permissive Rules to "Just Make It Work"**

Under time pressure, it's tempting to allow broad traffic (e.g., allowing all traffic on all ports from `0.0.0.0/0`). This "works" temporarily but creates security risks and technical debt. Fight this urge. Take the extra five minutes to define precise rules. You'll be grateful later.

**Pitfall Four: Creating a Single Monolithic Security Group**

Some organizations create one massive security group and attach it to everything. This defeats the purpose of security groups and makes auditing nearly impossible. Embrace the principle of least privilege: create multiple, layered security groups with clear purposes.

**Pitfall Five: Assuming Circular Dependencies Work**

You can't have circular dependencies in security group rules (e.g., SG-A referencing SG-B inbound, and SG-B referencing SG-A inbound, expecting them to communicate). This is a common misconception. Security group references create one-directional trust. If A needs to reach B, B must allow inbound traffic from A. If B also needs to reach A, A must also have an inbound rule allowing B. It's not a mutual agreement; it's two separate permissions.

**Pitfall Six: Forgetting About Load Balancers**

When using a load balancer, many developers accidentally restrict traffic at the security group level in a way that prevents the load balancer from reaching its targets. The solution is to ensure your target security group has an inbound rule allowing traffic from the load balancer's security group on the relevant port. This is a classic setup mistake that causes hours of debugging.

### Implementing Security Groups via Infrastructure as Code

For anything beyond quick experimentation, use infrastructure as code to define your security groups. This makes them version-controlled, auditable, and reproducible. Whether you're using Terraform, CloudFormation, or the AWS CDK, the principle is the same: express your security group rules declaratively.

Here's a conceptual example using CloudFormation syntax:

```yaml
WebSecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: "Security group for web tier"
    VpcId: !Ref MyVPC
    SecurityGroupIngress:
      - IpProtocol: tcp
        FromPort: 80
        ToPort: 80
        CidrIp: 0.0.0.0/0
      - IpProtocol: tcp
        FromPort: 443
        ToPort: 443
        CidrIp: 0.0.0.0/0
    SecurityGroupEgress:
      - IpProtocol: tcp
        FromPort: 8080
        ToPort: 8080
        DestinationSecurityGroupId: !Ref AppSecurityGroup

AppSecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: "Security group for application tier"
    VpcId: !Ref MyVPC
    SecurityGroupIngress:
      - IpProtocol: tcp
        FromPort: 8080
        ToPort: 8080
        SourceSecurityGroupId: !Ref WebSecurityGroup
    SecurityGroupEgress:
      - IpProtocol: tcp
        FromPort: 5432
        ToPort: 5432
        DestinationSecurityGroupId: !Ref DatabaseSecurityGroup
```

Notice how the rules reference security group IDs rather than hardcoding IPs or CIDR blocks. If you later decide to change subnets or add new instances, your infrastructure definition remains valid. This is the power of treating infrastructure as code: your security rules become part of your version control history, and you can track why decisions were made.

### Testing and Auditing Your Security Groups

Once you've defined your security groups, how do you verify they're working correctly? There are several approaches. The most straightforward is to use the EC2 console to review your rules visually, but this doesn't scale well and is error-prone.

A more robust approach is to write tests. Many teams use tools like Terraform test, AWS Config rules, or custom Lambda functions to verify that security groups match expected policies. For example, you might have a test that verifies "the database security group only allows inbound traffic from the application tier security group" or "no security group allows SSH from `0.0.0.0/0`."

AWS Config has managed rules that can help audit security group compliance, such as `restricted-ssh` (which flags security groups allowing unrestricted SSH) or `restricted-common-ports` (which flags overly permissive rules on well-known ports).

For ongoing visibility, enable VPC Flow Logs and analyze traffic patterns. You might discover that a particular rule you thought was necessary isn't actually being used, or conversely, that traffic is being dropped somewhere unexpectedly. Flow Logs tell you what's happening at the network level, helping you fine-tune your rules.

### Ephemeral Port Ranges and Dynamic Traffic

One nuance worth mentioning: many network protocols use a range of ports for ephemeral (temporary) connections. When a client initiates a connection, the operating system assigns an ephemeral port from a range, typically 1024-65535, though different operating systems use different ranges. If you're using security groups to allow bidirectional communication between tiers, you need to account for this.

For example, if your application tier initiates connections to your database, the database server responds on the ephemeral port the application's OS assigned. Because security groups are stateful, the return traffic is automatically allowed even if you don't explicitly permit it. This is a key distinction from stateless firewalls: you only need to allow traffic in the direction of the initiating connection.

However, this becomes relevant if you're using Network ACLs (which are stateless) on top of security groups. NACLs require explicit rules for both directions, so you'd need to allow ephemeral ports. Security groups alone handle this transparently, which is another reason many architects prefer managing network rules at the security group level rather than the NACL level.

### Real-World Scenario: Scaling and Refactoring

Let's apply these concepts to a realistic scenario. Imagine you've built a successful SaaS product with a monolithic architecture. Your entire application runs on a fleet of instances in a single security group, and they all talk to a single database. This worked fine when you had five instances, but now you have fifty and you're splitting your application into microservices.

With CIDR-based security groups, this refactoring would be painful. You'd need to create new security groups for each microservice, figure out which subnets each will run in, add CIDR rules for all those subnets to the database security group, and hope you don't miss anything. When you add a new microservice later, you'd repeat the process.

With security group references, the refactoring is cleaner. You create a security group for each microservice. You add an inbound rule to your database security group that allows traffic from each microservice security group. As you add new services, you add new rules referencing the new security groups. Your subnet organization becomes irrelevant; what matters is which security groups are attached to which instances.

Moreover, if you later decide to split your database for scaling or compliance reasons, you can create separate database security groups and have different microservices talk to different databases simply by assigning them to different security groups and adding the appropriate rules. The level of indirection that security groups provide makes these architectural changes manageable.

### Conclusion

Security group design might seem like a low-level detail, but it profoundly affects how maintainable and scalable your infrastructure becomes. The shift from thinking in terms of CIDR blocks to thinking in terms of security group references marks a maturity point in AWS architecture: you stop treating infrastructure as a static collection of IPs and subnets, and start treating it as a dynamic, composable system.

The best practice is simple to state but important to internalize: use security group references within your VPC wherever possible, and use CIDR blocks only when you need to grant access to entities outside your VPC. Apply least privilege to both inbound and outbound rules. Create multiple purpose-built security groups rather than monolithic ones. Define your security groups in infrastructure as code so they're auditable and reproducible.

As your AWS systems grow, these practices will save you hours of troubleshooting, make your infrastructure more secure, and make it dramatically easier to refactor and scale. Security groups are one of the few AWS primitives that get more valuable the more thought you put into them upfront.
