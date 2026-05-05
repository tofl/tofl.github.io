---
title: "ALB vs NLB vs Gateway Load Balancer: Choosing the Right ELB Type"
---

## ALB vs NLB vs Gateway Load Balancer: Choosing the Right ELB Type

When you're building applications on AWS, one of the first architectural decisions you'll face is how to distribute incoming traffic across your infrastructure. AWS Elastic Load Balancing (ELB) offers three distinct load balancer types, each optimized for different use cases and operating at different layers of the network stack. Understanding the differences between Application Load Balancer (ALB), Network Load Balancer (NLB), and Gateway Load Balancer (GWLB) is crucial for designing systems that are both performant and cost-effective.

The wrong choice here can lead to unnecessary expenses, poor application performance, or an architecture that struggles to scale. The right choice, however, creates a foundation that handles your traffic elegantly and aligns perfectly with your application's needs. Let's explore what makes each load balancer type unique and how to match them to your workloads.

### Understanding the OSI Model and Load Balancer Operation

Before diving into the specifics of each load balancer type, it's helpful to understand where each one operates within the OSI (Open Systems Interconnection) model. This seven-layer framework describes how network communication works, and load balancers sit at different layers depending on their purpose.

The **Application Load Balancer** operates at **Layer 7** (the Application layer), which is the highest level in the OSI model. This means ALBs make routing decisions based on application-level data like HTTP headers, hostnames, URL paths, and even hostnames. Think of it like a smart receptionist who not only answers the phone but understands the conversation and routes callers to exactly the right department.

The **Network Load Balancer** operates at **Layer 4** (the Transport layer), handling TCP and UDP traffic. At this level, the load balancer can see connection information like source IP, destination IP, port numbers, and protocols, but it doesn't need to understand the application-level content. This makes it incredibly fast and capable of handling millions of requests per second.

The **Gateway Load Balancer** operates at **Layer 3** (the Network layer), dealing with IP packets. It's specifically designed to work with network appliances and virtual appliances, acting as a transparent entry and exit point for traffic flowing to third-party security or networking applications.

### Application Load Balancer: Intelligence at the Application Layer

The Application Load Balancer is the most versatile of the three and the go-to choice for most modern web applications. Because it operates at Layer 7, it understands HTTP and HTTPS protocols deeply, allowing it to make sophisticated routing decisions based on application-level characteristics.

With an ALB, you can route traffic based on hostname, path, HTTP headers, HTTP methods, query parameters, and even source IP. For example, imagine you're running a multi-tenant SaaS platform. You could use a single ALB to route requests from different customers to different backend services based on the hostname in the request. Requests to `customer-a.example.com` go to one set of targets, while requests to `customer-b.example.com` go to another, all through one load balancer.

Path-based routing is another powerful feature. You might route all requests starting with `/api/` to your microservices fleet and requests starting with `/static/` to a content delivery system, all with a single ALB and target groups.

ALBs support HTTP, HTTPS, HTTP/2, WebSocket, and gRPC protocols. The WebSocket and gRPC support is particularly valuable for modern applications that need persistent connections or efficient bidirectional communication. If your application uses real-time features or needs low-latency messaging, an ALB can handle this elegantly without requiring separate load balancers.

When it comes to target types, ALBs are flexible. You can register EC2 instances, IP addresses (which is useful for on-premises servers or containers running outside ECS), and AWS Lambda functions as targets. This flexibility makes ALBs suitable for virtually any application architecture.

Performance-wise, ALBs handle hundreds of thousands of requests per second, which is sufficient for most web applications. They're not the absolute fastest option available, but the trade-off for intelligent, application-aware routing is well worth it in most scenarios.

From a pricing perspective, ALBs charge based on the number of load balancer capacity units (LCUs) consumed. You pay for new connections, active connections, processed bytes, and rule evaluations. This means your costs scale with actual usage, though the Layer 7 processing does add a small overhead compared to simpler load balancers.

### Network Load Balancer: Extreme Performance and Extreme Throughput

If your application needs to handle millions of requests per second or requires ultra-low latency, the Network Load Balancer is your answer. Operating at Layer 4, the NLB doesn't need to understand application protocols—it simply routes based on IP protocol data, making it capable of handling millions of concurrent connections with sub-millisecond latencies.

NLBs excel at handling non-HTTP protocols like TCP, UDP, and TLS. This makes them ideal for gaming servers, IoT applications, real-time communications, DNS services, and any scenario where you need raw speed and can't afford the latency introduced by application-layer inspection.

Consider a real-time multiplayer game backend. Players expect sub-100 millisecond latency when sending commands to game servers. An NLB, with its ultra-low latency and ability to handle millions of UDP packets per second, is the natural choice here. An ALB would introduce additional processing overhead that could push latency into unacceptable territory.

Similarly, for IoT platforms collecting data from millions of devices sending telemetry over MQTT (which runs over TCP/TLS), an NLB provides the throughput and consistency needed to handle that volume without performance degradation.

One unique advantage of Network Load Balancers is their support for static IP addresses. This is crucial when clients need to know the exact IP addresses they're connecting to—for instance, in network appliance configurations or when clients maintain strict IP whitelists. An NLB can have multiple static IPs (one per availability zone), and you can even associate Elastic IPs with it for additional flexibility.

For target types, NLBs support EC2 instances, IP addresses, and Lambda functions. The IP address option is particularly valuable here since it allows NLBs to load balance traffic across on-premises servers or resources in other VPCs.

The connection draining behavior of NLBs is also worth noting. When you update targets or perform maintenance, NLBs can gracefully close connections over a configurable period, ensuring in-flight requests complete successfully before the connection fully terminates.

NLB pricing is similar to ALB pricing in structure (based on LCUs), but the actual costs depend on processed bytes and connections rather than rule evaluations. For applications with massive throughput, the per-byte cost can become significant, but it's often lower than ALB costs for equivalent capacity since no Layer 7 processing is occurring.

### Gateway Load Balancer: Transparent Traffic Inspection

The Gateway Load Balancer is the specialized member of the load balancer family, designed specifically for a different problem: routing traffic through third-party virtual appliances and network services while maintaining transparency.

Think of a scenario where you need to inspect all traffic flowing through your VPC for security purposes. You might have licensed security appliances from a third-party vendor that can do deep packet inspection, intrusion detection, or compliance monitoring. You don't want to change your application architecture or network design just to insert this appliance—you want it to sit invisibly in the traffic path.

This is where GWLB shines. Operating at Layer 3, it uses GENEVE (Generic Network Virtualization Encapsulation) protocol to encapsulate traffic and send it to your network appliance targets. The appliance inspects the traffic and returns it to the GWLB, which then forwards it to its final destination. This happens transparently—your applications don't know the inspection is happening, and the inspection appliance doesn't need custom integration with your environment.

GWLBs are commonly used for security appliances, deep packet inspection tools, traffic analytics platforms, and any network service that needs to inspect or modify traffic in flight. If you're building a security-focused infrastructure where all traffic must pass through inspection before reaching applications, GWLB provides an elegant architecture.

The target types for GWLB are EC2 instances and IP addresses, typically pointing to your virtualized network appliances. The appliances must support the GENEVE protocol to work properly.

One important characteristic of GWLB is that it maintains connection affinity. Once traffic from a source begins flowing through a particular appliance instance, all packets from that connection stay with the same appliance. This ensures that stateful appliances see a coherent view of the traffic flow.

GWLBs are priced similarly to NLBs and ALBs, based on LCU consumption (new connections, active connections, and processed bytes). The cost depends heavily on how much traffic flows through your inspection appliances.

### Comparing Protocols and Connection Handling

Each load balancer type supports a different set of protocols, which directly influences where it can be used. Understanding these differences is essential for matching the right load balancer to your requirements.

The **Application Load Balancer** is built around HTTP and HTTPS. It fully understands these protocols and can make routing decisions based on HTTP semantics. Beyond standard HTTP, ALBs also support HTTP/2 for applications that want to take advantage of multiplexing and header compression. WebSocket support allows for persistent, bidirectional communication—essential for real-time features like live notifications or chat applications. gRPC, the modern RPC framework increasingly popular for microservices, is also natively supported by ALBs.

The **Network Load Balancer** operates at the protocol-agnostic Layer 4, supporting TCP and UDP traffic. This broad support means it can handle any protocol built on top of TCP or UDP. You can run HTTP through an NLB, but it won't understand HTTP headers—it just sees TCP packets. Similarly, for HTTPS/TLS traffic, NLBs can forward encrypted connections without decrypting them. This is actually an advantage in some scenarios because the encryption remains end-to-end with no decryption at the load balancer.

The **Gateway Load Balancer** works at Layer 3 with IP packets and uses GENEVE for encapsulation. It's not meant for direct application traffic routing in the traditional sense—it's specifically for chaining traffic through appliances.

### Performance Characteristics and Throughput

Performance varies significantly across the three load balancer types, and understanding these differences helps you avoid over-provisioning or under-provisioning.

The **Application Load Balancer** can handle hundreds of thousands of requests per second. For most web applications—whether you're running a SaaS platform, content site, or web API—this is more than sufficient. ALBs are incredibly responsive and can handle spikes in traffic effectively.

The **Network Load Balancer** operates in an entirely different performance tier. It can handle millions of requests per second with sub-millisecond latency. This extreme performance comes from its simplified Layer 4 processing—there's no application protocol parsing or header analysis happening, just raw packet forwarding. If you have an application sending millions of events per second across the network, only an NLB can handle that volume without saturation.

The **Gateway Load Balancer** is designed for throughput in a different context—it's measured by how much traffic it can push through its inspection pipeline while maintaining acceptable latency. Performance is less often a concern here since appliance throughput is usually the limiting factor, not the load balancer itself.

### Static IPs and Network Configuration

A practical but important difference is static IP support. Many enterprise environments and network appliances require knowing the exact IP addresses of their load balancers in advance—perhaps for whitelisting, DNS configuration, or appliance integration.

**Network Load Balancers** natively support Elastic IP addresses, giving you one static public IP per availability zone. You can directly associate Elastic IPs with an NLB's network interfaces.

**Application Load Balancers** do not support Elastic IPs. They have static DNS names and managed IP addresses that can change, but you cannot assign Elastic IPs directly. If you absolutely need static IPs for an ALB, you'd need to place it behind another NLB (which seems counterintuitive but is sometimes done in specific enterprise scenarios).

**Gateway Load Balancers** also support Elastic IPs for scenarios where static networking is required for appliance integration.

### Making Your Decision: A Practical Framework

Choosing between these three load balancers often becomes clearer when you consider your specific requirements. Let's walk through some common scenarios.

**For a typical web application**, start with the Application Load Balancer. You're likely building a REST API, serving web pages, or running microservices that need intelligent routing based on hostnames or paths. ALB's support for HTTP/HTTPS, WebSocket, and gRPC covers the vast majority of modern application needs. Unless you have specific performance requirements measured in millions of requests per second, ALB is the right choice. It's also the most cost-effective for standard web workloads.

**For high-performance, real-time applications**, consider the Network Load Balancer. Gaming backends, real-time financial trading systems, live video streaming platforms, and high-frequency IoT data collection all benefit from NLB's extreme throughput and ultra-low latency. If your application primarily uses TCP or UDP rather than HTTP, NLB is often the only viable choice. Similarly, if you need static IPs for your load balancer for security or integration reasons, NLB is your solution.

**For applications requiring network security or compliance inspection**, the Gateway Load Balancer is purpose-built. If your architecture includes licensed security appliances, next-generation firewalls that need to inspect all traffic, or compliance-mandated traffic monitoring, GWLB provides a transparent way to insert these appliances without architectural compromise.

**For applications requiring both web traffic and non-HTTP protocols**, you might need multiple load balancers. For example, an online gaming platform might use an ALB for its web portal (where players manage accounts, purchase items, etc.) and an NLB for the game servers themselves (which communicate via UDP). These run on different ports and target groups, so a single, simpler load balancer wouldn't suffice.

Let's consider a concrete example. Suppose you're building a mobile app backend that serves REST API requests from mobile clients, needs WebSocket support for push notifications, and handles real-time game data. You might initially think "this needs an NLB for performance," but the REST API with WebSocket perfectly describes an ALB use case. The ALB can handle thousands of concurrent connections per second, manage WebSocket upgrades, and route different API paths to different microservices. Unless your metrics show you're approaching ALB's limits, ALB is the economical and appropriate choice.

Conversely, if that game had 100,000 simultaneous players each sending position updates 10 times per second, you're looking at millions of packets per second. Now NLB becomes essential—ALB simply couldn't handle that throughput efficiently.

### Cost Considerations and Scaling

Understanding the cost structure of each load balancer helps you make economically sound decisions.

All three load balancer types use a similar pricing model based on LCUs (Load Balancer Capacity Units). An LCU represents the three-dimensional capacity measurement of your load balancer: new connections, active connections, and processed bytes. You pay for whichever dimension exceeds its threshold in a given hour.

For **ALBs**, the dimensions measure HTTP request rate, new connections, and active connections. For ALBs handling typical web traffic, costs are highly dependent on your rule complexity and the number of evaluations performed.

For **NLBs**, the dimensions measure new connections, active connections, and processed bytes. For NLBs handling very high throughput, the processed bytes dimension often becomes the primary cost driver. A service processing terabytes of data per hour will have higher NLB costs than an ALB handling the same number of HTTP requests.

For **GWLBs**, costs are similar, measured by new connections, active connections, and processed bytes flowing through the appliance chain.

When scaling applications, consider that all load balancers automatically scale horizontally—they distribute across availability zones and scale internally to handle traffic spikes. You don't manually provision capacity; AWS handles this automatically based on the traffic pattern.

### Advanced Routing and Feature Comparison

Each load balancer type offers different advanced features that matter for sophisticated applications.

**Application Load Balancers** excel at sophisticated routing logic. You can create rules that evaluate multiple conditions: specific hostnames AND HTTP methods AND custom HTTP headers. You can weight traffic across target groups to do canary deployments—sending 5% of traffic to a new version while monitoring it before shifting all traffic. You can redirect traffic (useful for HTTP to HTTPS migration), rewrite headers, authenticate requests, and log detailed information about each request.

**Network Load Balancers** focus on performance and reliability rather than sophisticated routing. You get connection tracking, connection draining, and target health checks, but not the complex rule-based routing of ALBs. The simplicity is partly why NLBs perform so well—less processing overhead.

**Gateway Load Balancers** provide appliance chaining capabilities and GENEVE encapsulation, features specifically designed for their use case of transparent traffic inspection and forwarding.

### Health Checks and Target Management

All three load balancer types support health checks, but they work slightly differently based on the load balancer's capabilities.

For **ALBs**, health checks can be HTTP-based, allowing you to specify exact URLs and expected HTTP status codes. You might configure an ALB to check `/health` on each target every 30 seconds, marking targets as unhealthy if they don't respond with HTTP 200.

For **NLBs**, health checks can be TCP-based (simply checking if a connection can be established) or HTTP-based. The TCP-based checks are lightweight and fast, making them ideal for extremely high-performance scenarios where you want minimal overhead from health checking.

**GWLBs** use health checks to ensure appliance instances are healthy and ready to receive traffic.

All three support connection draining, where existing connections to a target are allowed to complete gracefully over a configurable timeout period when the target is being deregistered.

### Hands-On Scenario: E-commerce Platform

Let's tie this together with a real-world scenario. Imagine you're architecting an e-commerce platform with multiple components:

The primary website where customers browse products and make purchases should use an **Application Load Balancer**. It can route requests to multiple backend services: `/products/*` routes to your product catalog microservice, `/api/orders/*` routes to your order processing service, and `/api/auth/*` routes to your authentication service. The ALB can handle HTTPS termination, WebSocket connections for live inventory updates, and support multiple hostname routing if you operate regional sites.

Your payment processing system, which handles thousands of financial transactions per second with strict latency requirements, might benefit from a **Network Load Balancer**. Payment systems often can't afford the additional latency of application-layer processing and might use a binary protocol rather than HTTP.

If regulatory compliance requires that all traffic pass through a security inspection appliance before reaching your backend, you might deploy a **Gateway Load Balancer** that chains traffic through a compliance-checking appliance before forwarding to your main infrastructure.

In this multi-load-balancer scenario, you've optimized each component for its specific requirements: intelligence and routing for the web layer, performance for payment processing, and compliance assurance for security.

### Conclusion

The three AWS load balancer types each excel in different contexts. The Application Load Balancer is the versatile choice for most modern web applications, offering intelligent Layer 7 routing for HTTP/HTTPS/WebSocket/gRPC traffic. The Network Load Balancer handles extreme performance requirements at Layer 4, supporting millions of requests per second for gaming, IoT, and real-time applications that need raw speed. The Gateway Load Balancer provides a transparent Layer 3 solution for routing traffic through network appliances and security inspection services.

Your decision should start with understanding your application's primary communication protocol and performance requirements. Do you need application-aware routing? Choose ALB. Do you need extreme throughput or static IPs? Choose NLB. Do you need to inspect traffic through appliances? Choose GWLB. Most production environments have a primary load balancer type that handles the majority of traffic, with specialized load balancers for specific components that have unique requirements.

As your applications mature and scale, revisit these decisions. What works for a startup might need optimization for a platform serving millions of users. But with a clear understanding of each load balancer's strengths, you'll make architectural decisions that scale elegantly and serve your applications efficiently.
