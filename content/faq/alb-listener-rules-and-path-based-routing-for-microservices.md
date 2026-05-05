---
title: "ALB Listener Rules and Path-Based Routing for Microservices"
---

## ALB Listener Rules and Path-Based Routing for Microservices

When you're building a modern application architecture with microservices, one of your first infrastructure challenges is figuring out how to direct incoming traffic to the right service. You could spin up a separate load balancer for each microservice, but that quickly becomes expensive and operationally messy. Instead, you can use a single Application Load Balancer (ALB) with carefully configured listener rules to intelligently route traffic based on the request characteristics — whether that's the URL path, hostname, HTTP headers, or query parameters.

This approach is powerful because it lets you present a single DNS endpoint to your clients while maintaining clean separation between your backend services. It's also a core pattern you'll encounter in production AWS environments and is essential knowledge for anyone working with modern application infrastructure on AWS.

In this guide, we'll explore how to set up listener rules on an ALB, understand the different condition types and action types available to you, and work through practical scenarios that you'll likely encounter in real applications.

### Understanding ALB Listeners and Rules

An ALB listener is the entry point for incoming traffic. It listens on a specific protocol and port — typically HTTPS on port 443 for production workloads — and then uses rules to decide what to do with each request.

Think of a listener as a receptionist at a busy office. Requests arrive at the receptionist's desk (the listener), and the receptionist uses a set of decision rules to figure out which department (target group) should handle each request. The rules are evaluated in priority order, and the first matching rule wins.

Each listener must have at least one default rule that catches any traffic that doesn't match the higher-priority rules. This acts as a safety net, ensuring no request goes unhandled. Rules between the default and the fallback are evaluated by their assigned priority number, starting from 1 and increasing. Lower numbers are checked first.

### Creating Your First HTTPS Listener

Before you can configure rules, you need to create a listener. Most production ALBs listen on HTTPS:443 because you want to encrypt traffic in transit.

When you create an HTTPS listener, you'll need to specify an SSL certificate. AWS Certificate Manager (ACM) is the standard choice here — you can upload a certificate or request one directly from ACM if you own the domain. The listener will use this certificate to decrypt incoming HTTPS traffic and then evaluate your rules against the unencrypted request.

Here's what the listener configuration looks like conceptually. You'd typically do this through the AWS Console, but understanding the underlying structure helps:

```json
{
  "Protocol": "HTTPS",
  "Port": 443,
  "Certificates": [
    {
      "CertificateArn": "arn:aws:acm:region:account-id:certificate/cert-id"
    }
  ],
  "DefaultActions": [
    {
      "Type": "fixed-response",
      "FixedResponseConfig": {
        "StatusCode": "404",
        "ContentType": "text/plain",
        "MessageBody": "Not Found"
      }
    }
  ]
}
```

In practice, your default action would forward to a target group or perhaps to a catch-all microservice. But the structure shows how a listener needs a protocol, port, certificate (for HTTPS), and a default action.

Many applications also maintain an HTTP:80 listener that simply redirects all traffic to HTTPS. This ensures that even if a client accidentally uses HTTP, they're seamlessly redirected to the secure channel.

### Rule Priorities and Evaluation Order

Here's a critical detail that trips up many developers: rules are evaluated in priority order, and the first rule that matches terminates the evaluation. There is no "continue" or "fall-through" behavior.

If you have three rules with priorities 1, 2, and 3, and a request matches both rule 1 and rule 3, only rule 1's action is executed. Rule 3 is never even evaluated.

This means when you're designing your rule set, you need to think carefully about the order. More specific conditions should have higher priority (lower numbers) than more general conditions. For example, if you have a rule that matches all paths starting with `/api/` and another that matches `/api/admin/`, the `/api/admin/` rule should have a lower number so it gets checked first.

Here's a practical example. Imagine you're routing traffic for an e-commerce platform:

- **Priority 1**: If the path matches `/api/admin/*` and the source IP is from your corporate network, forward to the admin microservice
- **Priority 2**: If the path matches `/api/*`, forward to the main API microservice
- **Priority 3**: If the path matches `/images/*`, forward to the CDN origin shield
- **Priority 4** (default): Forward to the web frontend

With this ordering, a request to `/api/admin/users` would match priority 1 and go to the admin service. A request to `/api/products` would skip priority 1 (path doesn't match), skip priority 3, and match priority 2. A request to `/home` would skip all three and hit the default rule.

### Condition Types: Matching Requests with Precision

ALB rules evaluate conditions to determine whether a rule applies to an incoming request. AWS provides several condition types, and you can combine multiple conditions in a single rule using AND logic. All conditions in a rule must be true for the rule to match.

**Path Pattern Matching** is perhaps the most common condition type. It lets you match based on the request path using wildcards. The asterisk (`*`) represents zero or more characters, so `/api/*` matches `/api/users`, `/api/products`, and even `/api/v1/orders`. The question mark (`?`) matches exactly one character, which is useful for more specific matching.

Path patterns are case-insensitive by default. So `/API/*` and `/api/*` match the same requests. If you need case-sensitive matching, you'll want to implement that in your application or use a more sophisticated routing layer.

For example, you might have:
- `/images/*` for static assets
- `/api/v1/*` for version 1 of your API
- `/reports/*` for reporting services
- `/health*` for health check endpoints

**Host Header Matching** is useful when you're hosting multiple applications behind a single ALB. If you own both `api.example.com` and `admin.example.com`, you can create separate rules for each hostname, even though they resolve to the same ALB IP address.

```json
{
  "Field": "host-header",
  "Values": ["api.example.com", "api.staging.example.com"]
}
```

This condition matches when the Host header in the HTTP request matches one of the specified values. It's a clean way to implement multi-tenant routing or to separate concerns between different subdomains.

**HTTP Header Conditions** let you match based on any HTTP header sent by the client. This is powerful for implementing feature flags, routing based on API keys, or directing specific client versions to different backends.

```json
{
  "Field": "http-header",
  "HttpHeaderConfig": {
    "HttpHeaderName": "X-Client-Version",
    "Values": ["2.0"]
  }
}
```

You might use this to route all requests from a legacy mobile app version to a backward-compatible service, while newer versions get routed to your current service.

**Query String Matching** examines parameters in the query string and can match on key-value pairs. This is useful for feature flags, experiments, or routing based on tenant information passed in the URL.

```json
{
  "Field": "query-string",
  "QueryStringConfig": {
    "Values": [
      {
        "Key": "tenant_id",
        "Value": "acme-corp"
      }
    ]
  }
}
```

A request like `/orders?tenant_id=acme-corp&page=1` would match this condition.

**Source IP Matching** allows you to create rules based on where the request originates. This is valuable for internal-only services, geographic routing, or allowing access only from your corporate network.

```json
{
  "Field": "source-ip",
  "SourceIpConfig": {
    "Values": ["10.0.0.0/8", "203.0.113.0/24"]
  }
}
```

You specify CIDR blocks, so you can match any IP within a range.

**HTTP Request Method Matching** routes based on the HTTP verb — GET, POST, PUT, DELETE, etc. You might use this if different services handle different types of requests.

```json
{
  "Field": "http-request-method",
  "HttpRequestMethodConfig": {
    "Values": ["GET", "HEAD"]
  }
}
```

In practice, you'd combine multiple conditions. For example, "if the path matches `/api/reports/*` AND the HTTP method is GET, forward to the reporting service" creates a more precise rule than either condition alone.

### Action Types: What to Do When a Rule Matches

Once a rule matches, an action determines what happens to the request. ALB supports several action types, and they're more flexible than many developers realize.

**Forward to Target Group** is the most straightforward action. You specify a target group, and the ALB sends the request to one of the healthy targets in that group, using round-robin load balancing by default.

```json
{
  "Type": "forward",
  "TargetGroupArn": "arn:aws:elasticloadbalancing:region:account-id:targetgroup/my-api-service/abc123"
}
```

Behind the scenes, the ALB maintains a connection to each healthy target and distributes requests across them. If a target becomes unhealthy (failing health checks), it's automatically removed from the rotation.

**Redirect Actions** let you send the client a redirect response instead of forwarding to a backend service. This is commonly used to redirect HTTP to HTTPS, or to change URL structures without rewriting on the backend.

```json
{
  "Type": "redirect",
  "RedirectConfig": {
    "Protocol": "HTTPS",
    "Port": "443",
    "StatusCode": "HTTP_301"
  }
}
```

This specific redirect keeps the original hostname, path, and query string but forces HTTPS. You can customize any part — the protocol, port, hostname, path, and query string. You can also choose between HTTP 301 (permanent) and HTTP 302 (temporary) redirects.

**Fixed Response Actions** let the ALB return a response directly without contacting any backend service. This is useful for health check endpoints, maintenance pages, or blocking specific requests at the load balancer level.

```json
{
  "Type": "fixed-response",
  "FixedResponseConfig": {
    "StatusCode": "200",
    "ContentType": "application/json",
    "MessageBody": "{\"status\":\"healthy\"}"
  }
}
```

This could power your `/health` endpoint, returning a 200 OK without hitting your microservices. It reduces load on your backend and provides faster response times for monitoring systems.

**Authenticate with Cognito** and **Authenticate with OIDC** actions let you add authentication at the load balancer layer. The ALB validates the user's credentials before forwarding the request to your service, and it injects user information into headers that your application can read.

```json
{
  "Type": "authenticate-cognito",
  "AuthenticateCognitoConfig": {
    "UserPoolArn": "arn:aws:cognito-idp:region:account-id:userpool/region_poolid",
    "UserPoolClientId": "client_id",
    "UserPoolDomain": "my-domain"
  },
  "Order": 1
}
```

When a user arrives without valid authentication, they're redirected to the Cognito login page. After they authenticate, they're redirected back to your application, and the ALB adds headers like `x-amzn-oidc-identity` containing the authenticated user's information.

This is a powerful pattern because it offloads authentication to a managed service, reducing the burden on your microservices. Each service doesn't need to implement its own authentication — it can trust that if a request reaches it, the user is already authenticated.

### Path-Based Routing in Practice

Let's walk through a realistic scenario: an e-commerce platform with multiple microservices. You have a web frontend, an API service for product information, a payment service, an image service, and an admin dashboard. All should be accessible through a single domain, `mystore.example.com`.

Your rule set might look like this:

**Rule 1** (Priority 1): Path pattern `/admin/*` and source IP is from your office network → forward to admin-dashboard target group

**Rule 2** (Priority 2): Path pattern `/api/payments/*` and HTTP method is POST → forward to payment-service target group

**Rule 3** (Priority 3): Path pattern `/api/*` → forward to api-service target group

**Rule 4** (Priority 4): Path pattern `/images/*` → forward to image-service target group

**Rule 5** (Priority 5, Default): → forward to web-frontend target group

Here's how different requests would be routed:

- Request to `/admin/users` from 203.0.113.50 (office IP): Matches rule 1 → admin dashboard
- Request to `/admin/users` from 192.0.2.1 (external IP): Doesn't match rule 1 (IP condition fails), continues to rule 2, doesn't match, continues through rules, matches rule 5 → web frontend
- Request to `/api/payments/process` with POST: Matches rule 2 → payment service
- Request to `/api/products` with GET: Skips rules 1-2, matches rule 3 → API service
- Request to `/images/product-123.jpg`: Matches rule 4 → image service
- Request to `/checkout`: Matches rule 5 → web frontend

The beauty of this approach is that your frontend clients only need to know about `mystore.example.com`. They don't need to know about the existence or locations of the individual microservices. The ALB acts as an intelligent traffic director, hiding the complexity of your backend infrastructure.

### Combining Conditions: The AND Logic

Here's an important principle: when you add multiple conditions to a single rule, they're combined with AND logic. All conditions must be true for the rule to match.

Suppose you want to route requests to your API service, but only for authenticated users. You could create a rule like this:

- Condition 1: Path matches `/api/*`
- Condition 2: HTTP header `Authorization` contains a valid token (checked by your backend)
- Action: Forward to API service

Actually, wait — the second condition is problematic because ALB can't validate token authenticity. It can only check if the header exists and contains specific values. For token validation, you'd need to rely on your backend service.

But here's a better example. You want to route admin requests only when they come from your internal network:

- Condition 1: Path matches `/admin/*`
- Condition 2: Source IP is 10.0.0.0/8
- Action: Forward to admin service

Without condition 2, external users could access your admin endpoints. With both conditions, only internal requests to admin paths are routed to the admin service.

What about external requests to `/admin/*`? They don't match this rule (condition 2 fails), so the ALB continues to the next rule. If there's no other matching rule, the default action catches them.

### The Default Rule: Your Safety Net

Every listener must have exactly one default rule with no conditions. This rule matches all requests that don't match any higher-priority rule. Think of it as the catch-all bucket at the end of your routing logic.

In most applications, the default rule forwards to your main service or application. For example, in the e-commerce scenario above, the default rule forwards all unmatched requests to the web frontend. This ensures that direct requests to `/checkout` or `/products/details` reach the right service even if you haven't explicitly defined rules for every path.

You can also use the default rule for fixed responses, redirects, or authentication. Some teams use it to return a 404 for any unrecognized path, though this is risky if you haven't covered all legitimate paths in your higher-priority rules.

### Working with JSON Configuration

While the AWS Console provides a visual interface for creating rules, understanding the JSON representation is valuable when you're automating deployments or troubleshooting issues via the CLI.

Here's a complete rule definition for a path-based routing scenario:

```json
{
  "Priority": 1,
  "Conditions": [
    {
      "Field": "path-pattern",
      "Values": ["/api/*"],
      "PathPatternConfig": {
        "Values": ["/api/*"]
      }
    },
    {
      "Field": "http-request-method",
      "HttpRequestMethodConfig": {
        "Values": ["GET", "POST"]
      }
    }
  ],
  "Actions": [
    {
      "Type": "forward",
      "TargetGroupArn": "arn:aws:elasticloadbalancing:region:account-id:targetgroup/api-service/abc123",
      "Order": 1
    }
  ]
}
```

This rule says: "If the path matches `/api/*` AND the HTTP method is GET or POST, forward to the api-service target group."

You can create or modify rules using the AWS CLI:

```bash
aws elbv2 create-rule \
  --listener-arn arn:aws:elasticloadbalancing:region:account-id:listener/app/my-alb/1234567890abcdef/abc123def456 \
  --priority 1 \
  --conditions Field=path-pattern,Values=/api/* \
  --actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:region:account-id:targetgroup/api-service/abc123
```

The CLI syntax is concise but can be verbose for complex rules. For automation, you might use Infrastructure as Code tools like CloudFormation or Terraform, which let you define your rules in a more readable format and version-control your infrastructure.

### Common Routing Patterns and Scenarios

**Microservices with Versioning**: If you're running multiple versions of your API simultaneously for backward compatibility, you can route based on path:

- `/api/v1/*` → api-service-v1 target group
- `/api/v2/*` → api-service-v2 target group

Or route based on a header:

- `X-API-Version: 1` → api-service-v1
- `X-API-Version: 2` → api-service-v2

This lets clients opt into the version they want.

**Canary Deployments**: You might route 5% of traffic to a new version of your service and 95% to the stable version. This isn't done with ALB rules directly — instead, you'd use weighted target groups within a single forward action, but the principle is similar: use rules to segment traffic, then distribute it carefully.

**Geographic Routing**: If you're running services in multiple regions with global load balancing, the ALB can route based on source IP to direct traffic to the nearest service. You'd combine source IP conditions with your organization's geographic IP ranges.

**Feature Flags in URLs**: Query string conditions let you route requests with specific feature flags to canary or experimental services:

- Query string contains `experimental=true` → experimental-service
- Otherwise → stable-service

**Multi-Tenant Applications**: If you're building a SaaS platform, you might route based on the hostname or a query parameter to route each tenant to their dedicated service:

- Host header `tenant1.example.com` → tenant1-service
- Host header `tenant2.example.com` → tenant2-service

### Performance and Cost Considerations

ALB listener rules are processed extremely quickly — we're talking microseconds. The number of rules you have doesn't significantly impact latency, so you don't need to worry about performance degradation if you have dozens of rules.

From a cost perspective, ALBs charge based on the number of load balancer capacity units (LCUs) consumed, not the number of rules. More rules don't directly increase your costs. However, more traffic or more connections do, so optimizing your routing to avoid unnecessary hops or downstream processing is still worthwhile.

One performance optimization: place more frequently matched rules at higher priorities (lower numbers). This means the ALB can short-circuit evaluation earlier. If 80% of your traffic goes to `/api/*`, that rule should have higher priority than rules matching rarer paths.

### Troubleshooting Rule Matching Issues

Sometimes requests aren't being routed where you expect. Here are some common gotchas:

**Case Sensitivity**: Path patterns are case-insensitive, but host headers are case-sensitive. If you have a rule for `api.example.com` and a client sends a request with `API.EXAMPLE.COM`, it won't match.

**Trailing Slashes**: The path `/api/` is different from `/api`. If your rule specifies `/api/*`, a request to `/api` (no trailing slash) won't match. Make sure your rules account for this variation.

**Condition Order Doesn't Matter**: You might think conditions are evaluated in the order you define them, but they're evaluated as a logical AND. The order in the rule definition doesn't affect matching. All conditions must be true for the rule to match.

**Missing Default Action**: If you delete or modify your default rule without ensuring there's still a default, you'll end up with requests that don't match any rule, resulting in HTTP 503 Service Unavailable errors.

**Port Specification in Host Header**: The host header should not include the port (`:443` is automatically implied for HTTPS). If your rule checks for `api.example.com:443`, it won't match a standard HTTPS request that sends just `api.example.com`.

To troubleshoot, check your ALB access logs. They record every request and which rule was matched, making it easy to see where traffic is being routed. You can enable access logs on your ALB and stream them to S3 or CloudWatch for analysis.

### Advanced Patterns: Authentication and Authorization

While ALB can't validate the contents of a request body, it's quite capable of implementing common authentication patterns at the load balancer level.

If you use Amazon Cognito for user management, you can add an authenticate-cognito action to your rules. This offloads authentication to Cognito, which handles login pages, password resets, multi-factor authentication, and more. Your microservices never see unauthenticated requests — they receive authenticated ones with user information in headers.

Similarly, OIDC authentication lets you integrate with third-party identity providers, enabling scenarios like "log in with GitHub" or connecting to your organization's Okta instance.

After authentication, you can layer authorization on top of ALB rules. For example:

- Rule 1: Path is `/admin/*` AND the user's Cognito group is "admins" (passed via header from your service) → admin-service
- Rule 2: Path is `/user/*` → user-service

Actually, the Cognito group membership isn't automatically passed as a header — that's something your service would need to extract from the JWT token. But the point is that you can combine authentication (managed by ALB/Cognito) with authorization logic (in your services or via more sophisticated routing).

### Bringing It All Together

ALB listener rules are your primary tool for intelligent traffic routing in a microservices architecture. By combining path-based routing, host-based routing, and conditional logic, you can direct traffic from a single entry point to dozens of backend services with precise control.

The key to mastering ALB rules is understanding the priority order, the AND logic for combining conditions, and the flexibility of action types. Start with the basics — simple path-based routing — and gradually add complexity as your architecture grows. Remember that the default rule is your safety net; make sure it's always defined and routes traffic somewhere sensible.

When you're designing your rule set, think from the request's perspective. Each incoming request travels down the priority list until it finds a matching rule. The order matters, conditions must all be true, and the first match wins. With this mental model, you can design routing logic that's both powerful and understandable for your team.

In production environments, take advantage of access logs to monitor traffic patterns and validate that rules are behaving as expected. Use Infrastructure as Code to version-control your rules, making changes traceable and reproducible. And remember that while ALB rules are fast and flexible, they're not a substitute for proper application design — your services should still be resilient, well-tested, and able to handle their intended load.
