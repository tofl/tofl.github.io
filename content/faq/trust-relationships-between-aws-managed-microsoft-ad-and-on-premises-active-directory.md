---
title: "Trust Relationships Between AWS Managed Microsoft AD and On-Premises Active Directory"
---

## Trust Relationships Between AWS Managed Microsoft AD and On-Premises Active Directory

Building a bridge between your on-premises Active Directory and AWS Managed Microsoft AD opens up powerful possibilities for hybrid cloud deployments. You can extend corporate identity management to AWS resources, enable seamless domain joins for EC2 instances, and leverage Windows authentication for database workloads—all without duplicating user accounts or managing separate identity systems. However, establishing this connection requires careful planning around networking, trust configuration, and DNS resolution.

This article walks you through the practical architecture and implementation of trust relationships between AWS Managed Microsoft AD and your on-premises Active Directory environment. Whether you're migrating workloads to AWS or building a hybrid infrastructure from scratch, understanding these trust models will help you design solutions that feel native to both environments.

### Why Trust Relationships Matter in Hybrid Scenarios

When you run Active Directory in two separate locations—on-premises and in AWS—users and computers in one forest don't automatically have access to resources in the other. A trust relationship is the mechanism that allows one Active Directory domain to authenticate and authorize principals from another domain.

Think of it like a formal agreement between two security authorities. Your on-premises AD maintains user accounts and group memberships for your corporate users. AWS Managed Microsoft AD is a separate forest running in your AWS environment, but through a trust relationship, it can recognize and accept authentication from your on-premises users. This means a developer in your New York office can authenticate with their corporate credentials and gain access to an EC2 instance or RDS database in your AWS account without needing a separate AWS-only account.

This is especially valuable for organizations that want to maintain centralized identity governance while leveraging cloud services. Instead of managing identities in multiple places, you have one source of truth in your on-premises directory, and AWS resources respect that authority through the trust.

### Forest Trusts vs. External Trusts: Understanding the Difference

Active Directory supports different trust types, and choosing the right one for your scenario is crucial. The two primary options for connecting AWS Managed Microsoft AD to on-premises AD are forest trusts and external trusts.

**Forest trusts** connect two entire Active Directory forests. They're the broadest form of trust and enable transitive trust relationships across multiple domains within each forest. When you establish a forest trust, users in any domain within the on-premises forest can potentially access resources in any domain within the AWS-managed forest, provided permissions are configured appropriately. Forest trusts are also transitive by default, meaning if forest A trusts forest B, and forest B trusts forest C, then forest A automatically has some level of trust with forest C.

**External trusts** are narrower in scope—they connect specific domains rather than entire forests. An external trust is typically non-transitive, meaning trust only flows between those two specific domains. If you have multiple domains in your on-premises environment, you'd need separate external trusts for each domain that requires access to resources in AWS.

For most hybrid scenarios, forest trusts are preferable because they're simpler to manage at scale and accommodate growth more gracefully. If you add new domains to your on-premises forest or to your AWS-managed forest, they inherit the trust relationship without additional configuration. External trusts require more manual management when your directory structure grows, making them more suitable for isolated, temporary trust scenarios or when you want very explicit control over which domains can communicate.

AWS Managed Microsoft AD creates a single domain forest by default (something like `example.com`), so a forest trust from your on-premises forest to the AWS-managed forest is the natural choice for most deployments.

### One-Way Trusts vs. Two-Way Trusts

Trust direction determines which way authentication can flow. In a one-way trust, trust flows in one direction only. In a two-way trust, authentication flows bidirectionally.

Consider a one-way trust where your on-premises forest is the trusting forest and the AWS-managed forest is the trusted forest. This means your on-premises users can authenticate to AWS resources, but AWS users cannot authenticate to on-premises resources. This is appropriate when you're extending cloud access to your corporate user base but don't need cloud-specific identities to interact with on-premises systems.

A two-way trust, by contrast, allows authentication in both directions. On-premises users can access AWS resources, and AWS users can access on-premises resources. This is useful in scenarios where you have service accounts, applications, or administrative users in AWS that need to interact with on-premises systems, or when you're managing a complex hybrid environment where principals from both sides need mutual access.

The choice between one-way and two-way depends on your business requirements and security posture. One-way trusts provide tighter isolation and are often sufficient for scenarios where AWS is primarily a consumer of corporate identity. Two-way trusts are necessary when you need bidirectional resource access but increase the attack surface and administrative overhead.

### Networking Prerequisites: The Foundation of Cross-Environment Trust

Before any trust configuration can succeed, your networking must be set up to allow communication between the two environments. AWS Managed Microsoft AD operates within your AWS VPC, while your on-premises AD is in your data center or branch office. For them to communicate, you need a reliable, encrypted connection.

**VPN connections** and **AWS Direct Connect** are the two primary options. A VPN is simpler to set up and works over the public internet with encryption, making it suitable for many organizations. AWS Site-to-Site VPN can be established relatively quickly and doesn't require lengthy carrier engagement. However, it's subject to internet variability and may not meet performance requirements for high-volume authentication traffic.

AWS Direct Connect is a dedicated network connection that provides consistent performance, lower latency, and higher bandwidth than VPN. It's ideal for large-scale deployments or when you need predictable performance for authentication and replication traffic. Many enterprise environments use Direct Connect as their backbone for hybrid connectivity.

Regardless of which connectivity option you choose, you need to ensure network routes are properly configured. Traffic from your on-premises network must be able to reach the subnets where AWS Managed Microsoft AD operates, and return traffic must route correctly back to your on-premises environment. This typically means configuring route table entries in your VPC and static or dynamic routing protocols in your on-premises network.

**Security groups** act as firewalls at the instance level in AWS and are often overlooked in trust planning. AWS Managed Microsoft AD requires specific ports to be open for communication. The domain controllers need inbound access on several critical ports: DNS (53), Kerberos (88), LDAP (389), LDAPS (636), and RPC/SMB (445, 135-139). If your AWS-managed directory is behind a security group that blocks these ports from your on-premises network, trust communication will fail silently and mysteriously.

To avoid this pitfall, ensure your security groups allow inbound traffic on these ports from your on-premises network's CIDR blocks. Similarly, network access control lists (NACLs) at the subnet level should permit bidirectional traffic on these ports. It's tempting to open these ports to `0.0.0.0/0`, but restricting them to your on-premises network CIDR is more secure and equally functional.

### DNS: The Critical Linchpin

DNS resolution is where many trust relationships fail, and the failure mode is often opaque—you'll see authentication errors without a clear root cause. Both your on-premises domain controllers and AWS Managed Microsoft AD domain controllers need to resolve each other's names to establish communication.

This is where **conditional DNS forwarders** become essential. A conditional forwarder tells your DNS resolver, "If someone asks for a name in this domain, forward that query to these specific DNS servers." Your on-premises DNS servers should have conditional forwarders configured to send queries for the AWS-managed domain (e.g., `aws.example.com`) to the IP addresses of the AWS Managed Microsoft AD domain controllers. Similarly, the domain controllers in AWS Managed Microsoft AD should have conditional forwarders configured to send queries for your on-premises domain to your on-premises DNS servers.

When you create AWS Managed Microsoft AD, you specify the DNS name for your directory. This directory automatically configures its domain controllers as DNS servers. You'll need to retrieve the IP addresses of these domain controllers from the AWS Directory Service console and enter them in your on-premises DNS configuration.

On the AWS side, you can configure conditional forwarders through the AWS Directory Service console by specifying your on-premises domain name and the IP addresses of your on-premises DNS servers. AWS Managed Microsoft AD will then know how to resolve names in your on-premises domain.

Without proper conditional forwarders, a domain controller attempting to verify the trust will fail to resolve the other side's name, and the trust won't function. Testing DNS resolution before attempting trust configuration is a valuable debugging step—use `nslookup` or `dig` from domain controllers on both sides to verify they can resolve each other's domain names.

### Step-by-Step Trust Configuration

Assuming your networking, security groups, and DNS are properly configured, the actual trust creation process involves coordinating actions between your on-premises Active Directory and AWS Managed Microsoft AD.

First, you'll create a trust request in AWS Managed Microsoft AD. Using the AWS Directory Service console, you navigate to your directory, select "Trust relationships," and create a new trust. You'll specify the on-premises domain name (e.g., `corp.example.com`), choose the trust type (forest or external), select the direction (one-way or two-way), and provide the trust password—a shared secret that both sides will use to establish the trust.

Next, you'll go to your on-premises Active Directory environment and complete the trust from that side. Using Active Directory Domains and Trusts on a domain controller, you create an incoming trust relationship (from the perspective of on-premises AD, it's trusting the AWS-managed forest). You'll enter the AWS-managed domain name and the same trust password you specified in AWS.

Once both sides create the trust, Active Directory initiates a verification process. The domain controllers on each side communicate across your network connection, exchange the trust password, and establish a secure channel. If everything is configured correctly—networking, security groups, DNS, and trust password—the trust will transition to verified status within moments.

If verification fails, check the obvious culprits first: Can your on-premises domain controllers resolve the AWS-managed domain name? Can AWS domain controllers resolve your on-premises domain? Are security group rules open for the required ports? Are the trust passwords identical on both sides? These are the most common failure points.

### Using Trust for EC2 Domain Join and Windows Authentication

Once your trust relationship is established and verified, the practical benefits become apparent. The most straightforward use case is domain-joining EC2 instances to AWS Managed Microsoft AD, allowing your corporate users to authenticate with their domain credentials.

When you launch an EC2 instance running Windows Server, you can run a script or use AWS Systems Manager to join the instance to the AWS-managed domain. The instance needs network connectivity to the AWS Managed Microsoft AD domain controllers (which is automatic if it's in the same VPC), and it needs to be able to resolve the domain name through DNS.

A typical domain-join script looks like this:

```powershell
$domain = "aws.example.com"
$domainUser = "Admin@aws.example.com"
$password = ConvertTo-SecureString "YourPassword" -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($domainUser, $password)

Add-Computer -DomainName $domain -Credential $credential -Restart
```

Once joined to AWS Managed Microsoft AD, the instance's local security policy recognizes users and groups from both the AWS-managed domain and—critically—from your on-premises domain through the trust relationship. Your corporate users can now `Remote Desktop` into the instance using their on-premises domain credentials and have access to their network drives, printers, and other resources as if they were in the office.

This is where the trust relationship shines. Users don't need separate AWS accounts. They use the same identity they've always used, and the trust relationship extends that identity's validity into the AWS cloud.

Another powerful use case is RDS for SQL Server with Windows authentication. RDS for SQL Server supports Windows authentication when your database is joined to an Active Directory domain. By configuring your RDS instance for AWS Managed Microsoft AD and establishing the trust relationship with your on-premises AD, SQL Server can authenticate users from both forests. Applications can use Windows authentication (integrated security) to connect to the database, and SQL Server verifies the user against the directory.

This is particularly valuable because it eliminates the need to manage database-level credentials for every user. SQL Server delegates authentication to Active Directory, which in turn delegates to your on-premises AD through the trust, creating a seamless experience.

### Limitations and Considerations

Trust relationships are powerful, but they come with limitations that you should understand before designing your solution.

**Transitive trust across forests is limited.** While forest trusts are transitive within each forest, the transition across the forest trust boundary has constraints. In practical terms, if you have domains A and B within your on-premises forest, and a forest trust to AWS-managed forest C, domain A users can access domain B resources and can access domain C resources through the trust. However, the transitivity is limited by how security group membership is evaluated across forest boundaries. Forest-wide global groups and domain global groups don't automatically translate across the trust, so careful group nesting and permissions design is necessary.

**Selective Authentication can complicate access.** By default, forest trusts use transitive authentication, but you can enable "Selective Authentication" to restrict which users from the trusted forest can access resources in the trusting forest. This provides tighter security but requires explicit permissions for each principal that needs access. If you enable selective authentication, you must grant explicit access permissions on both the resource domain and the trusting domain side, which adds administrative overhead.

**DNS name resolution must be bidirectional and correct.** If DNS goes wrong, everything fails silently. There's no failover or fallback. The domain controllers absolutely depend on DNS to find each other, replicate trust information, and authenticate users. Single points of failure in your DNS infrastructure can bring down authentication for cloud resources.

**Kerberos ticket lifetimes and clock skew matter.** Kerberos authentication is time-sensitive. If domain controllers across the trust have clocks that differ by more than five minutes (by default), Kerberos authentication will fail. Ensure NTP synchronization across your entire hybrid environment. Likewise, be aware of Kerberos ticket lifetime defaults—if your users have cached credentials and those tickets expire while they're working, they'll need to re-authenticate.

**Trust relationships require Active Directory replication to converge.** When you create a trust, the configuration must replicate across all domain controllers in your forest. This usually happens quickly, but in large environments with many domain controllers or over high-latency WAN links, replication can take time. If you immediately test trust functionality after creation, you might hit a domain controller that hasn't yet received the trust configuration updates.

**There's no redundancy without multiple domain controllers.** AWS Managed Microsoft AD by default creates a highly available setup with domain controllers in multiple Availability Zones. However, your on-premises AD is a single point of failure from the trust perspective—if all your on-premises domain controllers go offline, users can't authenticate to cloud resources even if the trust itself is technically healthy. Consider this when planning disaster recovery and high availability.

**Cross-forest group policy scope is limited.** Group Policy Objects created in your on-premises domain won't automatically apply to computers in the AWS-managed domain, and vice versa. Cross-forest group policy requires careful design and typically uses restricted groups or security group filtering rather than relying on transitive group memberships. If you depend heavily on group policy for configuration management, bridging that across a forest trust requires additional planning.

### When to Use Trust Relationships vs. Other Solutions

Trust relationships are excellent for hybrid identity scenarios, but they're not the only way to extend identity to AWS. Understanding when they're the right choice is important.

Use trust relationships when you have an established on-premises Active Directory with existing user accounts and groups, you need seamless authentication from corporate credentials to AWS resources, you're running Windows workloads that expect domain membership, you need Windows authentication for databases like RDS SQL Server, or you want to maintain centralized identity governance while leveraging cloud services.

Alternatives exist for different scenarios. AWS Identity Center (successor to AWS SSO) provides centralized identity management and federation without requiring a trust relationship, though it decouples identity management from your on-premises AD. It's excellent for organizations wanting cloud-first identity management or multi-cloud federation. Amazon Cognito is a user directory and federation service suited for external user bases and consumer applications rather than corporate employees.

For organizations with pure cloud-first architectures or those without on-premises Active Directory, trust relationships aren't necessary. For those with complex multi-forest on-premises environments or organizations undergoing identity modernization, trust relationships provide a bridge while you transition, but they're not a long-term solution.

### Practical Implementation Checklist

Before you configure trust relationships, ensure you have:

Established network connectivity between your on-premises environment and your AWS VPC using VPN or Direct Connect with routing configured correctly. Verified that security groups and NACLs allow traffic on ports 53 (DNS), 88 (Kerberos), 389 (LDAP), 636 (LDAPS), 445 (SMB), and 135-139 (RPC) between your on-premises domain controller network and AWS Managed Microsoft AD subnets. Configured conditional DNS forwarders on your on-premises DNS servers pointing to AWS Managed Microsoft AD domain controller IPs for the AWS-managed domain. Configured conditional DNS forwarders on AWS Managed Microsoft AD pointing to your on-premises DNS servers for your on-premises domain. Synchronized NTP on all domain controllers to within five minutes to ensure Kerberos works correctly. Decided whether you need a one-way or two-way trust and communicated that decision to stakeholders. Determined whether a forest trust or external trust is appropriate for your directory structure. Tested name resolution from both sides using `nslookup` or `dig` before attempting trust creation.

With these prerequisites in place, the actual trust configuration becomes straightforward.

### Conclusion

Trust relationships between AWS Managed Microsoft AD and on-premises Active Directory enable seamless identity extension into the cloud, allowing corporate users to authenticate to AWS resources with their existing credentials and enabling applications to use Windows authentication across forest boundaries. The solution is architecturally sound and production-proven when properly implemented, but success depends critically on networking foundations, DNS configuration, and understanding the trust model that fits your organizational structure.

By establishing forest trusts where possible, ensuring robust networking and DNS resolution, and carefully planning your identity architecture, you create a hybrid identity solution that feels native to both your on-premises and cloud environments. Your users experience unified authentication, your administrators maintain centralized identity governance, and your applications can leverage Windows authentication without managing separate credentials.

As you design your hybrid infrastructure, remember that the trust relationship itself is just one piece of the puzzle. The network connectivity, DNS resolution, security group configuration, and operational discipline around NTP synchronization are equally critical. Invest time in planning these foundations, and the trust relationship will provide years of reliable hybrid identity management.
