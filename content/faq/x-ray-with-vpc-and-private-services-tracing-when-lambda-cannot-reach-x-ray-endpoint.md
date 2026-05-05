---
title: "X-Ray with VPC and Private Services: Tracing When Lambda Cannot Reach X-Ray Endpoint"
---

## X-Ray with VPC and Private Services: Tracing When Lambda Cannot Reach X-Ray Endpoint

When you run AWS Lambda functions inside a VPC, you gain powerful network isolation and security benefits. But that same isolation creates a deceptively thorny problem: how do you send distributed tracing data to AWS X-Ray when your function has no path to the internet? It's a scenario that catches many developers mid-deployment, and solving it requires understanding both the constraint and the available pathways forward.

This article explores the architectural problem, walks you through the most practical solutions, and gives you the troubleshooting patterns you'll need when things don't work as expected.

### Understanding the Core Problem

Imagine you've instrumented your Lambda function with the AWS X-Ray SDK. Your function logs in nicely, processes requests, and everything works beautifully in the default Lambda environment. Then you attach it to a VPC because your business logic needs to access private RDS databases or internal microservices. Suddenly, X-Ray tracing breaks silently.

The root cause is straightforward: Lambda functions running inside a VPC with no internet gateway, NAT gateway, or equivalent egress path cannot reach the X-Ray service endpoint. The X-Ray SDK in your function tries to send trace data to a regional X-Ray endpoint (something like `xray.us-east-1.amazonaws.com`), but the network traffic never leaves your VPC. The SDK typically buffers these failed requests and continues, so your application keeps running—but your traces vanish.

This is different from a typical application permissions problem. Your Lambda execution role might have all the correct X-Ray permissions in its IAM policy. The problem is purely networking: there's no route from your Lambda's network interface to AWS's public X-Ray service endpoints.

### Solution 1: Using X-Ray VPC Endpoints

The cleanest solution is to create a VPC endpoint for X-Ray. AWS provides VPC endpoints for many services, and X-Ray is among them. A VPC endpoint lets you access AWS services from within your VPC without traversing the public internet—traffic stays within AWS's network backbone.

#### How VPC Endpoints Work for X-Ray

When you create a VPC endpoint for X-Ray, AWS provisions an elastic network interface (ENI) within your VPC and handles all the routing magic behind the scenes. Your Lambda function still calls the X-Ray API, but instead of trying to reach a public IP address, it resolves to a private IP within your VPC. AWS then tunnels that traffic to the X-Ray service through AWS's internal network.

From your application's perspective, nothing changes. The X-Ray SDK still targets the same regional endpoint hostname. But the network path is now internal.

#### Creating an X-Ray VPC Endpoint

You can create a VPC endpoint through the AWS Console, the CLI, or Infrastructure as Code. Here's what you need to know:

First, you'll identify the VPC and subnets where your Lambda runs. Typically, you'll want the VPC endpoint in the same subnets as your Lambda, or at minimum in subnets that can route to those subnets.

Using the AWS CLI, you'd create the endpoint like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345678 \
  --service-name com.amazonaws.us-east-1.xray \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-12345678 subnet-87654321 \
  --security-group-ids sg-12345678
```

Notice the service name follows the pattern `com.amazonaws.REGION.xray`. Replace `us-east-1` with your actual region.

The key parameters here are:

The `vpc-endpoint-type Interface` tells AWS you want an interface endpoint (as opposed to a gateway endpoint, which only applies to S3 and DynamoDB). Interface endpoints use ENIs and support more services.

The `subnet-ids` should include at least one subnet from your VPC. If your Lambda runs in multiple availability zones, add subnets from each for high availability.

The `security-group-ids` parameter references a security group that controls inbound traffic to the endpoint. This security group needs an inbound rule allowing traffic on port 443 (HTTPS) from your Lambda's security group or its CIDR block.

#### Configuring Security Groups for X-Ray Endpoint Access

Security groups are critical and often overlooked. When you create the VPC endpoint, you assign a security group to its ENI. That security group must allow inbound traffic on port 443 from whatever security group your Lambda uses.

If your Lambda has security group `sg-lambda`, and your endpoint has security group `sg-xray-endpoint`, the endpoint's security group should have a rule like:

```
Inbound: TCP 443 from sg-lambda
```

If you're working with CIDR blocks instead of security group references (which is less flexible but sometimes necessary), allow the private IP range of your Lambda's subnet or the entire VPC CIDR.

#### DNS Configuration Subtlety

Here's something that trips up developers: VPC endpoints work through DNS resolution. When your Lambda calls `xray.us-east-1.amazonaws.com`, that hostname must resolve to the private IP of your endpoint ENI, not the public IP.

By default, when you create an interface VPC endpoint, AWS enables "Private DNS" resolution if you're using the default VPC DNS resolver. This means the regional X-Ray hostname automatically resolves to your endpoint's private IP. You typically don't need to do anything—it just works.

However, if you're using a custom DNS resolver or if Private DNS is disabled on your endpoint, you'll need to manually add DNS records or configure your resolver to point the X-Ray endpoint hostnames to the VPC endpoint's private IPs. This is rare but worth knowing if you're troubleshooting.

### Solution 2: X-Ray Daemon Running in Your VPC

Another approach is to run the X-Ray daemon as a service within your VPC. Instead of sending traces directly to the AWS X-Ray service, your Lambda functions send traces to a local daemon running on an EC2 instance or container within your VPC. The daemon batches and forwards these traces to the X-Ray service.

This approach was more common before VPC endpoints became widely available, but it still has merit in certain architectures.

#### When to Choose the Daemon Approach

The daemon approach shines when you have many Lambda functions in the same VPC and want centralized trace collection with local buffering. You can run the daemon on a dedicated EC2 instance or even as a sidecar container in Amazon ECS if your Lambda-like workload is actually containerized.

The daemon can also filter, sample, or preprocess traces before they reach AWS X-Ray, giving you more control over trace volume and sampling strategy.

#### Running the X-Ray Daemon

AWS provides an X-Ray daemon Docker image. If you're running containers in your VPC (through ECS, for instance), you can run the daemon in a privileged container alongside your application containers.

For EC2 instances, you'd install the daemon directly:

```bash
sudo yum install aws-xray-daemon
sudo systemctl start xray
```

The daemon listens on UDP port 2000 by default (for the older UDP protocol) and TCP port 2000 (for the newer TCP protocol). Your Lambda functions need network access to reach this daemon.

#### Configuring Lambda to Use a Local Daemon

With the X-Ray SDK for your language, you configure the daemon address instead of going directly to AWS:

In Node.js:

```javascript
const AWSXRay = require('aws-xray-sdk-core');

const http = require('http');
const client = AWSXRay.captureHTTPClient(http);

AWSXRay.config([
  {
    daemon: {
      address: '10.0.1.50:2000'  // Private IP of daemon host
    }
  }
]);
```

In Python:

```python
from aws_xray_sdk.core import xray_recorder

xray_recorder.configure(
    emitter=xray_recorder.emitter,
    context_missing='LOG_ERROR',
    daemon_addr='10.0.1.50:2000'
)
```

The private IP address should point to the EC2 instance or container running your daemon.

#### Trade-offs of the Daemon Approach

The daemon approach adds operational overhead. You're responsible for running and maintaining another service in your VPC. You need to monitor its health, handle restarts, and ensure it doesn't become a bottleneck.

However, it does offer advantages: centralized trace batching reduces the number of API calls to X-Ray, local buffering provides resilience if the X-Ray service is temporarily unavailable, and you get finer-grained control over sampling and filtering policies.

For most modern architectures, though, VPC endpoints are simpler and require less ongoing management.

### Solution 3: Buffering and Asynchronous Tracing

A third approach—less common but useful in specific scenarios—is to buffer trace data locally and send it asynchronously through a path that does have internet connectivity.

For example, you might write trace data to an SQS queue or DynamoDB table from within your VPC-attached Lambda. A separate Lambda function (or service) without VPC attachment then reads from that queue and sends traces to X-Ray. This decouples the timing and allows you to batch and compress traces before they leave the VPC.

This approach is most useful if you're already using SQS or DynamoDB in your architecture and you want to minimize additional infrastructure. It's also helpful if you need to transform or filter traces before they reach X-Ray.

The downside is complexity: you're building a custom pipeline instead of using AWS's native integration. You also introduce latency—traces won't appear in the console immediately.

### Troubleshooting X-Ray Connectivity Issues

When X-Ray tracing isn't working in your VPC environment, follow this methodical approach:

#### Verify IAM Permissions

Start with IAM. Your Lambda execution role needs permissions for X-Ray. The minimum policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords"
      ],
      "Resource": "*"
    }
  ]
}
```

If these permissions are missing, your SDK won't be able to send traces even if network connectivity is perfect. Check CloudWatch Logs for any access denied errors from the X-Ray SDK.

#### Check Network Connectivity

If IAM is fine, the problem is networking. First, verify that your Lambda's security group allows outbound traffic. Lambda functions need a security group that permits outbound HTTPS traffic (port 443) to reach the X-Ray endpoint or daemon.

A simple check: does your Lambda's security group have an outbound rule allowing TCP 443? Many people create overly restrictive security groups that block all outbound traffic. At minimum, you need:

```
Outbound: TCP 443 to 0.0.0.0/0 (or more restrictively, to the X-Ray endpoint security group)
```

#### Test DNS Resolution

If you're using a VPC endpoint, verify that the X-Ray endpoint hostname resolves to a private IP, not a public one.

You can test this from a Lambda function (or an EC2 instance in the same VPC) with a simple DNS lookup:

```python
import socket

try:
    result = socket.gethostbyname('xray.us-east-1.amazonaws.com')
    print(f"Resolves to: {result}")
    if result.startswith('10.') or result.startswith('172.') or result.startswith('192.168.'):
        print("Private IP - VPC endpoint is working")
    else:
        print("Public IP - DNS not configured for VPC endpoint")
except socket.gaierror as e:
    print(f"DNS resolution failed: {e}")
```

If you get a public IP or a DNS error, your VPC endpoint isn't properly configured or Private DNS isn't enabled.

#### Examine CloudWatch Logs

The X-Ray SDK logs its behavior to CloudWatch. Check your Lambda's CloudWatch Logs for messages about trace delivery. The SDK might report connection timeouts, DNS resolution failures, or other network issues that point you toward the root cause.

Many SDKs also support debug logging. Enable it to see exactly what the SDK is trying to do:

In Node.js, set an environment variable:

```bash
AWS_XRAY_SDK_ENABLED=true
```

This produces more verbose logging that can help pinpoint whether the issue is DNS, routing, or something else.

#### Validate VPC Endpoint Configuration

If you're using a VPC endpoint, double-check these details:

The endpoint should be in a state of "available", not "pending" or "failed". Check the VPC Endpoints console to confirm.

The endpoint should be associated with subnets where your Lambda runs. If your Lambda is in subnet A but the endpoint is only in subnet B, traffic won't reach it (unless there's routing between them).

The endpoint's security group should allow inbound traffic on port 443 from your Lambda's security group. Test this rule explicitly—sometimes security group configurations aren't quite right.

### Regional Considerations and Endpoint Availability

X-Ray VPC endpoints are available in all AWS regions where X-Ray itself is available. However, endpoint availability isn't uniform across regions or partition types. If you're working in a less common region (like some GovCloud regions), check the AWS documentation to confirm X-Ray endpoints are supported.

Also, remember that VPC endpoint service names are region-specific. The service name in `us-east-1` is `com.amazonaws.us-east-1.xray`, while in `eu-west-1` it's `com.amazonaws.eu-west-1.xray`. This is easy to get wrong when working across multiple regions.

### Choosing Your Approach

For most developers building VPC-attached Lambda functions that need X-Ray tracing, a VPC endpoint is the right choice. It requires minimal configuration, no additional infrastructure to manage, and integrates seamlessly with your existing application code.

Use the daemon approach if you're already running services in your VPC and want centralized trace collection or if you need fine-grained control over sampling and batching.

The asynchronous buffering approach is most useful in complex architectures where you're already using message queues or event-driven patterns and want to avoid adding another VPC endpoint.

### Conclusion

VPC-attached Lambda functions and X-Ray tracing work together beautifully, but only when you account for the networking layer. The core issue—that a VPC without internet access can't reach public AWS service endpoints—is solved elegantly by VPC endpoints, which let your functions send traces through AWS's private network.

Understanding this problem and its solutions prepares you for real-world scenarios where security and observability must coexist. Whether you choose VPC endpoints, a local daemon, or an asynchronous pipeline, the key is recognizing early that network isolation requires a deliberate tracing strategy.

Test your configuration thoroughly in a development environment, pay attention to security group rules and DNS resolution, and monitor your Lambda logs for any SDK errors. With these patterns in place, your distributed traces will flow reliably from your most isolated workloads to your X-Ray console.
