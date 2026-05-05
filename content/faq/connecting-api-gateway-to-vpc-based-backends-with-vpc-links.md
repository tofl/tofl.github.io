---
title: "Connecting API Gateway to VPC-Based Backends with VPC Links"
---

## Connecting API Gateway to VPC-Based Backends with VPC Links

Imagine you're building a multi-tier application where your sensitive business logic runs on EC2 instances or private Application Load Balancers deep within your Virtual Private Cloud. You need to expose these backends through API Gateway for external clients, but the idea of routing traffic across the public internet—even with authentication—makes your security team nervous. This is where VPC Links come in.

VPC Links are AWS's elegant solution for connecting API Gateway directly to private resources within your VPC without ever exposing those resources to the internet. They establish a secure, private communication channel that keeps your backend infrastructure hidden from public view while still allowing controlled API access. In this guide, we'll walk through the entire process: architecting a VPC Link setup, configuring it with a Network Load Balancer, integrating it into API Gateway, managing security, monitoring health, and understanding the cost implications.

### Understanding VPC Links and Why They Matter

A VPC Link acts as a bridge between API Gateway and your VPC resources. Think of it as a private tunnel that allows API Gateway to route requests directly to backends that live in your VPC, whether those are EC2 instances running behind a Network Load Balancer, an internal Application Load Balancer, or even a private HTTP endpoint.

Without VPC Links, you'd face a few unappealing options. You could expose your backends to the internet, which introduces security risks. You could use a NAT gateway or bastion host as an intermediary, adding complexity and potential latency. Or you could deploy your application entirely outside the VPC, sacrificing the security and isolation benefits of running in a Virtual Private Cloud. VPC Links sidestep all these compromises.

The magic works like this: API Gateway doesn't directly connect to your backend resources. Instead, it connects to a VPC Link, which in turn connects to a Network Load Balancer (NLB) that you deploy within your VPC. The NLB then distributes traffic to your actual backend resources—EC2 instances, containerized workloads, Lambda functions, or other internal services. From the client's perspective, they're calling a standard API Gateway endpoint. From your infrastructure's perspective, that traffic never leaves your VPC.

### Architecting Your VPC Link Solution

Before you create anything, you need a clear mental model of what you're building. Let's walk through a realistic scenario.

Suppose you have a VPC with a private subnet containing three EC2 instances running a Node.js application. These instances are registered with a Network Load Balancer in the same VPC. API Gateway sits outside the VPC (it's a managed service), and you want external clients to call an API that routes through API Gateway to your private EC2 instances.

The architecture flows like this: Client → API Gateway → VPC Link → Network Load Balancer → EC2 Instances. Each arrow represents a connection that you'll need to secure and configure.

The Network Load Balancer is critical here. It must be in the same VPC as your backend resources, and it must be configured to listen on a port (typically 443 for HTTPS or 80 for HTTP) and forward traffic to your backend targets. The VPC Link itself is a logical construct that holds configuration for this connection—specifically, the VPC, subnets, and security groups that API Gateway needs to know about to establish the private connection.

One important architectural decision: your NLB can be internal (not exposed to the internet) or internet-facing. For a VPC Link setup, an internal NLB is perfectly fine—in fact, it's slightly more secure since it has no public IP addresses. API Gateway accesses it via VPC endpoints and private IP routing, not through the internet gateway.

### Prerequisites and Setup

Before creating a VPC Link, ensure you have the following in place:

**A VPC with at least two availability zones**: VPC Links distribute across multiple availability zones for high availability, so your target load balancer and backend resources should span at least two AZs.

**A Network Load Balancer**: This is the mandatory target for a VPC Link. Create or identify an NLB that sits in front of your backend resources. The NLB should have a target group configured (for example, EC2 instances registered as targets) and a listener configured to accept traffic on your desired port.

**Appropriate security groups**: Both the NLB and your backend instances need security groups that allow traffic to flow from API Gateway through the VPC Link.

**An API Gateway REST API**: You'll need an existing REST API in API Gateway where you'll configure the VPC Link integration.

Let me walk through setting up a simple backend infrastructure to demonstrate. First, you'd create a Network Load Balancer. Using the AWS CLI:

```bash
aws elbv2 create-load-balancer \
  --name my-internal-nlb \
  --subnets subnet-12345678 subnet-87654321 \
  --type network \
  --scheme internal \
  --region us-east-1
```

Note the `--scheme internal` flag—this keeps the NLB private. Store the NLB's ARN; you'll need it when creating the VPC Link.

Next, create a target group for your EC2 instances:

```bash
aws elbv2 create-target-group \
  --name my-backend-targets \
  --protocol TCP \
  --port 8080 \
  --vpc-id vpc-12345678 \
  --target-type instance \
  --region us-east-1
```

Register your EC2 instances with this target group, then create a listener on the NLB that forwards traffic from port 443 (or 80) to your target group on port 8080.

### Creating the VPC Link

With your NLB in place and properly configured, you're ready to create the VPC Link. This is where the actual magic is configured. You can do this through the AWS Management Console or the CLI.

Using the CLI, the command looks like this:

```bash
aws apigateway create-vpc-link \
  --name my-vpc-link \
  --description "VPC Link to private backend" \
  --target-arns arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/my-internal-nlb/1234567890123456 \
  --region us-east-1
```

The critical parameter here is `--target-arns`, which is the ARN of your Network Load Balancer. You can specify multiple NLB ARNs if you want failover capability (though they must be in the same VPC).

When you run this command, AWS creates the VPC Link in a "pending" state. Behind the scenes, AWS is provisioning Elastic Network Interfaces (ENIs) in your VPC subnets, establishing the connection to your NLB, and performing health checks. This process typically takes two to five minutes.

You can check the status with:

```bash
aws apigateway get-vpc-link \
  --vpc-link-id 1a2b3c4d5e \
  --region us-east-1
```

Look for the status field to change from "pending" to "available". Until it's available, you can't use it in your API Gateway configuration.

### Configuring API Gateway Integration

Once your VPC Link is available, you need to set up the integration in API Gateway. Navigate to your API, create or select a resource and method (for instance, a GET method on a `/products` resource), and configure the integration type.

In the API Gateway console, when you create a new integration, you'll see options like "HTTP", "AWS Service", "AWS Proxy", and so on. For VPC Link integration, you typically select "HTTP" or "HTTP Proxy" (depending on whether you want full request/response transformation control or simple passthrough).

Here's the key part: in the HTTP endpoint URL field, you don't enter the NLB's actual IP address or hostname. Instead, you enter the hostname that the NLB will recognize. For example, if your backend application expects requests to a specific host header, you'd enter that. A common pattern is to use the NLB's internal DNS name:

```
http://my-internal-nlb-1234567890.elb.us-east-1.amazonaws.com/
```

Then, critically, you must check the **VPC Link** option and select the VPC Link you just created.

If you're using the CloudFormation or Terraform route, here's what the resource definition looks like in CloudFormation:

```yaml
MyIntegration:
  Type: AWS::ApiGateway::Integration
  Properties:
    RestApiId: !Ref MyRestApi
    ResourceId: !Ref MyResource
    HttpMethod: GET
    Type: HTTP_PROXY
    IntegrationHttpMethod: POST
    Uri: http://my-internal-nlb-1234567890.elb.us-east-1.amazonaws.com/products
    VpcLinkId: !Ref MyVpcLink
```

The `VpcLinkId` property is what ties this integration to your VPC Link. Without it, API Gateway tries to route traffic to the URI over the internet, which won't work for a private NLB.

### Security: Security Groups and Network ACLs

Connectivity is only half the battle—security is equally important. Traffic flowing through a VPC Link still passes through your VPC's security boundaries, so you need to ensure the right traffic is allowed.

**Security Group Configuration**: API Gateway doesn't have a traditional security group because it's a managed service. However, when it uses a VPC Link, it connects to your NLB, which does have a security group. Your NLB's security group needs an inbound rule that allows traffic on the port where your NLB listener is configured. Since API Gateway is within the AWS network and doesn't have a fixed IP range you can reference, you should use a security group source.

Here's a practical approach: create a security group for API Gateway access (or conceptually tag it that way), then add an inbound rule to your NLB's security group that allows traffic from API Gateway's security group. In practice, this often means allowing traffic from a CIDR block or from the security group of any other internal service that needs to call the NLB.

For example, using the CLI:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-12345678 \
  --protocol tcp \
  --port 443 \
  --source-group sg-87654321 \
  --region us-east-1
```

This rule allows traffic on port 443 from security group sg-87654321 to security group sg-12345678 (your NLB's security group).

**Backend Instance Security Group**: Your EC2 instances also need a security group that allows inbound traffic from the NLB. If your NLB listener is on port 443 but your EC2 instances are listening on port 8080 (as in our earlier example), then the instances' security group should allow inbound TCP traffic on port 8080 from the NLB's security group.

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-backend-instances \
  --protocol tcp \
  --port 8080 \
  --source-group sg-nlb \
  --region us-east-1
```

**Network ACLs**: Network Access Control Lists provide an additional layer of filtering at the subnet level. If you're using custom NACLs (most VPCs use the default NACL which allows all traffic), ensure that both ingress and egress rules permit traffic on your NLB listener port and backend port. A common mistake is forgetting egress rules—traffic needs to flow in both directions.

For the subnets containing your NLB, ensure inbound rules allow traffic on your listener port from the CIDR blocks that might be sending requests. For subnets containing your EC2 instances, allow inbound traffic on your application port from the NLB subnets' CIDR blocks.

### Monitoring VPC Link Health

A VPC Link can appear "available" in the API Gateway console, but if your backend targets aren't healthy, requests will still fail. Monitoring health is crucial.

**Target Health Checks**: Your NLB has health check settings that determine whether target instances are considered healthy. These are independent of VPC Link health. Navigate to your NLB's target group in the EC2 console and check the health status of registered targets. You'll see each instance marked as "Healthy" or "Unhealthy". If an instance is unhealthy, the NLB won't send traffic to it.

To verify health check configuration, look at the protocol, port, path, and interval settings. For instance, if your backend is an HTTP API listening on port 8080 at the `/health` path, your health check should be configured accordingly:

```bash
aws elbv2 modify-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-backend-targets/1234567890123456 \
  --health-check-protocol HTTP \
  --health-check-port 8080 \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --region us-east-1
```

**VPC Link Connection Health**: The VPC Link itself doesn't have a separate "health status" in the traditional sense, but you can check its operational status. If the status shows anything other than "available", there's a connectivity issue between API Gateway and your NLB. Common reasons include misconfigured security groups, incorrect VPC/subnet configuration, or the NLB being in a different VPC.

**CloudWatch Metrics**: Both your NLB and API Gateway publish metrics to CloudWatch. For the NLB, relevant metrics include `TargetResponseTime`, `ProcessedBytes`, `ActiveConnectionCount`, and `UnHealthyHostCount`. For API Gateway, you'll find metrics like `Count` (number of API calls) and `4XXError`, `5XXError` (error counts).

Set up a CloudWatch alarm on the `UnHealthyHostCount` metric for your NLB target group. If this metric exceeds zero for more than a minute or two, you know something's wrong with your backend instances.

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name nlb-unhealthy-targets \
  --alarm-description "Alert when NLB has unhealthy targets" \
  --metric-name UnHealthyHostCount \
  --namespace AWS/NetworkELB \
  --statistic Average \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --region us-east-1
```

### Troubleshooting Connectivity Issues

Despite your best efforts, things go wrong. Here's how to systematically troubleshoot.

**VPC Link Status is "Failed"**: If your VPC Link never transitions to "available" status or shows a "failed" status, AWS couldn't establish the connection to your NLB. First, verify the NLB ARN is correct. Then, confirm the NLB exists and is in the same region. Check that the NLB has a listener configured on the expected port—if the listener is missing, the VPC Link can't establish a connection.

**Requests Return 502 Bad Gateway**: This typically means API Gateway successfully routed to your VPC Link, but something went wrong when connecting to the backend. First, verify that your NLB targets are healthy. Check the NLB's target group in the AWS console and look at the target health status. If targets are unhealthy, diagnose the health check failure by testing the health check endpoint manually from an instance in the same VPC.

**Requests Return 504 Gateway Timeout**: This indicates the NLB accepted the connection but the backend instances didn't respond in time. Check your backend application logs to see if it's receiving requests. If it is but responding slowly, consider increasing the timeout threshold in your API Gateway method settings.

**No Traffic is Reaching Your Backend Instances**: Use security group verification. Create a test EC2 instance in the same VPC and attempt to connect to your NLB's private IP on the listener port:

```bash
curl -v http://10.0.1.50:443/
```

If this fails, you have a security group or network ACL issue. Verify that your NLB's security group allows inbound traffic on the listener port, and that your instance's security group allows outbound traffic to that port.

**VPC Link is Available but Requests Still Fail**: Check API Gateway logs. Enable CloudWatch logging for your API stage. In the stage settings, set the CloudWatch log role and log level to "ERROR" or "INFO". Then make a test request and examine the logs. You'll often find detailed error messages about why the integration failed.

### Cost Implications and Considerations

VPC Links aren't free, and understanding the pricing model is important for budgeting and architecture decisions.

**Network Load Balancer Charges**: When you use a VPC Link, you're deploying a Network Load Balancer in your VPC. NLBs are charged based on three dimensions: capacity units, processed bytes, and new connections. As of current AWS pricing, you'll pay roughly $16 per month for the NLB itself (capacity units), plus variable charges based on traffic. For a typical internal API workload, this might come to $20-50 per month depending on request volume and size.

**VPC Link Charges**: Interestingly, AWS doesn't charge directly for the VPC Link itself—the VPC Link is a logical configuration. You pay for the resources it uses (the NLB) but not for the "VPC Link feature."

**Data Transfer**: Data transferred through the VPC Link to your NLB doesn't incur data transfer charges because it stays within your VPC. However, if you're routing traffic from the internet through API Gateway to your NLB, you pay standard API Gateway request charges.

**API Gateway Charges**: API Gateway itself charges per million requests, regardless of whether you're using a VPC Link or not. VPC Link integration doesn't change this.

For many organizations, the main cost consideration is the NLB. If you're evaluating whether to use a VPC Link, weigh the cost of the NLB against the security and architectural benefits. For internal APIs or APIs with moderate traffic, this is often a worthwhile trade-off. If you already have an NLB for other purposes, the incremental cost of using it for a VPC Link is minimal—you're not running additional infrastructure.

One cost optimization: ensure you're not over-provisioning. NLBs are pay-per-capacity-unit, so monitor your NLB's utilization and adjust its capacity if you're significantly under-utilizing it.

### Real-World Scenario: Multi-Tier Application

Let's tie this all together with a concrete example. Imagine you're building a SaaS application with three tiers: API Gateway (public), application servers (private), and databases (private).

Your architecture looks like this:

**Tier 1 (Public)**: API Gateway endpoint exposed to the internet.

**Tier 2 (Private)**: Three EC2 instances in a private subnet running your application. These instances have no internet access (they use a NAT gateway if they need outbound internet). They're registered with an internal Network Load Balancer.

**Tier 3 (Private)**: RDS database in a private subnet, only accessible from the application tier.

Clients call your API Gateway endpoint. API Gateway routes requests through a VPC Link to your internal NLB. The NLB distributes traffic to your EC2 instances. Your instances process the request, query the RDS database, and return a response. The response travels back through the NLB and VPC Link to API Gateway, which returns it to the client.

Throughout this flow, your application code never touches the internet. Your database is never exposed. Your EC2 instances are never exposed. API Gateway is the only AWS service directly accessible from the internet, and it's a managed service that AWS handles. This is security through architecture, not just through firewalls and rules.

To set this up, you'd:

1. Create a VPC with public and private subnets across two availability zones.
2. Deploy three EC2 instances in the private subnets running your application.
3. Create an internal Network Load Balancer spanning the private subnets.
4. Register the three EC2 instances with the NLB's target group.
5. Create a VPC Link targeting the NLB.
6. Create an API Gateway REST API with a method that uses the VPC Link integration.
7. Configure security groups to allow traffic from the NLB to the EC2 instances.
8. Test the end-to-end flow.

### Advanced Patterns and Considerations

**Multiple VPC Links**: If you have multiple backend services in different VPCs (for instance, a microservices architecture), you'd create a separate VPC Link for each VPC. Each VPC Link would have its own NLB. API Gateway routes different API paths to different VPC Links based on your integration configuration.

**Cross-Region Replication**: VPC Links are region-specific. If you need API Gateway to route to backends in multiple regions, you'd create VPC Links in each region. API Gateway can be configured with regional endpoints, each using a VPC Link in its respective region.

**VPC Link with Private APIs**: While our focus has been on REST APIs, API Gateway also supports HTTP APIs and WebSocket APIs. VPC Links work with HTTP APIs as well. Private REST APIs (accessible only from within a VPC or via private endpoints) can also use VPC Links, allowing you to build entirely private communication chains.

**Hybrid Architecture Considerations**: If you're using VPC Link to connect API Gateway to on-premises systems via AWS Direct Connect or a VPN connection, the principles are the same—your NLB acts as the bridge. The on-premises system would be represented as a target in the NLB's target group, or the NLB would route to an instance that proxies the on-premises connection.

### Conclusion

VPC Links solve a fundamental problem in AWS architecture: how to connect a public-facing API Gateway to private backend resources without exposing those resources to the internet. By leveraging a Network Load Balancer as the target, VPC Links provide a secure, scalable, and reliable way to build multi-tier applications where each component is properly isolated and accessible only through intended channels.

The process of setting up a VPC Link—from creating the NLB through configuring the API Gateway integration to securing it with appropriate security groups—requires attention to detail, but the effort is straightforward once you understand the architecture. The cost is predictable (primarily the NLB), and the operational overhead is minimal since both NLB and VPC Link are managed services.

As you build more complex applications on AWS, you'll find VPC Links becoming a standard tool in your architectural toolkit. They embody the principle of security through design—rather than trying to hide a public resource, you keep resources private and explicitly choose what's exposed. Master VPC Links, and you'll have a powerful technique for building secure, scalable, multi-tier applications.
