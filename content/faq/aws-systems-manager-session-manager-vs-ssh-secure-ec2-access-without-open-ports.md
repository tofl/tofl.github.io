---
title: "AWS Systems Manager Session Manager vs SSH: Secure EC2 Access Without Open Ports"
---

## AWS Systems Manager Session Manager vs SSH: Secure EC2 Access Without Open Ports

Imagine needing to troubleshoot an EC2 instance deep within a private subnet—one with no inbound SSH access, no bastion host, and no way to open port 22 without compromising your security posture. A few years ago, this scenario would have felt constraining. Today, AWS Systems Manager Session Manager offers a modern, audit-friendly alternative that eliminates the friction of traditional SSH access while dramatically improving your security baseline.

If you've grown comfortable with SSH keys and port 22, the shift toward Session Manager might feel like unnecessary complexity at first glance. But once you understand how it works and why it matters, you'll recognize it as a significant step forward in cloud security and operational visibility. This article walks you through the essentials: how Session Manager functions, what prerequisites and permissions you need, how it compares to SSH, and practical scenarios where it shines.

### Understanding the Fundamentals of Session Manager

Session Manager is a capability within AWS Systems Manager that lets you start a secure shell session to your EC2 instances—or on-premises servers—directly from the AWS Management Console, AWS CLI, or the Systems Manager console. The magic lies in how it achieves this: instead of opening inbound port 22 to the internet or maintaining bastion hosts, Session Manager establishes outbound connections from your instances to Systems Manager over HTTPS.

This outbound-only model is a fundamental departure from traditional SSH. When you launch an EC2 instance with the SSM Agent installed and proper IAM permissions, that instance can reach out to the Systems Manager API endpoints. The agent then handles the session communication, effectively turning the instance into a client that initiates contact rather than a server waiting for inbound connections. From your workstation, you don't connect directly to the instance's network interface; instead, you communicate with the Systems Manager service, which relays your commands and streams output back to you.

The practical implication is profound: your instances can remain in private subnets with restrictive security groups, and you still gain shell access. No open ports, no key management headaches, and full audit trails of who accessed what and when.

### The SSM Agent Prerequisite

Before Session Manager can work, your EC2 instance must run the SSM Agent. This lightweight process, developed and maintained by AWS, acts as the bridge between your session requests and the instance's operating system.

Amazon Linux 2, Ubuntu 16.04 and later, and Windows Server instances ship with the SSM Agent pre-installed and enabled by default. If you're using older Amazon Linux (version 1), CentOS, or custom AMIs, you'll need to install it manually. The installation process is straightforward: for Amazon Linux and RHEL-based distributions, you can use the package manager or download the agent from the AWS Systems Manager documentation. For Windows, AWS provides an MSI installer.

The agent runs continuously in the background, maintaining a connection to the Systems Manager service. It consumes minimal resources—typically less than 1% CPU and a few MB of memory on idle instances—so it won't impact your workloads.

A common misconception is that the SSM Agent requires an internet connection. If your instance lives in a private subnet without NAT, you'll need VPC endpoints for Systems Manager services. We'll cover that in detail later, but the key point is that the agent needs a reliable path to reach Systems Manager infrastructure, whether that's through NAT Gateway, NAT Instance, or VPC endpoints.

### IAM Roles: The AmazonSSMManagedInstanceCore Policy

Before your instance can use Session Manager, it must have an IAM role with the appropriate permissions. This is where many people stumble, so let's break it down clearly.

Every EC2 instance needs an instance profile—an IAM role that's attached to the instance. This role defines what AWS API actions the instance itself can perform. For Session Manager to function, the instance role must include a policy that grants permission to interact with Systems Manager services.

AWS provides a managed policy called `AmazonSSMManagedInstanceCore` that includes all the permissions your instance needs. This policy grants the SSM Agent the ability to register with Systems Manager, report its status, process session requests, and communicate with the Systems Manager service endpoints.

Here's what that policy covers at a high level: it allows the instance to call the `ssm:UpdateInstanceInformation` action (so the instance can tell Systems Manager it's alive and healthy), `ssmmessages:CreateControlChannel` and `ssmmessages:CreateDataChannel` (for establishing the bidirectional communication channel), and `ec2messages:AcknowledgeMessage` (for acknowledging receipt of messages). It also includes `s3:GetEncryptionConfiguration` if you plan to log sessions to S3.

In practice, when you create an EC2 instance through the console or via Terraform, you attach this managed policy to the instance role. You don't need to create custom policies for basic Session Manager functionality; the managed policy covers the common use case comprehensively.

If you're using Infrastructure as Code, it looks something like this in Terraform:

```hcl
resource "aws_iam_role" "ec2_role" {
  name = "my-ec2-session-manager-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_managed_instance_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "my-ec2-session-manager-profile"
  role = aws_iam_role.ec2_role.name
}

resource "aws_instance" "example" {
  ami             = "ami-0c55b159cbfafe1f0"
  instance_type   = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name
}
```

Without this role and policy, your instance won't be able to communicate with Systems Manager, and attempts to start a session will fail with permission errors.

### User Permissions: Granting Your Team Access to Sessions

While the instance role defines what the instance can do, you also need to control who in your organization can initiate sessions to instances. This is where user-side IAM permissions come into play.

A developer or operations engineer who wants to start a Session Manager session needs an IAM identity (user, role, or group) with the `ssm:StartSession` permission. This permission is the gatekeeper; without it, even if the instance is perfectly configured, the user can't establish a session.

For basic access, you might attach the `AmazonSSMFullAccess` managed policy, but that's overly permissive. A more refined approach uses the `AmazonSSMPatchAssociation` and `AmazonSSMMaintenanceWindowCore` policies if you're managing patches, or you craft a custom policy that grants only `ssm:StartSession` and related read permissions.

Here's a minimal policy that lets a user start sessions on instances tagged with a specific environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:StartSession",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringLike": {
          "ssm:resourceTag/Environment": "production"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": "ssm:DescribeInstanceInformation",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "ec2:DescribeInstances",
      "Resource": "*"
    }
  ]
}
```

This policy restricts sessions to instances with an `Environment=production` tag, reducing the blast radius if a developer's credentials are compromised. The `DescribeInstanceInformation` and `DescribeInstances` permissions allow the user to list instances and see which ones are available for session access.

You can further refine this by restricting sessions to specific instance IDs, regions, or adding a condition that requires MFA. The level of granularity depends on your organization's risk tolerance and compliance requirements.

### How Session Manager Eliminates SSH Friction

To appreciate Session Manager's value, let's contrast it with traditional SSH access.

With SSH, you typically manage EC2 key pairs. You generate or import a key pair in AWS, distribute the private key to team members (often via email or a secrets vault), and rely on those individuals not to lose, share, or accidentally commit the key to a repository. Each developer must have the key material in their `.ssh` directory. Revoking access means rotating keys and redeploying them across the team.

Additionally, SSH requires inbound network access on port 22. If your instances are in a private subnet, you'd need a bastion host—a separate, hardened instance that sits in a public subnet and routes SSH traffic to your private instances. Managing and securing the bastion adds operational overhead.

Session Manager sidesteps these problems. There are no key pairs to distribute or rotate. Access control is entirely IAM-based, so you grant or revoke permissions by updating IAM policies. Adding a new engineer to your team? Update their IAM policy. Removing one? Remove their policy. No SSH key logistics.

Since Session Manager uses outbound HTTPS to communicate with Systems Manager, you don't need inbound port 22. Your instances can live in private subnets with security groups that allow no inbound traffic. You gain shell access without expanding your attack surface.

The tradeoff is that you're now dependent on the SSM Agent and Systems Manager availability. If the agent crashes or Systems Manager is unavailable (rare but possible), you lose shell access. With SSH, as long as the SSH daemon is running and the network path exists, you're in. Some teams maintain both SSH and Session Manager for redundancy during incidents.

### Port Forwarding and Accessing Private Services

One scenario where developers often default to SSH is port forwarding. Imagine you have a Redis instance in a private subnet and need to connect to it from your workstation. With SSH, you'd set up a tunnel: `ssh -L 6379:redis-instance:6379 bastion-host`, which binds a local port and forwards traffic through the bastion to Redis.

Session Manager handles this elegantly through the Systems Manager document `AWS-StartPortForwardingSession`. Instead of SSH tunneling, you run a command that opens a port forward through the Session Manager connection.

Here's how it works in practice:

```bash
aws ssm start-session \
  --target i-1234567890abcdef0 \
  --document-name AWS-StartPortForwardingSession \
  --parameters "localPortNumber=6379,portNumber=6379,host=redis-instance.internal"
```

This command starts a Session Manager session and establishes a port forward. Your workstation listens on local port 6379, and traffic is forwarded through the session to the Redis instance on port 6379. You can then connect your Redis client to `localhost:6379` as though Redis were running locally.

This approach is particularly useful for accessing databases, caches, and internal APIs that live in private subnets. You get the same functionality as SSH port forwarding without the bastion infrastructure.

The document `AWS-StartInteractiveCommand` is another useful companion, allowing you to run a single command on an instance without a full shell session, making it ideal for scripted operations.

### Audit Logging: Complete Visibility into Access

Here's where Session Manager truly differentiates itself from SSH: built-in, comprehensive audit logging.

Every action taken within a Session Manager session can be logged to CloudWatch Logs, S3, or both. These logs include session start and end times, which user initiated the session, which instance was accessed, and optionally, the full transcript of commands and their output.

To enable logging, you configure a session preferences document. This is a JSON document stored in Systems Manager Documents that defines where logs should be sent. You can specify a CloudWatch Logs group and retention period, an S3 bucket for archival, and whether to enable KMS encryption for S3 logs.

Here's an example session preferences document:

```json
{
  "schemaVersion": "1.0",
  "description": "Default logging settings for Session Manager",
  "sessionType": "Standard_Stream",
  "inputs": {
    "s3BucketName": "my-session-logs-bucket",
    "s3KeyPrefix": "session-logs/",
    "s3EncryptionEnabled": true,
    "cloudWatchLogGroupName": "/aws/ssm/session-logs",
    "cloudWatchEncryptionEnabled": true,
    "idleSessionTimeout": "20",
    "maxSessionDuration": "60",
    "kmsKeyId": "arn:aws:kms:region:account-id:key/key-id"
  }
}
```

Once enabled, every session is logged. This provides compliance audits with irrefutable evidence of who accessed which instances and when. If a security incident occurs, you can review the session transcript to see exactly what commands were run. This level of visibility is difficult to achieve with SSH without additional tooling like auditd or session recording proxies.

CloudWatch Logs integration allows you to set up alarms based on specific commands or patterns. For instance, you could alert if someone runs `sudo` commands or attempts to access sensitive files. S3 integration provides long-term, immutable storage suitable for compliance requirements.

### Working with Private Subnets and VPC Endpoints

A frequent question arises: what if my instance is in a private subnet with no internet access? How does it reach Systems Manager?

The answer is VPC endpoints. AWS Systems Manager consists of several underlying services: `ssm` (for the core Systems Manager API), `ssmmessages` (for session communication), `ec2messages` (for EC2-specific management), and optionally `s3` and `kms` (if you're logging to S3 with KMS encryption).

VPC endpoints are network interfaces within your VPC that provide private connectivity to AWS services. By creating VPC endpoints for these services, your instances can reach Systems Manager infrastructure without routing traffic through the internet gateway or NAT.

Creating VPC endpoints for Session Manager is straightforward. You specify the VPC, subnets, and security groups, and AWS provisions the endpoint. Here's a conceptual example using the AWS CLI:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.region.ssm \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-12345678 \
  --security-group-ids sg-12345678
```

You'd repeat this for `ssmmessages` and `ec2messages`. The security group attached to the endpoints should allow inbound HTTPS (port 443) from your instance security group. Once the endpoints are active, instances in your VPC can communicate with Systems Manager services privately.

The beauty of this setup is that your instances can remain completely isolated from the internet—no NAT Gateway, no internet gateway, just private subnets connected to VPC endpoints. Session Manager still works flawlessly because the agent can reach Systems Manager through the endpoints.

### Practical Comparison: SSH vs Session Manager

Let's ground this in a real scenario. Suppose you're running a production microservices environment with 50 instances spread across multiple private subnets.

With SSH, you'd manage 50 SSH key pairs (or fewer if you use a shared key, which introduces security risks). You'd need a bastion host or two for redundancy. Every developer who joins the team needs the SSH private key. Offboarding means rotating keys. Debugging an issue requires SSH access to jump through bastions and tunnel to the target instance. Auditing who accessed what requires parsing SSH logs across multiple systems.

With Session Manager, you attach the `AmazonSSMManagedInstanceCore` policy to each instance once during launch. Developers authenticate via IAM, so their access is tied to their corporate identity. Onboarding a new engineer means adding them to an IAM group with the appropriate Session Manager policy. Offboarding removes their IAM permissions automatically. Debugging is as simple as running `aws ssm start-session --target instance-id`. Session Manager logs every action to CloudWatch Logs and S3 automatically, providing compliance-ready audit trails.

The administrative overhead is dramatically lower, and security posture is stronger.

### Limitations and When SSH Still Matters

Session Manager isn't a universal replacement for SSH, and acknowledging its limitations is important.

First, Session Manager depends on the SSM Agent and Systems Manager availability. If the agent crashes and you can't restart it remotely, you're stuck. SSH, by contrast, is a separate service and doesn't require external service dependencies. Some teams maintain SSH access as a fallback for critical incident scenarios.

Second, Session Manager's performance over high-latency or unreliable networks might be inferior to SSH. SSH is optimized for low-bandwidth scenarios, while Session Manager prioritizes security and auditability. In most cases, the difference is imperceptible, but on very poor connections, SSH might feel snappier.

Third, legacy tooling and scripts built around SSH might not immediately translate to Session Manager. While the AWS CLI and most modern tools support Session Manager natively, some older applications expect to open SSH connections directly. Adapting these requires some work.

Finally, while Session Manager handles port forwarding via `AWS-StartPortForwardingSession`, some advanced SSH features like SFTP or X11 forwarding aren't directly supported. However, Systems Manager documents can be customized to support SFTP if needed.

### Getting Started with Session Manager

Here's a practical roadmap to adopt Session Manager:

Start by ensuring your instances have the SSM Agent installed and the `AmazonSSMManagedInstanceCore` IAM role attached. If you're launching new instances, include these in your launch templates. For existing instances, you can update the role and wait for the agent to auto-update.

Next, configure logging. Create a CloudWatch Logs group and optionally an S3 bucket. Define a session preferences document in Systems Manager Documents with your logging configuration, and set it as the default for your account.

Grant developers IAM permissions to start sessions using a policy like the one shown earlier. Test by having a developer start a session to a non-critical instance and verify that logs appear in CloudWatch and S3.

Document the transition for your team. Show them how to use `aws ssm start-session` from the CLI or use the console's Session Manager interface. If they're accustomed to SSH, explain the security and audit benefits.

Finally, monitor adoption. Use CloudWatch to track session frequency and duration. Set up alarms for suspicious patterns. Over time, you'll likely find that Session Manager becomes the default and SSH becomes the exception.

### Conclusion

AWS Systems Manager Session Manager represents a modernization of secure instance access. By eliminating the need for SSH key management, inbound port 22, and bastion hosts, it simplifies operations while strengthening security. The IAM-based access control and comprehensive audit logging address compliance and incident response challenges that SSH leaves to custom solutions.

The prerequisites are straightforward: the SSM Agent on your instances, the `AmazonSSMManagedInstanceCore` role, and appropriate user-side IAM permissions. For private subnets, VPC endpoints ensure connectivity without internet exposure.

While SSH still has a place in your toolkit—particularly as a fallback—Session Manager has become the standard for most organizations. If you're managing EC2 instances and haven't yet explored Session Manager, the investment to set it up pays dividends in security, auditability, and operational simplicity. Start with a pilot group of instances, evaluate the experience, and scale from there.
