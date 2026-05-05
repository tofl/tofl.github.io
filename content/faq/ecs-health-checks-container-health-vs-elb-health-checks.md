---
title: "ECS Health Checks: Container Health vs ELB Health Checks"
---

## ECS Health Checks: Container Health vs ELB Health Checks

When you deploy containers to Amazon ECS, you're actually managing health at two distinct layers—and they don't always talk to each other in the way you might expect. Understanding the difference between Docker-level health checks embedded in your task definition and the load balancer health checks monitored by an Elastic Load Balancer is critical for building reliable, self-healing infrastructure. Get this wrong, and you'll watch perfectly healthy containers get torn down during slow startup periods, or worse, traffic will keep routing to failing containers.

This article untangles the relationship between these two health check mechanisms, shows you how ECS actually uses them, and walks you through the configuration decisions that matter in production.

### Why Health Checks Matter in ECS

Health checks are how your infrastructure knows whether a container is actually ready and capable of handling traffic. Without them, ECS makes scheduling decisions blindly, and your load balancer happily routes requests to containers that might be crashing or stuck in initialization.

Think of it this way: a container process might be running (the container hasn't exited), but that doesn't mean it's healthy. Maybe your application is still warming up caches, database connections are timing out, or a dependency service is unreachable. A proper health check lets ECS and your load balancer know about these states before they become customer-facing problems.

The tricky part is that ECS has two separate health check systems running in parallel, and they serve different purposes. One lives inside your container and reports to ECS itself. The other lives in your load balancer and determines whether traffic should reach your container. Confusing the two—or failing to configure both—creates gaps where problems slip through.

### The Docker HEALTHCHECK in Your Task Definition

The HEALTHCHECK instruction in your Docker image (or equivalently, the healthCheck property in your ECS task definition) is about container-level health. This is a command that runs periodically inside the container and reports back to ECS with a simple status: healthy, unhealthy, or starting.

Let's look at a practical example. Suppose you have a Node.js application that needs a few seconds to fully initialize:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
```

Breaking down those parameters:

**interval=10s** means the health check command runs every 10 seconds once the container starts. **timeout=5s** means if the curl command doesn't complete within 5 seconds, that attempt is marked as failed. **start-period=30s** is the grace period—ECS won't count failed checks during the first 30 seconds, giving your application time to boot. **retries=3** means the container must fail three consecutive checks before ECS marks it as unhealthy.

When you use this in ECS, you'd configure it in your task definition like this:

```json
{
  "containerDefinitions": [
    {
      "name": "my-app",
      "image": "my-registry/my-app:latest",
      "portMappings": [
        {
          "containerPort": 3000
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        "interval": 10,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      }
    }
  ]
}
```

The key thing to understand is that this health check is for ECS. When the container fails its health checks repeatedly, ECS treats the task as unhealthy and can replace it according to your service configuration. However—and this is crucial—the load balancer doesn't directly use this information. The load balancer has its own health checks.

### ELB Target Group Health Checks: The Traffic Gatekeeper

Your load balancer (whether it's an Application Load Balancer, Network Load Balancer, or Classic Load Balancer) runs entirely separate health checks on the targets behind it. These checks determine whether traffic gets routed to your container. Even if ECS thinks your container is healthy, the load balancer might disagree and drain the target.

When you register ECS tasks as targets in a load balancer target group, you configure checks like this:

```json
{
  "HealthCheckEnabled": true,
  "HealthCheckProtocol": "HTTP",
  "HealthCheckPath": "/health",
  "HealthCheckIntervalSeconds": 30,
  "HealthCheckTimeoutSeconds": 5,
  "HealthyThresholdCount": 2,
  "UnhealthyThresholdCount": 2,
  "Matcher": {
    "HttpCode": "200"
  }
}
```

The load balancer makes actual HTTP requests to the path you specify and looks for the HTTP status code you defined. If it gets the right response enough times, the target is healthy and receives traffic. If it starts failing, it gets unhealthy and traffic drains away.

Notice that these parameters are completely independent from your Docker HEALTHCHECK. The load balancer doesn't care if ECS thinks your container is healthy. It's running its own checks against your application endpoint.

### How ECS Actually Uses Health Checks

Here's where the mental model needs to shift: ECS and your load balancer are making independent decisions about container health, but they're often working toward the same goal with different tools.

When you run a service in ECS with a HEALTHCHECK defined in the task definition, ECS monitors the container's health status. If the container fails its health checks repeatedly (after the start period expires), the task enters an UNHEALTHY state. Depending on your service configuration—specifically the `deploymentConfiguration` settings—ECS can automatically stop that task and launch a replacement.

Meanwhile, your load balancer is independently checking that same container. When the load balancer notices the container failing its health checks, it marks the target as UNHEALTHY and removes it from the load balancing rotation. No new requests get sent to it.

These two systems are not connected by default. Your ECS health check doesn't automatically update the load balancer's health status, and the load balancer's health doesn't automatically trigger ECS to replace the task. Each system acts on its own observations.

However, they do create a powerful combined effect: a container that's truly broken will eventually be detected by at least one of these mechanisms, and both will take action. But there's a critical window where things can go wrong.

### The Start Period Grace Window and the Killer Pitfall

This is where most people run into trouble. The start period in your Docker HEALTHCHECK (set with `startPeriod` in ECS) tells ECS: "Don't count failures as real failures during the first N seconds—the app is starting up." This is essential because applications need time to initialize.

But here's the catch: **the load balancer has no concept of a start period**. It starts checking your container immediately, regardless of whether your application is ready.

Imagine this scenario:

1. You deploy a new task with a 30-second start period in the Docker HEALTHCHECK
2. The container starts, but your Node.js app needs 15 seconds to initialize
3. The load balancer immediately starts making health check requests
4. For those first 15 seconds, your application isn't fully ready, so requests to `/health` might fail or timeout
5. The load balancer sees these failures and marks the target as unhealthy
6. Traffic stops routing to the container, even though ECS doesn't care yet (it's still in the start period)

You've just created a race condition where the load balancer is more aggressive than your Docker health check, and traffic gets blocked unnecessarily.

The solution is to ensure your load balancer health check parameters account for startup time. If your application needs 15 seconds to initialize, you should not set the load balancer to check every 5 seconds starting immediately. Instead, consider:

**Align your unhealthy threshold with your startup reality.** If you check every 30 seconds and allow 2 failures before marking unhealthy, you're giving your app up to 60 seconds to become healthy—more than enough for most applications.

**Use connection-level health checks where possible.** With a Network Load Balancer, you can use TCP health checks instead of HTTP, which eliminate the need for your application to have the health endpoint fully functional during startup.

**Deregister delay for graceful shutdown.** Set the target's deregistration delay (connection draining) to give in-flight requests time to complete even if the load balancer marks it unhealthy.

### Practical Configuration for Production Deployments

Let's walk through a realistic production configuration. Suppose you have a Python Flask application that takes about 10 seconds to initialize and connect to its database.

In your task definition, you might set:

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -f http://localhost:5000/health || exit 1"],
    "interval": 10,
    "timeout": 3,
    "retries": 2,
    "startPeriod": 15
  }
}
```

This says: give the app 15 seconds before checking, then check every 10 seconds, and only mark it unhealthy after 2 consecutive failures (20 seconds of failures). The timeout of 3 seconds is generous enough for a localhost call.

In your load balancer target group, you'd configure:

```json
{
  "HealthCheckProtocol": "HTTP",
  "HealthCheckPath": "/health",
  "HealthCheckIntervalSeconds": 30,
  "HealthCheckTimeoutSeconds": 5,
  "HealthyThresholdCount": 2,
  "UnhealthyThresholdCount": 3,
  "Matcher": {
    "HttpCode": "200"
  }
}
```

Notice the differences: the load balancer checks every 30 seconds (less frequent), the timeout is longer (5 seconds instead of 3), and you need 3 consecutive failures before marking unhealthy. This makes the load balancer slower to react than the Docker health check, which is intentional—you want ECS to make the replacement decision, and you don't want the load balancer draining healthy containers during normal operations.

For your ECS service deployment configuration:

```json
{
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 100,
    "deploymentCircuitBreaker": {
      "enable": true,
      "rollback": true
    }
  }
}
```

The `minimumHealthyPercent: 100` means you always need at least one healthy task running. The deployment circuit breaker will automatically roll back if the new version fails health checks, preventing a cascading failure.

### Distinguishing Between Container Replacement and Traffic Draining

Here's a distinction that frequently confuses people: ECS health checks drive **container replacement**, while load balancer health checks drive **traffic draining**.

When an ECS task fails its health checks enough times to be marked unhealthy, ECS will stop that task and start a new one (assuming your service has desired count > 0 and your deployment configuration allows it). This is a container replacement—a new task spins up.

When a load balancer marks a target unhealthy, it simply stops sending new requests to it. Depending on your deregistration delay settings, existing connections might be allowed to complete. But no new traffic arrives. The container might still be running; it's just not receiving requests. The load balancer will keep checking it and could mark it healthy again if the checks pass.

These are independent actions. A healthy container (from ECS's perspective) might still be drained by the load balancer if it's failing load balancer health checks. Conversely, a container that ECS is replacing might still be receiving traffic from the load balancer briefly, until the load balancer detects it's failing.

In practice, a well-configured system should have both mechanisms agreeing most of the time. But they're not synchronized, and understanding their independence is crucial for troubleshooting.

### Common Pitfalls and How to Avoid Them

**Underestimating startup time.** Many developers set a 5-second start period when their application actually needs 20. The result is that ECS immediately marks the container unhealthy and replaces it in a cycle. Always test your actual startup time under realistic conditions (cold start, including database connection pools, cache initialization, etc.) and add padding.

**Making the load balancer health endpoint too complex.** If your `/health` endpoint queries the database or calls downstream services, it becomes a probe that's measuring more than just container health—it's measuring the health of your entire stack. A simple health endpoint that just returns 200 is better. If you need to validate dependencies, do that asynchronously and update a flag that the health endpoint returns.

**Forgetting about the deregistration delay.** If a container is terminating, you want in-flight requests to complete. Set your target deregistration delay to 30 seconds or higher. Otherwise, connections get abruptly closed when the load balancer drains the target.

**Health checks that are too aggressive.** If you check every 5 seconds and fail after 1 retry, your tolerance for transient hiccups is very low. In production, especially under load, occasional slow responses are normal. Build in enough retries and intervals to absorb brief blips.

**Not testing the health endpoint yourself.** Before deploying, manually curl your health endpoint from a container in your environment. See how fast it responds, whether it works when dependencies are slow, what happens if the database is down. Don't assume it works just because the code is there.

### Monitoring and Debugging Health Check Issues

When containers are cycling or traffic isn't routing correctly, your first debugging step should be to check the health check status in the console or via the CLI.

Using the AWS CLI, you can describe your service to see the health status of running tasks:

```bash
aws ecs describe-services \
  --cluster my-cluster \
  --services my-service \
  --query 'services[0].deployments'
```

Look at the deployment status—how many tasks are running, pending, or failed? If tasks are stuck in PROVISIONING, it's usually a health check problem.

To see more details on a specific task:

```bash
aws ecs describe-tasks \
  --cluster my-cluster \
  --tasks <task-arn> \
  --query 'tasks[0].[lastStatus,healthStatus,stoppingAt]'
```

For the load balancer side, check the target health:

```bash
aws elbv2 describe-target-health \
  --target-group-arn <arn>
```

This shows you each target and whether it's healthy, unhealthy, draining, or initial. The "initial" state means the load balancer hasn't completed its first health check yet—give it time.

### Health Checks Without a Load Balancer

Not all ECS services sit behind a load balancer. Some services are internal-only, or accessed through service discovery. In these cases, the ECS health check is your only line of defense.

This makes the Docker HEALTHCHECK even more critical. Without a load balancer to drain traffic, a failed health check should definitely trigger a replacement. Make sure your service deployment configuration has the right `minimumHealthyPercent` and `maximumPercent` to allow ECS to replace failed tasks smoothly.

For services using service discovery (like CloudMap), the health status should also be reflected in your service discovery queries. Clients discovering the service should only receive healthy task IPs. Verify that your service discovery integration is properly configured.

### Health Check Endpoints That Actually Work

A production-quality health endpoint is simpler than you might think. Here's a Python Flask example:

```python
@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"}), 200
```

That's it. No database queries, no downstream service calls, no complex logic. Just a fast response. If you need to validate that your database is reachable, do that as a background task and update a module-level flag:

```python
database_connected = False

def check_database_connection():
    global database_connected
    try:
        # Quick connection test
        db.engine.execute(text('SELECT 1'))
        database_connected = True
    except Exception:
        database_connected = False

@app.route('/health', methods=['GET'])
def health():
    if not database_connected:
        return jsonify({"status": "degraded"}), 503
    return jsonify({"status": "healthy"}), 200
```

The health endpoint should respond in milliseconds, not seconds. It should also be tolerant of temporary blips. Returning a 503 on a transient database hiccup might trigger unnecessary container replacement.

### Tuning for Your Application's Lifecycle

Different applications have different health needs. A stateless API server might achieve full health in 2 seconds. A data processing job that loads gigabytes into memory might need 60 seconds. Microservices that depend on other services might have cascading startup times.

Profile your actual application startup in a staging environment under realistic load. Don't guess. And as you optimize your code, revisit your health check parameters—faster startup means you can be more aggressive with your health checks if needed.

The deployment circuit breaker feature in modern ECS is also your friend here. If a new service version is failing health checks widely, it will automatically roll back. This prevents a bad deployment from taking down your service entirely.

### Bringing It Together

Health checks in ECS are a two-layer system: Docker HEALTHCHECK for container lifecycle management in ECS, and load balancer health checks for traffic routing. They're independent but complementary.

To get it right in production:

Configure your Docker HEALTHCHECK with a realistic start period and reasonable retry logic. Make sure it actually tests that your application is ready, not just that the process is running.

Configure your load balancer health checks to be slightly more lenient than your Docker health checks. You want ECS to drive the replacement decision, not the load balancer.

Test both mechanisms before deploying to production. Curl your health endpoint manually, watch your ECS metrics, monitor your load balancer target health.

Document your health check strategy. Future you—or your ops team—will thank you when something breaks at 3 AM.

With these practices in place, your ECS services will be resilient, self-healing, and capable of gracefully handling failures and rolling deployments without unnecessary downtime.
