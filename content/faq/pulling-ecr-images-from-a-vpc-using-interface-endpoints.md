---
title: "Pulling ECR Images from a VPC Using Interface Endpoints"
---

## Pulling ECR Images from a VPC Using Interface Endpoints

Imagine this scenario: you've architected a secure ECS cluster running in private subnets with no NAT gateway, and you need to pull container images from your private Elastic Container Registry (ECR). Without the right configuration, your tasks will fail silently—unable to reach the registry because there's no route to the internet. This is where VPC interface endpoints (powered by AWS PrivateLink) become essential infrastructure.

In this guide, we'll explore how to configure your VPC so that private subnets can pull ECR images without requiring expensive NAT gateways or internet access. We'll break down why three separate endpoints are needed, walk through the configuration process, examine the IAM and endpoint policies involved, and discuss the cost-benefit analysis of this approach.

### Understanding the Problem: Private Subnets and ECR Access

When you launch an ECS task in a private subnet and it needs to pull an image from ECR, the container runtime must communicate with ECR's public API endpoints. Normally, this requires either a NAT gateway (which adds significant monthly costs) or an internet gateway with public IP addresses (which creates security concerns).

VPC interface endpoints solve this problem by allowing you to access AWS services through private IP addresses within your VPC, never crossing the internet boundary. Think of it as creating private tunnels directly to AWS service endpoints.

However—and this is crucial—pulling images from ECR actually requires communication with multiple AWS services, each with its own endpoint requirements.

### The Three Endpoints You Need

Most developers assume they only need a single ECR endpoint, but the full picture is more nuanced. Let's break down what each endpoint does.

#### ECR API Endpoint (com.amazonaws.region.ecr.api)

This is the primary control plane for ECR. When your container runtime initiates an image pull, it first contacts the ECR API to authenticate, obtain authorization tokens, and retrieve metadata about the image you're requesting. This endpoint handles all the authentication and authorization logic.

Think of this as the gatekeeper. It validates your credentials and tells your container runtime where the actual image layers are stored.

#### ECR DKR Endpoint (com.amazonaws.region.ecr.dkr)

The DKR endpoint (Docker Registry) is where the actual image layers live and are transferred. Once the ECR API has authenticated your request and told your container runtime where to find the layers, the runtime connects to this endpoint to download the actual Docker image data.

These are separate because the API is stateless and scalable, while the DKR endpoint is optimized for high-throughput image downloads. In some cases, you might query one endpoint while downloading from another.

#### S3 Gateway Endpoint (com.amazonaws.region.s3)

Here's the detail many teams miss: ECR stores image layers in S3 behind the scenes. When your container runtime requests layer data, ECR retrieves it from S3. If you don't have an S3 endpoint configured, your ECR endpoint will need to route requests through a NAT gateway to reach S3, defeating the purpose of going private.

With a gateway endpoint for S3, image layers can be accessed entirely within your VPC without any internet routing.

### Step-by-Step Configuration

Let me walk you through configuring these endpoints in a practical, real-world scenario.

#### Prerequisites

You'll need a VPC with at least one private subnet where your ECS tasks will run. You should also have created the IAM role that your ECS tasks assume, and you'll need permissions to create VPC endpoints.

#### Creating the ECR API Interface Endpoint

First, navigate to the VPC console and select "Endpoints" from the menu. Choose "Create endpoint" and search for `com.amazonaws.region.ecr.api` (replace "region" with your AWS region—for example, `com.amazonaws.us-east-1.ecr.api`).

When configuring the endpoint, you'll specify which VPC to use and which subnets should have access to it. It's common to place these endpoints in the same subnets where your ECS tasks run, though you can also place them in separate subnets if you prefer. AWS will create elastic network interfaces in the subnets you specify, and these become the private IP addresses your tasks will reach.

Under "Security groups," create or select a security group that allows inbound traffic on port 443 from your ECS task security groups. The ECR API uses HTTPS exclusively, so you'll need port 443 open.

Leave the "Enable DNS name" option checked—this ensures that when your container runtime tries to reach the ECR API hostname, the VPC's DNS resolver will return the private IP address of the endpoint instead of AWS's public IP address.

#### Creating the ECR DKR Interface Endpoint

Repeat the same process for `com.amazonaws.region.ecr.dkr`, ensuring it's in the same subnets and with the same security group permissions. This endpoint also uses HTTPS on port 443.

#### Creating the S3 Gateway Endpoint

S3 endpoints are created slightly differently. In the VPC console, create a new endpoint and search for `com.amazonaws.region.s3`. Select "Gateway" as the endpoint type (not "Interface"—S3 is one of the few services with its own gateway endpoint type).

For the gateway endpoint, you need to specify which route tables should route S3 traffic through the endpoint. Select all route tables associated with your private subnets. The gateway endpoint automatically manages the routing for you—you don't need to manually create routes.

### IAM and Endpoint Policies

Creating the endpoints is only half the battle. You also need to ensure the right permissions are in place.

#### IAM Role Permissions

Your ECS task execution role must have permissions to pull images from ECR. At minimum, you need:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    }
  ]
}
```

The `GetAuthorizationToken` action retrieves a temporary token for accessing your ECR registry (this is the critical piece—without this, authentication fails). `BatchGetImage` and `GetDownloadUrlForLayer` allow the actual image pulling to succeed.

For more granular control, you can restrict these actions to specific repositories:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:region:account-id:repository/my-app"
    }
  ]
}
```

The `GetAuthorizationToken` action can't be restricted to specific repositories (it's an account-level operation), but the image operations can be.

#### VPC Endpoint Policies

By default, VPC endpoints inherit an allow-all policy. However, for enhanced security, you can restrict what resources can be accessed through each endpoint.

For the ECR API endpoint, a restrictive policy might look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::account-id:role/ecsTaskExecutionRole"
      },
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    }
  ]
}
```

This restricts the endpoint so that only your ECS task execution role can use it for these specific operations.

For the S3 gateway endpoint, you might restrict it to ECR repositories:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::prod-region-starlet-layer-bucket/*"
    }
  ]
}
```

(Note: ECR stores image layers in an AWS-managed S3 bucket; the ARN pattern depends on your region and ECR setup.)

In practice, most teams leave these policies permissive for simplicity, since the primary security boundary is your security groups and IAM role permissions.

### Verifying Your Configuration

Once you've created the endpoints, test them before deploying critical workloads. A simple verification is to launch an EC2 instance or ECS task in your private subnet and attempt to pull an image.

From an ECS perspective, the best test is a dummy task definition that pulls a small public image from your ECR registry:

```json
{
  "family": "test-ecr-pull",
  "taskRoleArn": "arn:aws:iam::account-id:role/ecsTaskRole",
  "executionRoleArn": "arn:aws:iam::account-id:role/ecsTaskExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "test",
      "image": "account-id.dkr.ecr.region.amazonaws.com/my-app:latest",
      "essential": true
    }
  ]
}
```

Launch this in your private subnet. If the task starts successfully and the container image pulls, your endpoints are working. If it fails, check the task logs and verify:

1. Your security groups allow port 443 outbound from the task and inbound to the endpoints
2. The IAM execution role has the required ECR permissions
3. DNS resolution is working (your endpoint names resolve to private IPs, not public ones)

### Cost Implications and Comparison

This is where the business case for VPC endpoints becomes clear. Let's compare the costs.

A NAT gateway costs approximately $0.045 per hour in most regions, plus data processing charges. For continuous usage, that's roughly $32–35 per month per NAT gateway. You typically need one per availability zone for high availability, so a multi-AZ setup costs $65–70 per month just for NAT.

VPC interface endpoints for ECR cost $0.007 per hour per endpoint (so roughly $5 per endpoint per month), and you need two of them (API and DKR). That's $10 per month. S3 gateway endpoints are free.

The total is around $20 per month for the endpoints versus $65–70 for NAT gateways—a significant saving for organizations running multiple ECS clusters or other private workloads.

Additionally, endpoints provide better security isolation. With NAT gateways, all outbound traffic from your private subnet flows through a single point. With endpoints, traffic to AWS services stays entirely within AWS's backbone network, never touching the public internet.

There are trade-offs, of course. Endpoints add some operational complexity (you need to monitor them, understand endpoint failures, and manage endpoint policies). NAT gateways are simpler conceptually but more expensive and less secure for AWS service access specifically.

### Common Pitfalls and Troubleshooting

One frequent mistake is forgetting the S3 gateway endpoint. Your ECR endpoints will work perfectly for metadata operations, but when the container runtime tries to download actual image layers, it will fail because ECR can't route to S3. The error manifests as cryptic "layer not found" messages. Always remember: ECR API + ECR DKR + S3.

Another issue is DNS configuration. If you don't enable the "Enable DNS name" option on your interface endpoints, the private IP addresses won't be registered in your VPC's DNS resolver, and your container runtime will try to reach the public endpoint addresses (which it can't do from a private subnet). Always enable DNS names for interface endpoints.

Security group misconfiguration is also common. Ensure that the security group attached to your ECR endpoints allows inbound HTTPS (port 443) from your task security groups. The interface endpoints are like services listening on port 443, so they need to accept traffic.

Finally, remember that endpoints are regional. If you're pulling images in multiple regions, you'll need to create endpoints in each region where you have workloads.

### Advanced Configurations

For teams managing multiple environments or accounts, consider creating endpoints as part of your infrastructure-as-code templates using CloudFormation or Terraform. This ensures consistency across your organization and makes it easy to replicate setups.

You can also combine endpoints with VPC sharing (using AWS Resource Access Manager) to centralize endpoint infrastructure in a network hub account while allowing multiple workload accounts to use them. This reduces duplication and simplifies management at scale.

For cost optimization, if you're already using an NAT gateway for general internet access (perhaps for pulling images from Docker Hub or downloading packages), you might not need ECR endpoints—the trade-off depends on your specific traffic patterns and priorities.

### Conclusion

Pulling ECR images from private subnets without NAT gateways is entirely feasible and cost-effective when you understand the full picture: the ECR API endpoint handles authentication, the ECR DKR endpoint handles image downloads, and the S3 gateway endpoint ensures that layer data stays within your VPC. Together, these three components create a secure, private path to your container images.

The configuration is straightforward—a few clicks in the VPC console and some IAM policy adjustments—but it requires attention to detail. Forget one endpoint or misconfigure a security group, and your deployments will fail mysteriously. Follow the patterns outlined in this guide, test thoroughly, and you'll have a robust, private image pulling infrastructure that's more secure and significantly cheaper than NAT-based alternatives.
