---
title: "ALB Target Types Compared: Instance, IP, Lambda, and ALB-as-Target"
---

## ALB Target Types Compared: Instance, IP, Lambda, and ALB-as-Target

When you're building a scalable application on AWS, the Application Load Balancer (ALB) is often your first choice for distributing traffic. But here's something that catches many developers off guard: ALBs don't just route traffic to EC2 instances. They can send requests to a much wider variety of targets—and choosing the right target type can fundamentally shape how your architecture works.

This distinction matters because it affects how you manage your backend services, how they scale, and how they integrate with other AWS services. A Lambda-backed ALB operates in a completely different way than one fronting a fleet of EC2 instances. An ALB that targets IP addresses opens up possibilities like containerized workloads and on-premises servers. And then there's the somewhat exotic case of using an ALB as a target for a Network Load Balancer, which solves a very specific problem.

Let's dig into each target type, understand when and why you'd use it, and work through some practical scenarios.

### Understanding ALB Target Groups and Target Types

Before we compare the four target types, let's establish the foundation. An Application Load Balancer distributes incoming traffic across one or more target groups based on rules you define. Each target group is a logical set of backends that share configuration like health check settings, protocol, and port.

The target type is a property of the target group itself—you choose it when you create the group, and it determines what kinds of resources you can register as targets. This choice isn't arbitrary; it shapes the fundamental relationship between the ALB and your backend services.

Think of target types as answering the question: "How do I tell the ALB where to send this traffic?" Instance IDs say "use this specific EC2 instance." IP addresses say "use this routable IP address." Lambda says "invoke this function." And ALB-as-target says "send this to another load balancer."

### Instance Targets: The Traditional Approach

Instance targets are the most straightforward and, in many ways, the most common. You register EC2 instances by their instance ID, and the ALB routes traffic directly to those instances using their primary private IP address.

This approach shines when you have a fleet of EC2 instances, especially when that fleet is managed by an Auto Scaling Group. When you create an Auto Scaling Group with an ALB target group, instances are automatically registered when they launch and deregistered when they terminate. You get a tight integration between compute scaling and traffic distribution—the load balancer knows about new instances almost immediately.

Here's how you might configure this in Terraform:

```hcl
resource "aws_lb_target_group" "app" {
  name        = "my-app-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 3
    interval            = 30
    path                = "/"
    matcher             = "200"
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "my-app-asg"
  vpc_zone_identifier = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  target_group_arns   = [aws_lb_target_group.app.arn]
  min_size            = 2
  max_size            = 10
  desired_capacity    = 4

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }
}
```

The beauty of this setup is the simplicity. Your application runs on EC2 as it normally would—listening on a port, handling HTTP requests. The ALB sends traffic to the instance's primary private IP. There's no special invocation mechanism, no JSON envelope wrapping your request, just straightforward HTTP.

Instance targets work well when your backend is stateless or when you're comfortable with sticky sessions (session affinity). One thing to keep in mind: health checks need to be configured to match what your application actually does. If your app needs a warm-up period or has specific endpoints, configure those in the health check settings rather than relying on defaults.

### IP Targets: Flexibility Beyond EC2

IP targets represent a leap in flexibility. Instead of registering instances by ID, you register specific IP addresses—any routable IP in your VPC or in peered networks. This seemingly simple change opens up several powerful use cases.

The most common scenario is ECS with the `awsvpc` network mode. When you run tasks in ECS with `awsvpc` mode, each task gets its own elastic network interface and IP address. The ALB can target these tasks directly by their IP addresses, giving you fine-grained control over which specific tasks receive traffic. This is particularly useful for canary deployments or A/B testing, where you might want to send traffic to specific task revisions.

Here's how you'd configure an ECS service with an ALB:

```hcl
resource "aws_lb_target_group" "ecs_app" {
  name        = "ecs-app-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 3
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
}

resource "aws_ecs_service" "app" {
  name            = "my-app-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 3
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.ecs_app.arn
    container_name   = "app"
    container_port   = 8080
  }
}
```

But containers and ECS aren't the only use case for IP targets. If you have on-premises servers connected to your VPC via AWS Direct Connect or VPN, you can register their IP addresses as targets. This allows you to treat your hybrid infrastructure as a unified system—the ALB can route to both cloud and on-premises backends transparently.

Similarly, if you're using AWS PrivateLink to expose a service from another VPC or account, you can register the IP addresses of the service endpoints in your consumer VPC as targets. This creates a clean separation of concerns and makes your architecture more modular.

There's one important gotcha with IP targets: you're responsible for registering and deregistering them. When you use instance targets with an Auto Scaling Group, registration is automatic. With IP targets, you need to manage the lifecycle yourself or use tooling (like the ECS integration above) that handles it for you. If you're manually registering IPs, this is workable but requires discipline.

### Lambda Targets: Serverless Backends

Lambda targets represent a different architectural paradigm altogether. Instead of maintaining persistent backend servers, the ALB invokes a Lambda function synchronously for each request. The ALB wraps the HTTP request in a specific JSON envelope, sends it to the function, and expects a response in a particular format.

This opens up genuinely serverless architectures where you don't manage any servers at all—not in the traditional sense. Each request becomes a function invocation. This can be cost-effective for bursty, unpredictable workloads, and it eliminates the operational overhead of maintaining running instances.

Here's what the JSON envelope looks like when the ALB invokes a Lambda function:

```json
{
  "requestContext": {
    "elb": {
      "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-tg/50dc6c495c0c9188"
    }
  },
  "httpMethod": "GET",
  "path": "/api/users",
  "queryStringParameters": {
    "limit": "10"
  },
  "headers": {
    "accept": "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    "host": "example.com",
    "user-agent": "Mozilla/5.0",
    "x-amzn-trace-id": "Root=1-5bdb6b37-556d8b0c50dc66f511bf8131",
    "x-forwarded-for": "72.21.198.67",
    "x-forwarded-port": "443",
    "x-forwarded-proto": "https"
  },
  "body": null,
  "isBase64Encoded": false
}
```

And your function must return a response in this format:

```json
{
  "statusCode": 200,
  "statusDescription": "200 OK",
  "isBase64Encoded": false,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"users\": [{\"id\": 1, \"name\": \"Alice\"}, {\"id\": 2, \"name\": \"Bob\"}]}"
}
```

Notice that the body must be a string, not an object. If you're returning binary data or non-UTF8 content, you set `isBase64Encoded` to true and base64-encode the body.

Here's a practical Lambda function that handles requests from an ALB:

```python
import json
import base64

def lambda_handler(event, context):
    # Extract request details
    http_method = event['httpMethod']
    path = event['path']
    headers = event['headers']
    query_params = event.get('queryStringParameters', {})
    body = event.get('body', '')
    
    # Decode body if it's base64 encoded
    if event.get('isBase64Encoded'):
        body = base64.b64decode(body).decode('utf-8')
    
    # Your business logic here
    if path == '/api/users':
        users = [
            {'id': 1, 'name': 'Alice'},
            {'id': 2, 'name': 'Bob'}
        ]
        response_body = json.dumps(users)
        status_code = 200
    elif path == '/health':
        response_body = json.dumps({'status': 'healthy'})
        status_code = 200
    else:
        response_body = json.dumps({'error': 'Not found'})
        status_code = 404
    
    # Return response in ALB-expected format
    return {
        'statusCode': status_code,
        'statusDescription': f'{status_code} OK' if status_code == 200 else f'{status_code} Error',
        'isBase64Encoded': False,
        'headers': {
            'Content-Type': 'application/json'
        },
        'body': response_body
    }
```

Setting up the target group and registering the Lambda is straightforward:

```hcl
resource "aws_lb_target_group" "lambda_app" {
  name        = "lambda-app-tg"
  target_type = "lambda"
}

resource "aws_lb_target_group_attachment" "lambda_app" {
  target_group_arn = aws_lb_target_group.lambda_app.arn
  target_id        = aws_lambda_function.app.arn
}

resource "aws_lambda_permission" "alb_invoke" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.lambda_app.arn
}
```

Lambda targets have some important characteristics to understand. First, the ALB synchronously invokes your function and waits for a response—there's no async invocation here. This means your function's execution time becomes your request latency. Second, you're subject to Lambda's 15-minute execution timeout, which is rarely a problem for web requests but something to be aware of. Third, Lambda functions scale instantly but can hit concurrent invocation limits; you might need to request a limit increase if you have high traffic.

Cold starts are another consideration. When a Lambda hasn't been invoked recently, AWS has to initialize the runtime, load your code, and start execution—all of which adds latency. For latency-sensitive applications, Lambda targets might not be ideal. But for many use cases—APIs with variable traffic, scheduled tasks exposed through HTTP, or microservices handling bursty loads—Lambda targets work beautifully.

One more thing: Lambda doesn't natively understand the ALB request format. If you're using a Lambda function with a web framework like FastAPI or Express, you'll need a wrapper. The Python `awsgi` library or Node's `@vendia/serverless-express` can help bridge this gap, translating between the ALB event format and standard HTTP, then translating the framework's response back.

### ALB-as-Target: Network Load Balancer to the Rescue

Now we get to the exotic one: using an ALB as a target for a Network Load Balancer. This might seem backward—why would you need a load balancer in front of a load balancer? The answer lies in a specific architectural constraint.

NLBs can expose a static IP address, which is useful when clients need to whitelist IPs or when you're integrating with legacy systems that expect a stable IP. But if you want the advanced routing capabilities of an ALB—host-based routing, path-based routing, hostname-based routing—you can't use the NLB alone. Here's where chaining comes in.

You place an NLB in front of an ALB. The NLB provides the stable IP that clients connect to, and it forwards traffic to the ALB's IP addresses (or instance IDs, depending on configuration). The ALB then applies its sophisticated routing rules before sending traffic to the actual backend services.

This architecture looks something like this:

```
Client (whitelist NLB static IP)
    ↓
Network Load Balancer (TCP/TLS on port 80/443)
    ↓
ALB Target Group (with ALB as target)
    ↓
Application Load Balancer (HTTP/HTTPS routing)
    ↓
Backend Services (Instances, IP targets, Lambda, etc.)
```

Setting this up requires configuring the NLB's target group with target type `alb`:

```hcl
resource "aws_lb" "nlb" {
  name               = "my-nlb"
  internal           = false
  load_balancer_type = "network"
  
  subnets = [
    aws_subnet.public_a.id,
    aws_subnet.public_b.id
  ]
}

resource "aws_lb_target_group" "alb_target" {
  name        = "alb-as-target-tg"
  port        = 80
  protocol    = "TCP"
  vpc_id      = aws_vpc.main.id
  target_type = "alb"

  health_check {
    protocol = "HTTP"
    path     = "/"
    matcher  = "200"
  }
}

resource "aws_lb_target_group_attachment" "alb" {
  target_group_arn = aws_lb_target_group.alb_target.arn
  target_id        = aws_lb.alb.arn
}

resource "aws_lb_listener" "nlb" {
  load_balancer_arn = aws_lb.nlb.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.alb_target.arn
  }
}
```

This is a somewhat advanced pattern, and you'll only need it in specific circumstances: when you require the NLB's static IP address and the ALB's Layer 7 routing capabilities simultaneously. It's more common in scenarios where you're migrating systems gradually or integrating with external systems that demand IP whitelisting.

### Comparing the Four Target Types

Let's synthesize what we've covered with a practical comparison matrix:

**Instance targets** excel when you're running traditional web applications on EC2, especially with Auto Scaling Groups. They offer simplicity, tight integration with AWS infrastructure, and predictable behavior. Choose this when you have long-lived instances and want the operational simplicity of managed scaling.

**IP targets** give you the flexibility to support containerized workloads (ECS with Fargate), on-premises servers via Direct Connect, or peered VPC resources. They're essential for modern cloud architectures using containers and microservices. The trade-off is that you lose automatic registration; you need to manage lifecycle manually or use orchestration tools.

**Lambda targets** enable fully serverless architectures with no running infrastructure. They're ideal for bursty workloads, APIs with unpredictable traffic patterns, or when you want to minimize operational overhead. The downside is execution time becomes request latency, and you're subject to Lambda's concurrency limits.

**ALB-as-target** solves a very specific problem: you need a static IP (NLB) but also Layer 7 routing (ALB). This is relatively rare and adds complexity. Only use this when you have a genuine need for both capabilities.

### Practical Considerations and Best Practices

When choosing a target type, start with the type that matches your infrastructure. If you have EC2 instances in an ASG, use instance targets. If you're running containers on ECS with Fargate, use IP targets. If you're building a serverless API, use Lambda targets. The choice often dictates itself based on your platform.

Health checks need careful consideration. For instance and IP targets, you want a lightweight endpoint that reflects true application health without expensive operations. For Lambda targets, remember that each health check invocation costs money and counts toward your invocations. Configure check intervals thoughtfully.

Cross-zone load balancing affects how traffic is distributed across targets. With instance targets, this is straightforward. With IP targets and Lambda, cross-zone is the default behavior—traffic is distributed evenly across availability zones regardless of where targets are located.

Sticky sessions (connection draining for new clients or session affinity for existing clients) work differently across target types. Instance and IP targets support traditional stickiness. Lambda targets can't maintain state—each invocation is independent. If you need session state, design for it explicitly using DynamoDB or ElastiCache.

For monitoring and troubleshooting, CloudWatch metrics differ slightly by target type. Instance targets show unhealthy instance counts; Lambda targets show invocation errors and duration. Check the right metrics based on your target type.

### Real-World Architecture Examples

Let's tie this together with some concrete scenarios.

**Scenario 1: Microservices Architecture**

You're building a microservices platform where different services handle different parts of your application. Some services are containerized (ECS), some are Lambda-based functions, and some are legacy monoliths still running on EC2.

You'd use an ALB with multiple target groups: one with IP targets for your ECS services, one with Lambda targets for lightweight APIs, and one with instance targets for your legacy applications. The ALB's routing rules direct traffic based on path or hostname to the appropriate target group and backend.

**Scenario 2: Hybrid On-Premises and Cloud**

Your organization is gradually migrating workloads to AWS. Some applications still run on-premises but need to route through your cloud infrastructure. You'd use an ALB with IP targets, registering both cloud-based IPs and on-premises server IPs (connected via Direct Connect). This presents a unified interface to clients while you transition workloads.

**Scenario 3: Serverless API with Auto-Scaling Burst Handling**

Your application serves mostly predictable traffic from EC2 instances in an ASG, but occasionally experiences massive spikes. You want to handle the predictable load efficiently while gracefully handling bursts without overprovisioning.

You'd use an ALB with instance targets for normal traffic, and add a second target group with Lambda targets. Your ALB routing rules send normal requests to instances, and configure the Lambda target group as a fallback when instance targets are at capacity. This gives you cost efficiency with graceful degradation.

### Conclusion

The ALB's four target types each serve different architectural needs and constraints. Instance targets provide simplicity and integration with Auto Scaling Groups. IP targets offer flexibility for containerized workloads, on-premises integration, and peered resources. Lambda targets enable truly serverless architectures. And ALB-as-target solves the specific problem of needing both static IPs and Layer 7 routing.

Choosing the right target type isn't about finding the "best" option—it's about matching your infrastructure, workload characteristics, and operational constraints. Start by understanding what you're actually deploying, then let that drive your choice. As your architecture evolves, you might use multiple target types simultaneously, each serving a specific part of your system. That flexibility is one of the ALB's greatest strengths.
