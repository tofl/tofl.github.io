---
title: "Understanding the EC2 Shared Responsibility Model and Patching"
---

## Understanding the EC2 Shared Responsibility Model and Patching

When you launch an EC2 instance, you're stepping into a shared world. AWS has built the fortress—the physical data centers, the hypervisors, the network fabric—but you're responsible for what happens inside your walls. This split of security responsibilities is one of the most critical concepts for anyone operating on AWS, yet it's also one of the most misunderstood. Get this wrong, and you could find yourself with a perfectly maintained AWS infrastructure protecting a vulnerable application. Let's dig into exactly where the line is drawn, what tools AWS gives you to manage your side of the responsibility, and how to build a hardened security posture for your EC2 workloads.

### The Shared Responsibility Model: Where AWS Ends and You Begin

AWS describes their security model using a memorable phrase: "AWS is responsible for the security *of* the cloud, while you are responsible for the security *in* the cloud." The distinction matters enormously.

On AWS's side, they handle the hardware, the hypervisor layer, the physical security of data centers, and the foundational network infrastructure. This means AWS is ensuring that no one else can physically walk into their data center and plug in a USB drive to your servers. They're patching the underlying Xen hypervisor that your EC2 instances run on. They're maintaining redundant power systems, cooling systems, and fire suppression. They're also handling the security of the managed services you use—if you're running RDS, AWS patches the database software for you.

Your responsibility begins the moment the operating system boots. You own the guest OS, which includes applying security patches, configuring the firewall, managing user accounts, and controlling what software runs on your instance. You're responsible for your application code, its dependencies, and any secrets it uses. You own the network configuration through security groups and network ACLs. You manage IAM policies that control who can access your instances. You decide what data lives on the instance and how it's encrypted. You determine backup and disaster recovery strategies. Essentially, everything above the hypervisor line is your world.

This distinction becomes especially important when you're thinking about patching. AWS will never patch your guest operating system for you—whether that's a Windows Server, Amazon Linux, Ubuntu, or Red Hat instance. They could theoretically do it, but it would require stopping instances, rebooting them, and potentially breaking applications. That's a business decision that only you can make. AWS gives you the *tools* to manage this efficiently, but the responsibility is unmistakably yours.

### What AWS Manages: The Foundation

Let's be concrete about what's behind AWS's door. AWS manages the physical security perimeter, including badge access controls, surveillance systems, and trained security personnel. They manage the power distribution systems that keep your servers running 24/7. The cooling systems that prevent your hardware from becoming a pile of melted silicon. The fire suppression systems. All of this is documented and audited through various compliance frameworks like SOC 2, ISO 27001, and PCI DSS.

AWS also manages the hypervisor and virtualization layer. The Xen hypervisor that your EC2 instances run on top of receives security patches from AWS. If a vulnerability is discovered in the hypervisor itself, AWS patches it on their infrastructure. You don't need to do anything—the patch is applied to the underlying infrastructure, and your instances continue running. AWS also manages the management plane—the APIs and control systems you use to launch, stop, and terminate instances.

For networking, AWS manages the physical switches, routers, and fiber optic cables that connect their data centers. They manage DDoS protection at the perimeter. They manage the underlying network infrastructure that your security groups and network ACLs sit on top of.

When you use managed services like RDS, ElastiCache, or managed Kubernetes on EKS, AWS extends their patching responsibility to those services. If you're running an RDS MySQL database, AWS patches the database engine for you (though with a maintenance window you can control). You don't have to worry about applying security patches to the database software itself.

### What You Must Manage: The Guest OS and Beyond

The moment the guest operating system boots, you're in the driver's seat. This includes applying patches to the OS kernel, system libraries, and system utilities. If a critical vulnerability is discovered in OpenSSL or glibc, you need to patch it. AWS won't do it for you, and it's not negotiable—unpatched systems are a ticking time bomb.

Beyond patching, you're responsible for the entire security posture of the instance. This includes configuring and managing the OS firewall (iptables on Linux, Windows Firewall on Windows), managing user accounts and SSH keys, and setting appropriate file permissions. You need to ensure that unnecessary services aren't running, that logging is enabled and captured, and that audit trails exist for compliance purposes.

Your application code and its dependencies fall squarely in your court. If you're running a Node.js application with npm packages, you need to monitor those packages for vulnerabilities and update them. If you're running a Python application, you need to manage your pip dependencies. Container images you build and push to ECR are your responsibility to scan and harden.

IAM is a shared responsibility, but with a twist. AWS manages the IAM service itself—the infrastructure that authenticates and authorizes requests. You manage the policies, roles, and access controls. You decide which IAM roles your EC2 instances should assume. You decide what permissions those roles should have. This is where the principle of least privilege comes into play: give each instance only the permissions it absolutely needs.

Security groups and network ACLs are entirely your responsibility. These are your first line of defense, controlling what traffic can reach your instances. A poorly configured security group—say, one that allows SSH from 0.0.0.0/0 (the entire internet)—is a door you've left wide open.

Data encryption is your call. AWS provides the tools—EBS encryption, EBS snapshots can be encrypted, S3 encryption—but whether and how you use them is up to you. The same applies to secrets management: AWS provides Secrets Manager and Parameter Store, but you decide whether to use them and how to integrate them with your applications.

### OS Patching at Scale with Systems Manager Patch Manager

Managing patches manually across dozens or hundreds of instances would be a nightmare. This is where AWS Systems Manager Patch Manager comes in. It's designed to automate the detection, testing, and installation of OS patches at scale.

Here's how it works in practice. First, you define a patch baseline—essentially a set of rules that describe which patches should be applied to which instances. The baseline specifies things like patch classifications (security patches, bug fixes, etc.), severity levels, and approved patches. AWS maintains curated patch baselines for common operating systems like Amazon Linux, Ubuntu, Windows Server, and Red Hat, but you can also create custom baselines tailored to your needs.

Next, you create a maintenance window—a scheduled time when patching can occur. This is important because you want to apply patches when your application can tolerate downtime or a rolling restart. You might say "patch all web servers on Tuesday nights at 2 AM" or "patch databases on Sunday mornings with a rolling window." The maintenance window ensures patches aren't applied at random times that could disrupt your business.

When the maintenance window arrives, Patch Manager scans your instances to identify which patches apply and which are missing. It compares each instance against your defined baseline. Then, depending on your configuration, it can automatically install those patches or notify you for approval. If you've configured automatic patching with approval requirements, you can review what's about to be applied and give the thumbs-up.

Patch Manager can also patch on-premises servers and other cloud infrastructure if you've set up the Systems Manager agent, making it a unified tool for managing patches across your entire environment.

One critical piece: for Patch Manager to work, your EC2 instances need the Systems Manager agent installed and an IAM role that allows them to communicate with the Systems Manager service. Most modern Amazon Machine Images (AMIs) come with the agent pre-installed, but it's worth verifying. The IAM role needs permissions like `ssm:UpdateInstanceInformation`, `ssmmessages:CreateControlChannel`, and `ssmmessages:CreateDataChannel`, typically granted through the `AmazonSSMManagedInstanceCore` policy.

Here's a basic example of creating a patch baseline using the AWS CLI:

```bash
aws ssm create-patch-baseline \
  --name "my-linux-baseline" \
  --operating-system "AMAZON_LINUX_2" \
  --approval-rules PatchRules="[{PatchFilterGroup={PatchFilters=[{Key=CLASSIFICATION,Values=[Security,Bugfix]},{Key=SEVERITY,Values=[Critical,Important]}]},ComplianceLevel=CRITICAL,ApproveAfterDays=0}]"
```

This creates a baseline for Amazon Linux 2 that automatically approves critical and important security and bugfix patches immediately. You'd then associate this baseline with instances through maintenance windows.

### Vulnerability Detection with AWS Inspector

Even with a rigorous patching strategy, vulnerabilities can slip through. AWS Inspector is a vulnerability management service that continuously scans your EC2 instances and container images for known vulnerabilities.

Inspector works by installing an agent on your EC2 instances (or by scanning container images in ECR). The agent collects information about the packages installed on the system, the network configuration, and other security-relevant metadata. This data is sent back to the Inspector service, which compares it against vulnerability databases like the National Vulnerability Database (NVD) and other AWS-curated threat intelligence sources.

What makes Inspector particularly valuable is that it doesn't just tell you "Ubuntu package libssl-1.1 has CVE-2023-12345." It tells you whether that vulnerability is actually exploitable on your system. Maybe the vulnerable function isn't used by any of your applications, or maybe the system is configured in a way that prevents exploitation. Inspector uses contextual analysis to prioritize vulnerabilities by actual risk.

Inspector also checks against security best practices and compliance standards. It can flag instances that don't have the Systems Manager agent installed, instances with overly permissive IAM roles, instances with public IP addresses when they shouldn't have them, and more.

You can create suppression rules for known vulnerabilities that you've explicitly accepted the risk of, or for vulnerabilities that don't apply to your environment. Inspector integrates with Security Hub, so findings can be aggregated with other security findings across your AWS environment.

### Hardening Your AMIs: Building Secure Images from the Ground Up

If patching is about keeping instances healthy after they're running, AMI hardening is about starting with a secure foundation. A hardened AMI is a pre-configured machine image that has been stripped down, patched, and configured according to security best practices before you ever launch an instance from it.

The hardening process begins with selecting a base image. AWS provides Amazon Linux, Amazon Linux 2, and Amazon Linux 2023 images optimized for various workloads. You might also choose Ubuntu, CentOS, or Red Hat images depending on your needs and organizational standards. Start with the latest version of your chosen OS to minimize the number of patches needed.

From there, hardening typically involves several steps. First, remove unnecessary packages and disable unnecessary services. A web server probably doesn't need the X Window System installed. A database server probably doesn't need a compiler. Removing these reduces your attack surface and reduces the number of potential vulnerabilities. Use `systemctl disable` to turn off services that start by default but aren't needed.

Apply all available security patches to the OS and system packages. This is straightforward:

```bash
# For Amazon Linux / Red Hat
sudo yum update -y

# For Ubuntu / Debian
sudo apt-get update && sudo apt-get upgrade -y
```

Configure the OS-level firewall to allow only necessary traffic. On Linux systems with iptables or firewalld, this means explicitly allowing inbound traffic on ports like 22 (SSH) or 80/443 (web traffic) and denying everything else. Configure SELinux (on Red Hat systems) or AppArmor (on Debian/Ubuntu) for additional mandatory access control.

Set up logging and auditing. Enable audit logging through auditd on Linux, configure CloudWatch agent to ship logs to CloudWatch Logs, and ensure that important events are logged. This might include failed login attempts, privilege escalation, configuration changes, and security-relevant events.

Harden the SSH configuration. Change the default port from 22 if you prefer (though this is security through obscurity and not a substitute for proper firewall rules). Disable password authentication in favor of key-based authentication only. Set `PermitRootLogin no` to prevent direct root login. Disable empty passwords. These changes go in `/etc/ssh/sshd_config`.

Configure the AWS CloudWatch agent to monitor system metrics and log files. This agent collects metrics like CPU, memory, and disk usage, along with custom metrics from your application, and sends them to CloudWatch for monitoring and alerting.

Encrypt the root volume and any additional volumes. This should happen at launch time through your infrastructure-as-code templates, but you can also pre-configure it in the AMI to make it the default for any instances launched from that image.

Create a user that's not root but has sudo privileges for administration. Running as the root user daily is dangerous; a compromised application running as root gives attackers complete system control. Creating an administrative user with sudo access is much safer.

Disable unnecessary kernel modules and network services. This is fine-tuning to reduce attack surface. Some organizations use configuration management tools like Ansible or Chef to fully automate this hardening process, making it reproducible and auditable.

Once your AMI is hardened, you typically create a template for it—either using CloudFormation, Terraform, or other infrastructure-as-code tools—so that launching instances from your hardened image is the default behavior across your organization. You can also use AWS Config rules to detect instances that are running from unapproved AMIs and alert you.

### Putting It All Together: A Practical Patching Strategy

Understanding the shared responsibility model is one thing; actually implementing a solid patching and security strategy is another. Here's how these pieces fit together in practice.

Start with hardened AMIs as your baseline. These should be created according to your organization's security standards, patched regularly, and validated before being approved for production use. Store these in a central AMI repository (within your AWS account or shared through an organizational account) so teams across your organization use the same secure baseline.

As instances run, use Systems Manager Patch Manager to keep them patched. Define patch baselines that match your risk appetite and compliance requirements. Critical security patches might be approved immediately, while less critical patches might require a longer approval window or manual approval. Create maintenance windows that align with your application's tolerance for downtime.

Continuously scan your instances with AWS Inspector to identify vulnerabilities that might have been missed or that might emerge as new threats are discovered. Set up rules to suppress known acceptable risks, but treat new findings seriously.

Layer your defenses with security groups that allow only necessary inbound traffic, with IAM roles that grant instances only the permissions they need, and with OS-level firewalls that further restrict what the instance can do. Defense in depth means multiple layers, so an attacker can't just breach one control and gain full access.

Integrate everything with Security Hub and CloudTrail for visibility and compliance. Use EventBridge to automatically respond to certain findings—for example, automatically stopping instances that fail critical security checks pending investigation.

Document your patching policies, your AMI creation process, and your approval workflows. Make it clear who's responsible for what. If a security incident occurs, you want to be able to explain exactly what your security controls were, how they were configured, and why they may or may not have prevented the incident.

### Conclusion

The EC2 shared responsibility model isn't a limitation; it's a division of labor that allows AWS to focus on the hardest infrastructure problems while you focus on your unique security and business requirements. AWS handles the physical fortress, but you build the defenses inside it. That means you choose how hardened your AMIs are, how aggressively you patch, how tightly you restrict network access, and how you encrypt your data.

With tools like Systems Manager Patch Manager to automate patching at scale, AWS Inspector to continuously scan for vulnerabilities, and the ability to build hardened AMIs as your baseline, you have everything you need to maintain a strong security posture. The key is understanding where your responsibility lies and treating that responsibility seriously. A well-patched, properly configured EC2 instance running on a hardened AMI becomes a much harder target for attackers, and that's the goal.
