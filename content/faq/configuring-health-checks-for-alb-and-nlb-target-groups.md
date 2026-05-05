---
title: "Configuring Health Checks for ALB and NLB Target Groups"
---

## Configuring Health Checks for ALB and NLB Target Groups

Building resilient applications on AWS means ensuring your load balancers can intelligently route traffic only to healthy instances. Health checks are the mechanism that powers this intelligence, yet they're often misconfigured in ways that cause subtle reliability issues. Whether your application experiences intermittent failures, mysterious instance removals from the load balancer, or delayed recovery from outages, the root cause frequently traces back to suboptimal health check configuration.

This guide walks you through everything you need to know about designing and configuring health checks for both Application Load Balancers (ALBs) and Network Load Balancers (NLBs). You'll learn the mechanics of how health checks work, explore the parameters you can tune, understand the critical differences between ALB and NLB implementations, and discover patterns that prevent common failure modes.

### Understanding Health Checks: The Fundamentals

At their core, health checks are periodic probes that your load balancer sends to target instances to determine whether they're ready to receive traffic. Think of them as a heartbeat monitor for your infrastructure. Every few seconds, the load balancer reaches out to each instance and waits for a response that indicates "yes, I'm healthy and ready to handle requests."

When an instance fails its health check, the load balancer stops sending new traffic to it. This automatic circuit breaker prevents cascade failures where a degraded instance receives traffic, times out, creates a poor user experience, and potentially causes other services to back up waiting for responses.

The stakes are high: misconfigure your health checks and you might remove healthy instances unnecessarily, causing unnecessary failovers and increased latency. Alternatively, keep failing instances in rotation because your health check is too lenient, and you've undermined your load balancer's entire purpose.

### The Core Parameters: Building Your Health Check Configuration

Every health check is defined by a set of parameters that work together. Let's examine each one and understand how they influence behavior.

**Protocol** determines how the load balancer communicates with targets. For ALBs, you can choose HTTP or HTTPS. For NLBs, the options are TCP, HTTP, or HTTPS. The protocol you select should match the protocol your application listens on. If your application runs HTTP on port 8080, your health check should use HTTP, not TCP—TCP only verifies that the port is open and accepting connections, not that your application is actually running or responding correctly.

**Port** specifies which port on the instance to probe. By default, the health check uses the same port as your traffic target, which is usually the right choice. However, you might occasionally want a separate health check port. Some teams run a lightweight health check service on a different port specifically to avoid contention with production traffic. If you do this, ensure that port is protected by your security group.

**Path** applies only to HTTP and HTTPS health checks. This is the URI the load balancer requests, for example `/health` or `/api/status`. The target must return an HTTP response to this path for the health check to succeed. This parameter is your gateway to application-level health checking, which we'll explore deeply in a moment.

**Interval** is how frequently, in seconds, the load balancer sends health check requests. The default is 30 seconds. A shorter interval means faster failure detection but more network traffic and CPU usage on your instances. A longer interval reduces overhead but means it takes longer to detect problems. In most production systems, 30 seconds is reasonable. For highly available systems where rapid detection matters, consider dropping to 15 seconds, but monitor the aggregate health check traffic across all your targets.

**Timeout** specifies how long, in seconds, the load balancer waits for a response before considering the health check failed. The default is 5 seconds. Your application must respond within this window. If your application has inherently slower endpoints, you might need to increase this, but be cautious—a very long timeout defeats the purpose of rapid failure detection.

**Healthy Threshold** is how many consecutive successful health checks must occur before a newly started or previously unhealthy instance is marked healthy and receives traffic. The default is 2. This prevents flapping—an instance shouldn't enter the rotation on a single successful check, which might be a coincidence. If you set this to 5, an instance needs 5 consecutive successful health checks before traffic flows to it. This increases the time to recovery but makes your system more stable.

**Unhealthy Threshold** is how many consecutive failed health checks must occur before a healthy instance is marked unhealthy and removed from rotation. The default is 2. Like the healthy threshold, this prevents transient failures from causing unnecessary removal. A single timeout shouldn't knock an instance out of rotation.

**Success Codes** apply to HTTP and HTTPS health checks and specify which HTTP status codes count as a successful response. The default is 200. You can customize this to accept multiple codes, like 200-299 to accept any 2xx response, or 200,202,204 for specific codes. This flexibility lets you tailor health checks to your application's specific response patterns.

### ALB Health Checks: HTTP and HTTPS Specifics

Application Load Balancers understand HTTP, making them ideal for web applications and microservices. ALB health checks operate at Layer 7 (the application layer), meaning the load balancer constructs an HTTP request and interprets the response.

When you configure an ALB health check with HTTP, the load balancer sends a request like this:

```
GET /health HTTP/1.1
Host: target-instance-ip:port
User-Agent: ELB-HealthChecker/2.0
Connection: close
```

Your application must parse this request and return an appropriate HTTP response. The load balancer examines the status code and, if you've configured custom success codes, checks whether the response matches.

HTTPS health checks work similarly but establish a TLS connection first. This adds latency and computational overhead but allows you to verify that your TLS configuration is correct. If your application serves HTTPS and you use HTTPS health checks, you're ensuring that not only is your application running, but your TLS handshake succeeds—which catches certificate expiration, misconfiguration, and related issues.

One important detail: ALB health checks can include headers and path parameters. For instance, you might configure the path as `/health?deep=true` to trigger deeper dependency verification. You can also set a host header, which is particularly useful if your application uses virtual hosts or requires a specific Host header to function correctly.

### NLB Health Checks: TCP, HTTP, and HTTPS Options

Network Load Balancers operate at Layer 4 (the transport layer) and Layer 7, offering more flexibility for non-HTTP protocols. NLB health checks come in three flavors.

**TCP health checks** simply verify that the target is listening on the specified port and accepting connections. The load balancer opens a connection, and if the handshake succeeds, the health check passes. TCP checks are fast and incur minimal overhead, making them ideal for high-throughput, latency-sensitive applications like real-time gaming or financial trading systems. However, they're the least intelligent—a TCP health check can't determine whether your application is actually functional, only that the port is open.

**HTTP and HTTPS health checks** on an NLB work similarly to ALB health checks in that they verify application-level functionality. The NLB sends an HTTP request to a specified path and port, interprets the response status code, and marks the target accordingly. The advantage of NLB HTTP health checks over TCP is that you gain application-level visibility while maintaining NLB's high-performance characteristics and support for non-HTTP protocols on the same load balancer.

A practical scenario: you're running a service that handles both HTTP API requests and raw TCP streams on different ports. You might use an NLB with TCP health checks on the raw socket port and HTTP health checks on the HTTP port, giving you granular control over target health across multiple protocols.

### Designing a Dedicated Health Endpoint

The path to robust health checking is building a dedicated health endpoint in your application. Rather than relying on your primary application endpoints (which might be slow, complex, or dependent on cache layers), create a lightweight `/health` endpoint that runs quickly and reports accurate status.

Here's what a well-designed health endpoint looks like:

```python
@app.get('/health')
def health_check():
    checks = {
        'database': check_database_connection(),
        'cache': check_cache_connection(),
        'external_api': check_external_api_readiness()
    }
    
    if all(checks.values()):
        return {'status': 'healthy', 'details': checks}, 200
    else:
        return {'status': 'unhealthy', 'details': checks}, 503
```

This endpoint performs critical dependency checks and returns either a 200 (healthy) or 503 (unhealthy) response. The load balancer sees the status code and acts accordingly. By keeping this endpoint simple and fast—executing in milliseconds rather than seconds—you ensure that health checks don't become a bottleneck and that failures are detected quickly.

The key principle is that your health endpoint should return an error status code (typically 503 Service Unavailable or 500 Internal Server Error) if any critical dependency is unavailable. If your application depends on a database and that connection fails, your health check should fail. This is where health checks transcend simple connectivity testing and become true indicators of application readiness.

However, be cautious about which dependencies you include in your health check. If your health endpoint depends on an external third-party API, and that API is temporarily slow or unavailable, your health check will fail even though your application could still serve cached data. You need to balance strictness with pragmatism, including only the dependencies that truly prevent you from serving traffic.

### Avoiding Cold Start Failures

Imagine this scenario: you deploy a new version of your application. The instance starts, runs initialization code, and connects to the database. During this startup window—which might take 30 seconds, a minute, or longer—the application isn't yet ready to serve traffic. But the load balancer, unaware of this startup phase, begins sending health check requests immediately.

The health check fails because the application isn't ready. The load balancer marks the instance unhealthy. By the time the application finishes initializing and becomes ready, the load balancer has already started a replacement instance. Now you have cascading failures, additional latency, and a poor user experience.

The solution is to understand and leverage the healthy threshold. If you set a healthy threshold of 3 and health checks run every 30 seconds, it will take 90 seconds of continuous successful responses before a newly launched instance enters the rotation. This grace period allows your application to initialize and become truly ready.

The tradeoff is longer time to recovery during normal scenarios. A crashed instance will also take 90 seconds to be replaced. To balance this, many teams implement the following strategy:

Use a relatively low unhealthy threshold (2) so that instances are removed quickly if they fail health checks. Use a moderate healthy threshold (3-4) to provide enough grace time for startups without making recovery unacceptably slow. Match your health check interval to your application's startup time. If startup takes 30 seconds, running health checks every 5 seconds wastes resources; 15-30 second intervals are more appropriate.

Additionally, structure your application startup to initialize critical components before the application starts accepting traffic. In many frameworks, you can implement a startup hook that connects to the database, loads configuration, and performs other critical operations before the HTTP server begins listening. This reduces the startup window and makes health checks meaningful sooner.

### Dependency Cascading and the Health Check Boundary

A subtle but critical issue emerges when your health check endpoint depends on too many external systems. Suppose your health endpoint checks the database, cache, message queue, and external payment API. Now, if any of those systems experiences a blip, your health check fails, your instance is marked unhealthy, and you lose capacity.

In the worst case, if all instances make the same call to a failing dependency during their health checks, and that dependency is overloaded, the health checks themselves add load to the already-struggling dependency, exacerbating the problem.

The solution is to carefully choose which dependencies belong in your health check. Ask yourself: can my application meaningfully serve traffic without this dependency right now? If your cache is down but you can serve requests (slower, but functional), cache shouldn't be in the health check. If your database is down and you literally cannot process any requests, the database definitely belongs in the health check.

A practical boundary is this: include dependencies that prevent your application from serving its core function. Exclude dependencies that degrade performance but don't eliminate functionality.

Additionally, implement short timeouts and circuit breakers within your health endpoint. If your health check tries to connect to the database but the connection hangs, and you have a 5-second health check timeout, your endpoint will hit the timeout and return 503. But that's the load balancer's timeout, not your application's. Inside your health endpoint, set timeouts on individual checks to ensure they complete quickly.

```python
@app.get('/health')
def health_check():
    try:
        db_ok = check_database_connection(timeout=1.0)
    except Timeout:
        db_ok = False
    
    try:
        cache_ok = check_cache_connection(timeout=0.5)
    except Timeout:
        cache_ok = False
    
    if db_ok and cache_ok:
        return {'status': 'healthy'}, 200
    else:
        return {'status': 'unhealthy'}, 503
```

By implementing sub-second timeouts within your health checks, you ensure that even if a dependency is slow, your health endpoint completes quickly and the load balancer can make rapid decisions.

### EC2 Status Checks Versus ELB Target Health

A common source of confusion is the relationship between EC2 status checks and ELB target health. They're different layers of health monitoring and they work independently.

**EC2 status checks** monitor the instance itself and the underlying hypervisor. They check whether the instance is running, whether the hypervisor detects problems, and whether the instance has network connectivity at the infrastructure level. If an EC2 status check fails, the instance is completely unavailable at the infrastructure level, and AWS might automatically restart it. You can view EC2 status checks in the EC2 console.

**ELB target health** is determined by the load balancer's health check probe. It specifically checks whether your application is running and responding correctly. Even if EC2 status checks pass, if your application has crashed or is unresponsive, the ELB target will be marked unhealthy. Conversely, an instance might temporarily fail EC2 status checks and become unavailable, and the load balancer will mark it unhealthy—but for a different reason.

When you're debugging why instances are being removed from your load balancer, you need to check both places. Visit the EC2 console to see if EC2 status checks are passing. Then visit the load balancer target group details to see if your application's health checks are passing. They're two separate indicators of health, and addressing an issue requires understanding which one is failing.

### Choosing the Right Timeout and Interval

The timeout and interval parameters are intimately connected and should be chosen based on your application's characteristics.

**Interval** should be as short as possible while avoiding excessive overhead. 30 seconds is a reasonable default. If your application is highly critical and you want sub-minute failure detection, go down to 15 seconds, but know that this multiplies the number of health check requests by two. For non-critical services, 60 seconds is acceptable. The interval should also account for your application's startup time. If startup takes 45 seconds and your interval is 5 seconds, you'll run 9 failed health checks before the application is ready, which is wasteful.

**Timeout** should be longer than the expected response time of your health endpoint. If your health endpoint typically responds in 100ms, a 1-second timeout is appropriate. If your endpoint performs multiple dependency checks and typically takes 500ms, set the timeout to 2-3 seconds. A timeout that's too short causes transient delays to fail health checks. A timeout that's too long delays failure detection. Most applications are well-served by a 2-5 second timeout.

The relationship between interval and timeout matters more than their absolute values. If you have a 30-second interval and a 30-second timeout, you've essentially set a minimum gap of 30 seconds between health checks, because each check might take up to 30 seconds. That's too much. A rule of thumb: ensure that `timeout * 2 <= interval`. If your timeout is 5 seconds, your interval should be at least 10 seconds, ideally 15-30 seconds.

### Practical Configuration Examples

Let's work through a concrete example. You're running a Node.js API server on EC2 instances behind an ALB. The application handles HTTPS traffic and has a dedicated `/api/health` endpoint.

Here's an effective ALB target group health check configuration:

- Protocol: HTTPS
- Port: 443
- Path: /api/health
- Interval: 30 seconds
- Timeout: 3 seconds
- Healthy threshold: 2
- Unhealthy threshold: 2
- Success codes: 200

This configuration balances responsiveness, reliability, and overhead. The health check runs every 30 seconds, which is frequent enough to detect failures within a minute but not so frequent as to create excessive load. The 3-second timeout allows for some network latency and simple application logic. The healthy and unhealthy thresholds of 2 mean that an instance needs 2 consecutive successful checks before entering rotation and 2 consecutive failures before leaving—this prevents flapping from transient network hiccups.

Now consider a different scenario: you're running a high-throughput NLB for a financial services application where latency is critical. You're using TCP health checks on port 8000.

- Protocol: TCP
- Port: 8000
- Interval: 15 seconds
- Timeout: 1 second
- Healthy threshold: 2
- Unhealthy threshold: 1

Here, the shorter interval (15 seconds) provides faster failure detection, which is crucial for high-availability systems. TCP health checks are minimal overhead, which is important when you have thousands of targets. The unhealthy threshold of 1 means a single failed health check removes the instance, providing the fastest recovery from failures. This is appropriate for systems where losing a single instance to a false positive is less costly than the latency of a slower health check.

### When Health Checks Conflict With Your Application

Sometimes, the most challenging health check problems arise when your health endpoint itself becomes a performance bottleneck or behaves unexpectedly.

If you've implemented a health endpoint that checks too many dependencies, runs slowly, or makes blocking I/O calls, the health checks themselves might be consuming enough resources to impact your application's ability to serve traffic. Every instance running 30 health checks per minute might not sound like much, but if each health check takes 2 seconds and blocks a thread, you've lost resource capacity.

The solution is to implement health checks asynchronously. Many frameworks support this through background health check handlers that run independently from the request thread pool, ensuring that health checks don't starve your application of processing capacity.

Another conflict arises when your application processes requests in a batch-oriented way. For example, a data processing application might accept traffic normally during business hours but spend evenings and weekends processing large batches. If your health check fails to account for this state, the load balancer might remove your instance right when it's supposed to be processing a batch job.

The answer is to make your health check context-aware. Your endpoint might return a healthy status even during batch processing because the application is functioning as designed, even if it's not accepting external requests right now. In some cases, you might deliberately return an unhealthy status during maintenance windows to drain traffic and allow in-place updates without impacting users.

### Monitoring and Observing Health Check Behavior

The best-configured health check is one you actively observe. Most teams pay attention to health checks only when something goes wrong, but proactive monitoring prevents those failures.

Use CloudWatch to monitor your target health. The `TargetResponseTime` metric shows how quickly your targets respond to health checks. A sudden increase might indicate that your application is becoming overloaded or that a dependency is slow. The `UnHealthyHostCount` metric shows how many targets are marked unhealthy at any given time. A gradual increase might signal an application issue that's spreading across your fleet.

Set up alarms for unexpected changes in these metrics. If your UnHealthyHostCount suddenly jumps from 0 to 3, that warrants investigation. Similarly, if your TargetResponseTime increases from 50ms to 2 seconds, something has changed in your application or infrastructure.

Additionally, log health check requests in your application. Many teams ignore these because they're high-volume, but sampling and analyzing health check logs reveals patterns. Are certain instances consistently slower on health checks? Do health checks fail at specific times? Do health check failures correlate with increased error rates on your primary traffic?

### Conclusion

Health checks are a foundational element of reliable load-balanced infrastructure, yet they're often neglected or misconfigured. By understanding the mechanics of health check parameters, designing intelligent health endpoints that truly indicate application readiness, and carefully balancing the tradeoff between failure detection speed and stability, you build systems that gracefully handle failure and degrade into recovery.

The key takeaway is this: health checks aren't just infrastructure plumbing—they're a contract between your application and your load balancer. Your application promises to respond truthfully about its health status, and the load balancer promises to respect that truth by routing traffic accordingly. Keep that contract honest, keep your health endpoints simple and fast, and your infrastructure will reward you with resilience.
