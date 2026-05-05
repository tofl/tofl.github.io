---
title: "VPC Endpoints for Fargate Tasks in Private Subnets"
---

## VPC Endpoints for Fargate Tasks in Private Subnets

Running containerized workloads in AWS Fargate gives you the convenience of managed container orchestration without managing the underlying infrastructure. But there's a catch that many developers encounter: when you deploy Fargate tasks to private subnets—which is often the right security choice—those tasks suddenly can't reach AWS services like ECR, Secrets Manager, or CloudWatch Logs without some form of outbound network path.

The traditional solution has been to route outbound traffic through a NAT Gateway, which sits in a public subnet and translates private IP addresses to public ones. However, NAT Gateways come with steady-state costs and data processing charges that can add up quickly. More importantly, there's a more elegant solution that keeps your traffic entirely within the AWS network: VPC endpoints.

This guide walks you through implementing a cost-effective, secure architecture for running Fargate tasks in fully private subnets using VPC endpoints. You'll learn which endpoints you actually need, how to configure them correctly, and when this approach makes sense compared to traditional NAT-based designs.

### Understanding the Private Fargate Problem

When a Fargate task runs in a private subnet without a NAT Gateway, it faces a fundamental limitation: it can't initiate outbound connections to the internet or to AWS service endpoints that live outside the VPC. This becomes a real problem during task startup, because Fargate needs to pull container images from Amazon ECR, fetch secrets and configuration from AWS Secrets Manager, and send logs to CloudWatch.

Think of it this way: your task is sitting in an isolated network room with no door to the outside world. It can receive traffic from within the VPC, but it can't reach out. A NAT Gateway would be like installing a one-way door to a public hallway—useful, but it requires infrastructure and ongoing costs. VPC endpoints, by contrast, are like having the services you need delivered directly into your private network.

VPC endpoints are elastic network interfaces (ENIs) that you create within your VPC, providing a private connection to AWS services. There are two types: interface endpoints (powered by AWS PrivateLink) and gateway endpoints. For Fargate workloads in private subnets, you'll typically need both.

### The Essential VPC Endpoints for Fargate

Let's break down which endpoints your Fargate tasks actually require. This is important because each interface endpoint incurs a small hourly charge, so you want to be intentional about what you create.

**ECR API Endpoint** handles the authentication and manifest retrieval when pulling images. When your task boots, it needs to authenticate to ECR and download image metadata—this is what the ECR API endpoint provides. Without it, the task can't even begin the image pull process.

**ECR DKR Endpoint** (Docker-compatible endpoint) handles the actual image layer downloads. Once Fargate knows which layers it needs, it downloads the actual container image data through this endpoint. Both the ECR API and ECR DKR endpoints are interface endpoints that you'll create in your VPC.

**Secrets Manager Endpoint** lets your tasks fetch secrets and database credentials at runtime. Many containerized applications need to retrieve sensitive data—database passwords, API keys, encryption keys—and this endpoint provides that access without requiring internet routing.

**Systems Manager Parameter Store Endpoint** (often listed as the "SSM" endpoint) works similarly to Secrets Manager but for configuration data and parameters. While not always required, it's common in modern applications that separate configuration from secrets.

**CloudWatch Logs Endpoint** enables your tasks to stream application logs directly to CloudWatch Logs. Without this endpoint, logs would have nowhere to go unless you route them through a NAT Gateway.

**STS Endpoint** (Security Token Service) is needed if your tasks assume IAM roles or if you're using temporary credentials. The Fargate agent uses this to fetch temporary credentials if you're not using the task's primary execution role.

**S3 Gateway Endpoint** deserves special mention because it's different from interface endpoints. While interface endpoints are created as network interfaces within your VPC, the S3 gateway endpoint is configured as a route table entry. This endpoint is particularly important for Fargate because container image layers are stored in S3. Even though you're pulling through ECR, the underlying data comes from S3, and having a gateway endpoint optimizes that path and eliminates data transfer charges for S3 access within the same region.

### The Architecture in Practice

Here's what a typical setup looks like: You have a VPC with private subnets where your Fargate tasks run. These subnets have no NAT Gateway and no route to an internet gateway. Instead, you've created interface endpoints for ECR API, ECR DKR, Secrets Manager, SSM, CloudWatch Logs, and STS. Additionally, you've added an S3 gateway endpoint that applies to the route tables associated with your private subnets.

When a task launches, here's the flow: The task's container image location is pulled from your Fargate task definition. The task container agent reaches out through the ECR API endpoint to authenticate and fetch the image manifest. Once it has the manifest, it uses the ECR DKR endpoint to download the actual image layers from the container registry. Layer data resides in S3, so that traffic uses the S3 gateway endpoint, avoiding the internet gateway entirely.

As the application boots, if it needs to fetch database credentials or API keys, it calls the Secrets Manager endpoint. Any configuration parameters come through the SSM endpoint. Application logs stream to CloudWatch through the CloudWatch Logs endpoint. Throughout this process, if the application or the task execution role needs to assume a different role or refresh temporary credentials, the STS endpoint handles that.

All of this happens entirely within the AWS network backbone, never touching the public internet.

### Security Benefits Beyond Cost

While the cost comparison between NAT Gateways and VPC endpoints is important, the security advantages are equally compelling. NAT Gateways, by necessity, route your outbound traffic to the internet. Even though the traffic is destined for AWS services, it technically leaves your VPC and traverses the internet path. This creates a larger attack surface and potential compliance complications, especially in regulated industries.

VPC endpoints keep traffic within the AWS network boundary. Your Fargate tasks never communicate across the public internet, even though they're reaching AWS services. This is particularly valuable if your organization has compliance requirements around data residency or network isolation. It's also beneficial from a security posture perspective: with fewer egress paths, you have fewer places where traffic can be intercepted or inspected by external actors.

Additionally, you can attach security groups to interface endpoints, allowing you to control exactly which resources within your VPC can communicate with each service. You could, for example, create a security group that only allows traffic from your ECS task security group to your Secrets Manager endpoint, providing fine-grained access control.

### Cost Comparison: NAT Gateway vs. VPC Endpoints

Let's talk numbers, because cost is often the deciding factor in architectural decisions. A NAT Gateway costs roughly $0.045 per hour (at typical US pricing), which adds up to about $32 per month if you're running it continuously. Additionally, you pay for data processing at $0.045 per gigabyte. For a typical microservice pulling images regularly, data costs can be significant.

VPC interface endpoints cost approximately $0.007 per hour each, per availability zone. If you deploy endpoints across two availability zones for redundancy—which is recommended for production—and you're using five interface endpoints, you're looking at roughly 70 endpoints-hours per month across all zones, or about $2 per month in endpoint costs. S3 gateway endpoints are free.

The math clearly favors VPC endpoints for scenarios where you're not running heavy, persistent outbound traffic to non-AWS services. However, if your applications need to communicate with external APIs or services on the public internet, you'll still need a NAT Gateway. The VPC endpoint approach works best when your primary outbound needs are AWS service access.

### Setting Up VPC Endpoints for Fargate

Creating VPC endpoints involves a few straightforward steps. In the VPC console or via AWS CLI, you navigate to the Endpoints section and create a new endpoint. For interface endpoints, you specify the service (like `com.amazonaws.us-east-1.ecr.api`), select your VPC, choose which subnets to place the endpoints in (ideally across multiple availability zones), and assign security groups that control access.

Here's a sample CLI command to create the ECR API endpoint:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.ecr.api \
  --subnet-ids subnet-abcd1234 subnet-efgh5678 \
  --security-group-ids sg-ecr-endpoint
```

For the S3 gateway endpoint, you'd use:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --vpc-endpoint-type Gateway \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-private1 rtb-private2
```

One critical detail: the service name includes your region. If you're in `eu-west-1`, your ECR API service would be `com.amazonaws.eu-west-1.ecr.api`. Make sure to get the region right, or your endpoint won't work.

After creating endpoints, you need to configure the security groups attached to interface endpoints. Create a security group for each logical grouping of services, or a single security group if you prefer simplicity. The inbound rule should allow HTTPS traffic (port 443) from your task security group or the CIDR range of your private subnets.

### Configuring Security Groups and IAM

Security groups on VPC endpoints act as an additional layer of access control. Create a security group specifically for your VPC endpoints and attach it to all interface endpoints. Then configure an inbound rule that allows TCP port 443 (HTTPS) from your ECS task security group.

Your Fargate task's security group should have an outbound rule allowing HTTPS to the endpoint security group. If you're being explicit about outbound rules (rather than allowing all outbound traffic), this is essential. Most tasks use a permissive outbound rule that allows traffic to any destination on port 443, which implicitly covers the endpoints.

Beyond security groups, ensure your task execution role has the correct IAM permissions. For ECR access, your task execution role needs permissions like `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and `ecr:BatchCheckLayerAvailability`. For Secrets Manager, it needs `secretsmanager:GetSecretValue`. These permissions should already be present if you're using the standard ECS task execution role policies, but double-check if you're using a custom role.

### Availability Zone Considerations

When creating interface endpoints, AWS asks you to specify which subnets (and thus availability zones) the endpoint should be accessible from. For production workloads, it's essential to spread endpoints across at least two availability zones. This ensures that if one AZ experiences issues, your tasks in another AZ can still pull images and access services.

When you create an endpoint across multiple subnets, AWS automatically creates an ENI in each subnet. These ENIs share the same endpoint service name, so your tasks can reference a single endpoint name and AWS handles the routing to whichever AZ is appropriate. This makes the configuration transparent to your applications.

### DNS Resolution for Endpoints

By default, when you create an interface endpoint, you can enable DNS names for the endpoint. For example, the ECR API endpoint can be reached at `api.ecr.us-east-1.amazonaws.com` (the standard AWS service name) if you enable private DNS name association. This is incredibly convenient because your tasks don't need to know about the endpoint's existence—they use the standard AWS service names, and the VPC's DNS resolver automatically routes those requests to the local endpoint.

Enabling private DNS names is almost always the right choice for Fargate workloads. It means you don't have to modify your application code or container configuration to use endpoints; everything works transparently.

### Troubleshooting Common Issues

When endpoints aren't working as expected, the problems usually fall into a few categories. If your task can't pull images, first verify that the ECR API and ECR DKR endpoints exist and are in subnets your tasks can reach. Check that the security groups attached to the endpoints allow inbound HTTPS traffic from your task security group.

If tasks can pull images but can't access Secrets Manager, verify the Secrets Manager endpoint exists and its security group allows your task's traffic. A common mistake is creating endpoints in specific subnets but forgetting that tasks might be running in different subnets—always ensure endpoints are in the same subnets as your tasks, or in subnets they can route to.

DNS resolution issues are another common culprit. If private DNS name association isn't enabled, your tasks will try to resolve service names like `secretsmanager.us-east-1.amazonaws.com` through the internet, which fails without a NAT Gateway. Enable private DNS names on all interface endpoints to avoid this.

Finally, if you see timeout errors, it's often a network ACL issue. Ensure your private subnets' network ACLs allow inbound traffic on ephemeral ports from the endpoint subnets, and outbound HTTPS traffic to them. Most default network ACLs handle this, but custom configurations sometimes have gaps.

### When to Use NAT Gateways Instead

VPC endpoints aren't universally better—they're better for a specific use case. If your Fargate tasks need to reach external services on the public internet—third-party APIs, webhooks, or services outside AWS—you'll need a NAT Gateway or a NAT instance. VPC endpoints only work for AWS services; they don't provide general internet access.

Similarly, if your workload involves substantial data transfer to services outside AWS, the data processing costs of a NAT Gateway might be unavoidable. VPC endpoints also work best in regions where all the services you need have endpoint support. While major services like ECR, Secrets Manager, and CloudWatch Logs are available in all regions, some newer or less common services might not be.

For development or testing environments where you're not concerned about costs, a NAT Gateway might be simpler to set up and reason about. There's something to be said for operational simplicity when it matters more than cost optimization.

### A Reference Architecture

Imagine you're building a microservices application running on Fargate. You have a VPC with two availability zones. In each zone, you have a private subnet where your Fargate tasks run. You create interface endpoints for ECR API, ECR DKR, Secrets Manager, SSM, CloudWatch Logs, and STS, spreading each across both AZs. You add an S3 gateway endpoint to the route tables of your private subnets.

Your Fargate tasks have a task execution role that includes permissions to pull from ECR, fetch secrets, and write logs. When a task starts, it uses the task execution role to assume credentials through the STS endpoint. It then pulls its container image through ECR API and ECR DKR, with layer data flowing through the S3 gateway endpoint. Once running, the application fetches its database password through Secrets Manager and streams logs to CloudWatch Logs. Everything stays within the VPC, costs are low, and the security posture is strong.

This architecture is particularly powerful when combined with other VPC security features like VPC Flow Logs, which let you monitor and audit all the traffic flowing through your endpoints. You get complete visibility into which tasks are accessing which services and when.

### Closing Thoughts

Running Fargate tasks in fully private subnets using VPC endpoints is a powerful pattern that combines security, cost efficiency, and operational elegance. By understanding which endpoints you need, how to configure them correctly, and when they make sense compared to alternatives, you can build container architectures that are both cost-effective and secure.

The shift from NAT Gateway-based designs to endpoint-based designs is becoming increasingly common as teams recognize the benefits. The financial case is compelling, the security advantages are real, and the implementation is straightforward. If you're running containerized workloads in AWS, understanding this pattern is essential to making informed architectural decisions.
