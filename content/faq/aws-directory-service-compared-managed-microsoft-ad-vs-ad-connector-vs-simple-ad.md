---
title: "AWS Directory Service Compared: Managed Microsoft AD vs AD Connector vs Simple AD"
---

## AWS Directory Service Compared: Managed Microsoft AD vs AD Connector vs Simple AD

When you're building enterprise applications on AWS, sooner or later you'll need to connect to a directory service. Whether you're spinning up Windows EC2 instances that need to join a domain, configuring RDS databases with Windows authentication, or deploying WorkSpaces for remote employees, AWS Directory Service becomes essential infrastructure. The challenge is that AWS offers three different options—each with distinct architecture, capabilities, and trade-offs—and choosing the wrong one can lead to performance problems, cost overruns, or missing functionality.

This article walks you through all three offerings: AWS Managed Microsoft AD, AD Connector, and Simple AD. We'll examine the underlying architecture of each, explore which use cases they support, discuss trust relationships and hybrid deployments, compare pricing, and then build a practical decision framework to help you pick the right option for your situation.

### Understanding AWS Directory Service at a High Level

Before diving into the specifics of each option, let's establish why directory services matter in AWS. A directory service is fundamentally a database that stores information about users, computers, and organizational units. It handles authentication (verifying who you are) and authorization (determining what you can access). In an on-premises environment, organizations typically use Active Directory running on Windows Server. When you move workloads to AWS, you still need a directory service—AWS Directory Service is how you get that capability.

The key insight is that AWS doesn't force you into a one-size-fits-all solution. Instead, they've built three distinct products because different organizations have different needs. A startup with no legacy infrastructure has vastly different requirements than a Fortune 500 company with decades of on-premises Active Directory.

### AWS Managed Microsoft AD: The Fully Managed Active Directory

AWS Managed Microsoft AD is exactly what its name suggests—a genuine Microsoft Active Directory running on infrastructure that AWS manages for you. Think of it as Active Directory as a Service. AWS handles all the patching, backups, monitoring, and high availability. You get the full feature set of Active Directory without needing to operate it yourself.

#### Architecture and How It Works

When you create a Managed Microsoft AD directory, AWS provisions Active Directory Domain Services across multiple Availability Zones within the same AWS region. This multi-AZ setup gives you automatic failover and high availability out of the box. You specify a VPC and subnets where AWS deploys domain controllers, and these controllers are managed entirely by the AWS service—you never SSH into them or manage them directly.

Managed Microsoft AD runs genuine Windows Server Active Directory code. This means you get full LDAP support, Kerberos authentication, Group Policy, Group Managed Service Accounts (gMSAs), and all the sophisticated enterprise features that make Active Directory powerful. If your organization has built custom scripts, applications, or infrastructure around Active Directory's advanced features, Managed Microsoft AD supports all of it.

The architecture involves two domain controllers (one per AZ) for fault tolerance. Communication between your VPC and these domain controllers happens automatically—they're seamlessly integrated into your selected VPC and subnets. AWS also manages DNS automatically; when you create a Managed Microsoft AD directory, AWS sets up Route 53 hosted zones for your directory's DNS.

#### Primary Use Cases

Managed Microsoft AD shines when you need full Active Directory functionality but don't want to operate it yourself. Common scenarios include:

When you're deploying Windows EC2 instances in AWS and want them to domain-join to a centralized directory (just like an on-premises environment), Managed Microsoft AD lets you do this seamlessly. You specify the directory when configuring your EC2 instances, and they automatically join the domain at launch.

If you're using Amazon RDS for SQL Server or RDS for Windows and need Windows authentication (rather than database-native authentication), Managed Microsoft AD is your answer. RDS integrates directly with Managed Microsoft AD to validate user credentials against the directory.

For Amazon WorkSpaces (AWS's desktop-as-a-service offering), Managed Microsoft AD is the primary directory option. WorkSpaces users authenticate through the directory, and administrators manage access and policies through familiar Active Directory mechanisms.

Organizations building a new cloud-native infrastructure that doesn't need to connect to an existing on-premises Active Directory often choose Managed Microsoft AD because they get full functionality with zero operational overhead.

#### Trust Relationships and Hybrid Scenarios

Here's where Managed Microsoft AD gets interesting: you can establish trust relationships with your on-premises Active Directory. Specifically, you can create a one-way or two-way trust between Managed Microsoft AD and your corporate directory.

A two-way trust is the gold standard for hybrid environments. Users in your on-premises domain can authenticate to resources in AWS, and users in the AWS directory can authenticate to on-premises resources (assuming appropriate permissions). This is powerful for gradual cloud migration—you can move some applications and services to AWS while users continue using their existing credentials.

To establish a trust relationship, you need network connectivity between your on-premises directory and AWS—typically through a VPN or AWS Direct Connect. The trust is configured in Active Directory itself, using standard Active Directory trust management tools. From a developer's perspective, this means your code doesn't need to change; the directory handles all the cross-domain authentication logic transparently.

#### Limitations and Considerations

Managed Microsoft AD comes with a few important constraints. The directory is region-specific—you create it in one region, and it exists only in that region. If you need directory services across multiple regions, you'd need to create separate directories in each region or implement replication mechanisms.

There's also a networking constraint: Managed Microsoft AD must be deployed within a VPC. You can't use it in a VPC-less EC2-Classic environment (though EC2-Classic is deprecated anyway). The domain controllers are placed in subnets you specify, so you need to plan your VPC architecture accordingly.

From a Microsoft perspective, AWS Managed Microsoft AD is based on Windows Server with Active Directory Domain Services, but you don't get the full Windows Server operating system—you get the directory service components specifically. This is fine for most use cases, but if you need some other Windows Server feature, you'd need to run your own Active Directory instances.

#### Pricing Model

AWS Managed Microsoft AD pricing has two components: a base directory fee (charged per month) and an optional additional storage fee if you need to store more than the included quota of users and computers.

As of recent AWS pricing, a standard directory costs around $0.48 per day (approximately $14-15 per month), with Enterprise editions available at higher cost tiers. You're paying for the managed service and the underlying infrastructure, but you're not paying for individual EC2 instances or anything like that—you're paying once for the directory itself.

### AD Connector: A Proxy to Your On-Premises Directory

AD Connector is fundamentally different from Managed Microsoft AD. Rather than hosting a directory in AWS, AD Connector is a lightweight directory gateway that proxies requests to your existing on-premises Active Directory. It doesn't store any directory data itself—it simply forwards authentication requests to your corporate directory.

#### Architecture and How It Works

AD Connector consists of two connector instances deployed across multiple Availability Zones in a VPC you specify. These connectors are not full directory servers; they're stateless proxy services. When an EC2 instance or other AWS service needs to authenticate a user or look up directory information, the request goes through the AD Connector, which forwards it to your on-premises Active Directory server over a secure connection (typically IPsec VPN or AWS Direct Connect).

The critical architectural requirement for AD Connector is network connectivity. You must have reliable, low-latency communication between AWS and your on-premises network. This is usually established through either a Site-to-Site VPN (which works but has higher latency and is suitable for development/testing) or AWS Direct Connect (which provides a dedicated, low-latency connection ideal for production).

Because AD Connector proxies all requests, there's no directory data cached in AWS. This means your on-premises directory remains the single source of truth, and all authentication decisions flow through your corporate directory. This is an advantage for organizations that need tight security and centralized control, but it also means AD Connector entirely depends on that network connectivity.

#### Primary Use Cases

AD Connector makes sense when you have an existing, well-established on-premises Active Directory and you want to use it as-is for AWS resources without duplicating data or operational overhead.

You can domain-join EC2 instances through AD Connector just as you would with a local directory. The instances authenticate against your corporate directory through the connector. This is powerful because your existing Active Directory policies, Group Policy Objects, and user management workflows apply directly to AWS resources.

If you're running RDS for SQL Server with Windows authentication and want to leverage your existing corporate credentials, AD Connector bridges that gap. SQL Server authentication requests flow through the connector to your on-premises directory.

Organizations using Amazon WorkSpaces can opt for AD Connector as their directory backend. WorkSpaces users log in with their corporate credentials, and access is managed through existing corporate policies.

A common pattern is gradual cloud migration: you move applications to AWS but keep directory services on-premises. As you transition more workloads, you might eventually move to Managed Microsoft AD, but in the interim, AD Connector lets you use AWS services while maintaining your existing directory infrastructure.

#### Limitations and Critical Dependencies

AD Connector's biggest limitation is its absolute dependency on network connectivity. If the link between AWS and your on-premises network fails, users cannot authenticate, EC2 instances cannot domain-join, and services cannot look up directory information. This makes AD Connector unsuitable for mission-critical resources that can't tolerate any network outage.

Because there's no caching in the AD Connector architecture, latency in the network link directly impacts authentication performance. Every authentication request traverses the VPN or Direct Connect link. For organizations with high-latency or unreliable connections, this can create a poor user experience.

AD Connector is also limited to one AWS region. If you need directory services across multiple regions, you'd need to deploy AD Connectors in each region.

Additionally, AD Connector doesn't support some advanced scenarios. You can't create Managed Identities or use certain newer AWS directory-related features that depend on a full directory presence in AWS.

#### Pricing Model

AD Connector pricing is per-connector, per-day. You pay for the deployed connector instances rather than for the directory itself. This means if you need high availability (two connectors across multiple AZs), you're paying for both. The pricing is typically lower than Managed Microsoft AD, making it cost-effective for organizations that already own and operate their own Active Directory.

### Simple AD: The Lightweight, Standalone Option

Simple AD is AWS's lightest-weight directory option. It's a Samba-based directory service that provides basic Active Directory compatibility without requiring a full Windows Server Active Directory deployment or an on-premises directory connection.

#### Architecture and How It Works

Simple AD runs on Samba, an open-source implementation of SMB/CIFS that provides some Active Directory compatibility. AWS manages the underlying infrastructure, similar to Managed Microsoft AD, deploying Simple AD across multiple Availability Zones for high availability.

The key distinction from Managed Microsoft AD is that Simple AD is not running actual Windows Server Active Directory code—it's running Samba, which implements a subset of Active Directory functionality. This makes it much lighter weight and simpler, but it also means it doesn't support some advanced Active Directory features.

Simple AD supports basic directory functionality: user authentication, computer objects, group membership, and LDAP queries. It can manage users and groups, and it supports password policies and password resets. For many straightforward use cases, this is sufficient.

#### Primary Use Cases

Simple AD is ideal for organizations that need basic directory functionality but don't require the full feature set of Windows Server Active Directory. Startups and smaller organizations without legacy Active Directory investments often find Simple AD perfect.

You can domain-join Linux and Windows EC2 instances to a Simple AD directory. While Windows instances can join Active Directory domains, Simple AD provides enough compatibility for this to work smoothly in many cases. Linux instances can join via LDAP.

Simple AD doesn't support RDS Windows authentication (that's a Managed Microsoft AD feature), but it does work with some other AWS services.

For basic WorkSpaces deployments, Simple AD is sufficient. Users authenticate to WorkSpaces using Simple AD credentials, and basic access control is managed through groups.

Organizations in the early stages of cloud adoption, without complex directory requirements, often start with Simple AD and later migrate to Managed Microsoft AD as their needs grow.

#### Limitations

Simple AD is Samba-based, so it lacks many features of true Windows Server Active Directory. These include: Kerberos constrained delegation, Group Managed Service Accounts (gMSAs), advanced Group Policy features, Schema extensions, and multi-domain support.

It doesn't support RDS Windows authentication, which is a significant limitation if you're planning to use RDS with Windows-based applications.

Simple AD has limited scalability. While adequate for small to medium deployments, it's not designed for large enterprises with thousands of users and complex organizational structures.

Like Managed Microsoft AD, Simple AD is region-specific and VPC-bound. It cannot be deployed across regions or in non-VPC environments.

#### Pricing Model

Simple AD is priced similarly to Managed Microsoft AD with a base monthly fee, though typically at a lower cost point since it's less feature-rich. You're paying for the managed Samba-based service and the underlying infrastructure.

### Comparing the Three Options: A Feature Matrix

Let's consolidate the key differences into a clear comparison. Managed Microsoft AD provides the full, genuine Windows Server Active Directory experience with complete feature support, multi-AZ deployment, and automatic failover. It's AWS-managed, so you have zero operational overhead. It costs more than the alternatives because you're getting the most functionality.

AD Connector is a proxy to your on-premises directory. It requires existing on-premises Active Directory infrastructure and reliable network connectivity between AWS and your data center. It leverages your existing directory investment but adds a network dependency.

Simple AD is a lightweight, Samba-based option that provides basic directory functionality without requiring Windows Server or an on-premises connection. It's cost-effective and sufficient for simple use cases but lacks advanced Active Directory features.

In terms of authentication support, all three options support basic user authentication. Managed Microsoft AD and AD Connector support Kerberos; Simple AD provides basic authentication but Kerberos support is limited. When it comes to RDS Windows authentication, only Managed Microsoft AD is supported—this is a critical constraint if you're using RDS for Windows.

For EC2 domain-join capabilities, all three options work, though Simple AD has some limitations on the Windows side for complex scenarios. WorkSpaces works with all three, though Managed Microsoft AD is the most full-featured. Trust relationships with on-premises directories are supported by Managed Microsoft AD (two-way trust) and AD Connector (implicit, since it proxies to your on-premises directory), but not by Simple AD in the same way.

### Decision Framework: Choosing the Right Option

Now let's build a practical decision tree to help you select the right directory service for your situation.

Start with this foundational question: Do you already have an on-premises Active Directory that you want to continue using without migration? If the answer is yes, your best options are AD Connector or Managed Microsoft AD with a trust relationship. AD Connector is simpler operationally if your network connectivity is reliable and you don't need advanced features. Managed Microsoft AD with a trust gives you more flexibility and advanced features but adds complexity.

If you don't have an on-premises directory, or you're building greenfield cloud infrastructure, you're looking at either Managed Microsoft AD or Simple AD.

Next, ask: Do you need RDS Windows authentication? Only Managed Microsoft AD supports this. If you're using RDS for SQL Server with Windows authentication, Managed Microsoft AD is mandatory.

Do you need advanced Active Directory features like Group Managed Service Accounts, Kerberos constrained delegation, or schema extensions? These are Managed Microsoft AD only. If your applications or infrastructure rely on these features, Managed Microsoft AD is your choice.

How many users and computers do you need to support? Simple AD has practical limits on scale. For deployments with thousands of users or complex organizational structures, Managed Microsoft AD is more appropriate.

What's your tolerance for network dependency? If you're using AD Connector, you're adding a critical network dependency on connectivity between AWS and your data center. For mission-critical applications, this might be unacceptable. Managed Microsoft AD and Simple AD are self-contained in AWS, so they don't depend on external network connectivity (though you'd typically still have network links for hybrid scenarios).

What's your budget? If cost is the primary constraint and your needs are simple, Simple AD is the most economical. AD Connector is next (paying per connector instance), and Managed Microsoft AD costs the most (but provides the most value for complex scenarios).

Here's a practical decision flowchart:

If you require RDS Windows authentication, choose Managed Microsoft AD. If you have on-premises Active Directory and need to continue using it without migration, choose AD Connector (if the network is reliable and advanced features aren't needed) or Managed Microsoft AD with trust (if you need advanced features). If you're building new cloud infrastructure without on-premises integration, choose Managed Microsoft AD for comprehensive features or Simple AD if your needs are straightforward and budget-conscious.

### Hybrid and Migration Scenarios

Many organizations don't fit neatly into one category—they're in transition. Let's discuss some common hybrid scenarios.

**Gradual Cloud Migration**: An organization has decades of on-premises infrastructure and wants to move applications to AWS incrementally. They might start with AD Connector to keep everything tied to their corporate directory. As they move more identity management to the cloud, they might add a Managed Microsoft AD directory and establish a trust relationship. Eventually, they might migrate fully to Managed Microsoft AD and decommission the on-premises directory.

**Temporary Coexistence**: Some organizations run both AD Connector (proxy to on-premises) and a separate Managed Microsoft AD directory for cloud-native applications. The Managed Microsoft AD is for new, cloud-native workloads that don't need on-premises integration, while AD Connector bridges legacy applications still tied to the corporate directory.

**Disaster Recovery and Failover**: An organization might run AD Connector in their primary region but add a Managed Microsoft AD directory in a secondary region. If their on-premises data center becomes unavailable, the secondary region takes over with the Managed Microsoft AD directory. This provides resilience against both AWS outages and on-premises failures.

These hybrid scenarios require careful planning of trust relationships, DNS, and user synchronization. The good news is that all three directory options are designed with these scenarios in mind.

### Practical Considerations for Implementation

When you're ready to implement, a few practical considerations matter. Networking is fundamental. Ensure you have appropriate VPC and security group configurations. For AD Connector, verify network connectivity to your on-premises directory. For Managed Microsoft AD and Simple AD, ensure your EC2 instances and other resources can reach the directory's DNS servers.

DNS configuration is critical. Both Managed Microsoft AD and Simple AD create Route 53 hosted zones. You need to ensure that your EC2 instances and other AWS resources can resolve the directory's DNS names. This often means configuring DHCP Option Sets in your VPC to point to the directory's DNS servers.

User and group management workflows differ slightly across the options. With Managed Microsoft AD, you manage users and groups directly in the AWS console or via PowerShell/ADSI. With AD Connector, you manage users and groups in your on-premises directory, and those changes immediately reflect in AWS (via the proxy). With Simple AD, you manage through the AWS console using LDAP-compatible tools.

Security group and network ACL configuration is essential. Your resources need inbound access to the directory service on specific ports (LDAP on 389, LDAPS on 636, Kerberos on 88, etc.). Review AWS documentation for complete port requirements for your specific use case.

### Real-World Example: Choosing for a Specific Organization

Let's walk through a concrete example. Imagine a mid-sized financial services firm with 2,000 employees. They have a robust on-premises Active Directory running Windows Server 2019 with sophisticated Group Policies and custom applications that depend on advanced AD features.

They're moving their customer-facing application suite to AWS—a mix of web services, RDS for SQL Server databases, and some Windows EC2 instances for legacy components. They want to maintain their centralized user management on-premises while leveraging AWS infrastructure.

In this scenario, Managed Microsoft AD with a two-way trust relationship is the optimal choice. Here's why: They need RDS Windows authentication, which requires Managed Microsoft AD. They have advanced on-premises AD features that need to work in AWS, which Managed Microsoft AD can support. They want their on-premises and AWS directories to interoperate seamlessly, which the trust relationship enables. Finally, they have sufficient budget for a comprehensive solution, and the operational simplicity of having AWS manage the directory (rather than running their own) is valuable.

They'd establish a Site-to-Site VPN (or better, AWS Direct Connect) for network connectivity. They'd create a two-way trust between their on-premises AD and the Managed Microsoft AD directory. Domain-joined instances in AWS would authenticate against either directory (determined by trust relationship logic). RDS would use the Managed Microsoft AD directory for Windows authentication. Eventually, they might migrate user management to the cloud, decommissioning the on-premises directory, but the architecture would remain the same.

### Conclusion

AWS Directory Service's three offerings—Managed Microsoft AD, AD Connector, and Simple AD—represent different architectural approaches to the same fundamental problem: how to integrate AWS resources with identity management. There's no universally "best" option; the right choice depends on your specific requirements, existing infrastructure, feature needs, and operational constraints.

Managed Microsoft AD is the comprehensive, fully managed option that gives you complete Active Directory functionality without operational overhead. It's the right choice when you need advanced features, RDS Windows authentication, or a complete identity infrastructure in AWS. AD Connector bridges your existing on-premises directory into AWS through a proxy architecture, which is perfect for organizations with established directory infrastructure and strong on-premises ties. Simple AD provides basic directory functionality for simpler use cases where you don't need the full Active Directory feature set.

When making your decision, focus first on your non-negotiable requirements: Do you need specific features like RDS Windows authentication? Do you have existing on-premises infrastructure you must integrate? What's your scale and complexity? Then consider operational and network factors: What's your tolerance for network dependencies? How much operational overhead can you accept? Finally, consider cost: does the pricing align with your budget?

As you architect AWS solutions, remember that directory service choice often cascades into other decisions—VPC design, EC2 configuration, RDS setup, and security group policies all depend on your directory strategy. Taking time to make the right choice upfront prevents costly refactoring later. The good news is that AWS has built three solid options that cover virtually every organizational scenario, from startups to enterprises.
