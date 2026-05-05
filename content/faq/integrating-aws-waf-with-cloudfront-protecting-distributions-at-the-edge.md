---
title: "Integrating AWS WAF with CloudFront: Protecting Distributions at the Edge"
---

## Integrating AWS WAF with CloudFront: Protecting Distributions at the Edge

When you deploy an application on AWS, the question of security moves quickly from theoretical concern to operational necessity. Your CloudFront distribution is sitting at the edge of your network, serving content globally, and it's becoming an attractive target the moment it goes live. This is where AWS Web Application Firewall—WAF—becomes an essential layer in your defense strategy. Unlike security measures buried deep in your infrastructure, WAF at the edge stops malicious traffic before it even reaches your origin servers.

In this guide, we'll explore how to integrate AWS WAF with CloudFront distributions, understand the architectural differences between WAF implementations across AWS services, and work through practical configurations that protect your applications against common web-based attacks. Whether you're defending against OWASP Top 10 vulnerabilities, implementing rate limiting to mitigate DDoS attacks, or enforcing geographical access controls, you'll have a clear roadmap for building a defense-in-depth strategy that leverages the AWS edge infrastructure.

### Understanding AWS WAF in the CloudFront Context

AWS WAF is a web application firewall that sits between your users and your application, inspecting HTTP and HTTPS requests in real time. When you attach WAF to CloudFront, you're creating a security perimeter at the content delivery network level—meaning every request flowing through your distribution passes through your WAF rules before reaching your origin server.

The key difference between CloudFront-based WAF and its regional counterparts lies in geography and purpose. CloudFront WAF Web Access Control Lists (Web ACLs) must be created in the `us-east-1` region, regardless of where your actual content originates. This is because CloudFront is a global service with edge locations worldwide, and AWS centralizes WAF management for it in that single region. By contrast, WAF for Application Load Balancers, API Gateway, or AppSync are regional resources—you create them in the same region as your target service.

This architectural decision has important implications. A Web ACL attached to your CloudFront distribution instantly protects all edge locations globally. There's no propagation delay, no regional considerations to manage. You define your rules once in us-east-1, and they enforce consistently across your entire global distribution network.

### Creating and Attaching WAF Web ACLs to CloudFront

Before you can protect a CloudFront distribution, you need a Web ACL. Think of a Web ACL as a container for your security rules and their associated actions. Let's walk through the process.

First, navigate to the WAF console in the `us-east-1` region—this is non-negotiable for CloudFront protection. If you're accustomed to working in other regions, this is one area where AWS forces you to think globally.

When creating a new Web ACL, you'll define its scope. Set it to "CloudFront distributions" rather than regional resources. This is where many developers stumble; selecting the wrong scope means your Web ACL won't be available when you try to attach it to a distribution.

Once your Web ACL exists, attaching it to a distribution is straightforward. In the CloudFront console, select your distribution and edit it. In the "Web Application Firewall (WAF)" section, you'll find a dropdown listing all Web ACLs in us-east-1. Select the one you created, update the distribution, and within moments, your rules are live across all edge locations.

The beauty of this approach is simplicity at scale. You're not managing WAF across dozens of regional deployments or dealing with replication lag. One Web ACL. One deployment. Global enforcement.

### AWS Managed Rules vs. Custom Rule Creation

Building effective WAF rules from scratch is challenging because it requires deep knowledge of web vulnerabilities, attack patterns, and the legitimate traffic your application generates. This is where AWS Managed Rules come into play.

AWS Managed Rules are pre-built, maintained rule groups developed by AWS security experts and updated regularly as new threats emerge. These rules are battle-tested across thousands of AWS deployments and incorporate patterns from real-world attacks. Rather than reinventing the wheel, you can leverage these as a foundation for your security posture.

The most commonly used managed rule group is the Core Rule Set, which implements protection against the OWASP Top 10—the ten most critical web security risks as identified by the Open Web Application Security Project. The OWASP Top 10 includes vulnerabilities like SQL injection, cross-site scripting (XSS), broken authentication, and insecure deserialization. By adding the Core Rule Set to your Web ACL, you're immediately defending against these pervasive attack vectors.

Beyond the Core Rule Set, AWS provides additional managed rule groups targeting specific threats. There's the Known Bad Inputs rule group, which blocks traffic matching known malicious patterns. The SQL Injection Protection rule group focuses specifically on SQL injection attempts. The Linux Operating System rule group and Windows Operating System rule group detect OS-level attacks. The PHP Application rule group and WordPress Application rule groups protect specific application stacks.

When you add a managed rule group to your Web ACL, you configure how it behaves. The standard approach is to set it to "Block" mode, meaning requests matching the rules are rejected. However, during initial deployment or testing, many teams use "Count" mode, which logs matching requests without blocking them. This lets you understand how many legitimate requests might be caught before you enable enforcement.

Here's a practical scenario: you've deployed a new e-commerce platform on CloudFront. You add the Core Rule Set in Count mode for a few days, monitoring the CloudWatch metrics to see how many requests are being flagged. If you notice legitimate traffic from your mobile app is being blocked—perhaps because it's sending data in a format the XSS protection rule considers suspicious—you can fine-tune the rule behavior or create an exception before enabling Block mode.

### Building Custom Rules: Rate-Based Protection and DDoS Mitigation

While managed rules handle known vulnerabilities, custom rules let you enforce business logic specific to your application. One of the most powerful custom rule types is the rate-based rule.

Rate-based rules count HTTP requests from individual IP addresses over a five-minute window. When an IP address exceeds your threshold, WAF blocks subsequent requests from that IP. This is your primary defense against DDoS attacks and brute-force attempts.

Consider a login endpoint that typically receives 10 requests per minute from legitimate users but attackers are hammering it with 1,000 requests per second from a single IP. Setting a rate limit of 500 requests per five minutes would allow normal usage while blocking the attacker. The beauty is that the limit resets every five minutes, so even if an IP is blocked, it gets another chance after the window closes.

The math here matters. A five-minute window and a threshold of 500 requests translates to roughly 1.7 requests per second on average. If your legitimate traffic occasionally spikes to 10 requests per second for a few seconds, you might catch innocent users. Testing and tuning are essential.

You can also create rate-based rules that apply only to specific URI paths or request headers, narrowing the scope to the endpoints that actually need protection. A rule protecting your `/api/login` endpoint doesn't need to apply to your static assets served from `/images/` or `/css/`.

Here's another practical angle: rate-based rules are especially valuable because they're stateful at the IP level. Unlike simple request-counting mechanisms that might reset unexpectedly, WAF maintains IP state across requests. An attacker can't bypass the rule by dropping the connection and reconnecting—the IP's request count is still tracked.

### IP Sets: Allowlists and Blocklists at the Edge

Sometimes you need blanket allow or deny policies based on IP addresses. Maybe you have internal APIs that should only be accessible from your office network, or perhaps you've identified a range of IPs known to launch attacks and want to deny them immediately.

IP sets are reusable collections of IP addresses or CIDR blocks that you reference in WAF rules. You can create an IP set containing, for example, your office's public IP addresses, then create a WAF rule that blocks everything except traffic from those IPs. This is an allowlist pattern—you're explicitly permitting trusted sources.

Conversely, you might maintain a blocklist of known attacker IPs or ranges. When threat intelligence feeds identify malicious IP ranges, you add them to the IP set, and WAF immediately blocks traffic from those sources across all distributions using that set.

IP sets are mutable—you can add or remove addresses without modifying your WAF rules. This is particularly useful if you're integrating with threat intelligence platforms or automated systems that discover and add malicious IPs in real time. Your WAF rule references the set, not a static list, so updates to the set take effect immediately.

A practical consideration: be cautious with IP-based allowlisting for customer-facing services. If you restrict to a specific IP range, legitimate users on different networks can't access your service. Allowlisting makes more sense for internal APIs or administrative endpoints. For public services, blocklists are generally less disruptive because they only prevent known bad actors, not unknown good ones.

### Geographical Restrictions: Geo-Match Rules vs. CloudFront Native Options

WAF includes geo-match rules that allow or block traffic based on the geographic origin of the request. This is useful if your business operates in specific countries or if you want to deny service from regions where you've identified coordinated attacks.

A common use case is compliance-driven geo-blocking. If your application stores personal data of European citizens, you might restrict access to users within the EU to comply with data residency requirements. Conversely, if your service isn't available in certain countries due to licensing or regulatory restrictions, geo-match rules can enforce those boundaries.

It's worth noting that CloudFront has native geo-restriction capabilities as well. In the distribution settings, you can specify countries to allow or deny, and CloudFront blocks traffic at the edge without even consulting WAF. So why would you use geo-match rules in WAF instead?

The distinction comes down to behavior and flexibility. CloudFront's native geo-restriction returns an error response—typically a 403 Forbidden—to blocked traffic. WAF geo-match rules can also block traffic, but they're integrated into your Web ACL logic, allowing you to combine them with other conditions. Maybe you want to allow traffic from any country except those specifically blocked, but you also want to allow VPN traffic (typically harder to geolocate) from anywhere if it comes with a specific authorization header. That nuanced logic lives in WAF rules, not CloudFront's basic geo-restriction.

Additionally, WAF geo-match rules provide better logging and metrics. You can see exactly how many requests from each country were blocked, which feeds into threat analysis and business intelligence.

### Logging WAF Events for Visibility and Analysis

Protecting your application is only half the battle. The other half is understanding what's happening. WAF logging captures detailed information about every request matching your rules, giving you visibility into attack patterns and false positives.

WAF can log to two primary destinations: Amazon S3 and Amazon Kinesis Data Firehose. Each has different strengths.

S3 logging is straightforward and cost-effective for long-term storage and analysis. WAF writes logs as compressed JSON files to your specified S3 bucket, typically in batches every five minutes. You can then query these logs using Amazon Athena, run them through Splunk or other SIEM platforms, or perform custom analysis with AWS Lambda. S3's lifecycle policies let you automatically archive logs to Glacier after a retention period, keeping costs down while maintaining audit trails.

Kinesis Data Firehose is better for real-time analysis and alerting. Firehose automatically delivers log events to multiple destinations—S3, Redshift, Datadog, Splunk, or custom HTTP endpoints—with minimal latency. If you need immediate alerting when attacks spike or when specific patterns are detected, Firehose lets you process logs in near real-time, potentially triggering automated responses.

Logs themselves contain rich detail: the timestamp, the request's source IP, the URI, HTTP method, user agent, matched rule names, and the action taken (Block, Count, or Allow). For blocked requests, you can see which specific managed rule matched and why. This is invaluable for debugging false positives—if legitimate traffic is being blocked, the logs tell you exactly which rule is responsible.

Here's a practical workflow: enable logging to S3, then periodically review logs to identify patterns. If you notice a specific rule is blocking significant legitimate traffic, you can adjust the rule, add exceptions for certain headers or parameters, or move the rule to Count mode temporarily. Real-time logging to Firehose is useful during active incident response or if you're running a security operations center monitoring live threats.

### Designing a Defense-in-Depth Strategy with CloudFront WAF

Attaching WAF to CloudFront is powerful, but it's one layer in a comprehensive security architecture. Thinking about defense-in-depth means understanding how WAF fits into your broader strategy.

At the outermost edge, CloudFront WAF inspects requests globally. This blocks obvious attacks and bad actors before they consume any origin bandwidth. A successful DDoS attack now requires overwhelming the distributed CloudFront edge network rather than your origin—a much harder problem for attackers.

Behind CloudFront, you might have an Application Load Balancer protecting your origin servers. You can attach a regional WAF to that ALB, adding another layer of inspection. This regional WAF might have different rules tailored to your internal infrastructure—perhaps more permissive to account for legitimate internal traffic patterns or stricter about certain headers that your origin cares about.

Within your application code, input validation and output encoding prevent injection attacks and XSS. WAF isn't a replacement for secure coding practices; it's a complementary layer that catches things code-level defenses miss.

This layered approach means that if an attacker bypasses CloudFront WAF (unlikely but theoretically possible with a false negative in a rule), your ALB WAF might catch it. If both are bypassed, your application-level defenses activate. Each layer is imperfect, but together they form a resilient system.

### Common Configuration Pitfalls and Best Practices

One frequent mistake is deploying WAF with overly aggressive rules and then ignoring the false positives. A WAF blocking 5% of legitimate traffic is technically protecting your application—from your own users. Before enabling Block mode on any rule, especially custom ones, run it in Count mode for a representative sample of real traffic. Typically, a few days of traffic is sufficient to establish a baseline.

Another pitfall is creating rules that are too specific. A rule that blocks requests containing the string "UNION SELECT"—a SQL injection pattern—might prevent legitimate users from searching for information about union benefits or database selections. Overly specific rules also require constant updating as attackers evolve their techniques. Managed rules solve this by being maintained by AWS experts who update them as new attacks emerge.

The opposite problem—rules too broad—is equally problematic. A rule blocking all POST requests would certainly prevent SQL injection attacks on login forms, but it would also break every form submission in your application. Balance specificity and coverage.

Regarding IP sets and allowlisting, document the business rationale. If you're allowlisting your corporate office IP, ensure that when the office switches ISPs and gets a new IP range, someone updates the IP set. Automated systems are better—if you have a process that feeds corporate IP ranges into your IP set, you avoid manual updates and their inevitable inconsistencies.

For rate-based rules, monitor not just the number of blocked requests but the distribution of source IPs. If thousands of IPs are each making a few requests, you might be seeing distributed traffic that's legitimate but coincidentally high-volume. Conversely, if a single IP is being rate-limited repeatedly, you've likely identified an attacker worth investigating further.

### Testing and Iteration

WAF configuration isn't a set-and-forget deployment. As your application evolves, as you discover new attack patterns, or as you identify false positives in production, you'll iterate on your rules.

When deploying new rules, the standard practice is to deploy them in Count mode first. Create a CloudWatch dashboard that visualizes the number of requests matching each rule. Let it run for a few days covering different parts of your traffic pattern—weekdays, weekends, traffic spikes, quiet periods. This tells you how many real users would be affected if you enabled Block mode.

If the count is near zero, you're probably safe to enable Block mode. If it's significant, investigate. Are legitimate requests being flagged? Does a specific user agent, geographic region, or parameter value account for most of the matches? You might need to adjust the rule logic or add an exception.

Document your rules and their intent. When you have ten custom rules and five managed rule groups, each with multiple rules, documentation becomes invaluable for future maintenance. A comment noting "rate limit on /api/login to prevent brute force; threshold of 500/5min from tuning in June 2024" tells your future self why the rule exists and when it was last validated.

### Monitoring and Alerting

CloudWatch integration is automatic—WAF publishes metrics like AllowedRequests, BlockedRequests, CountedRequests, and metrics specific to each rule. Set up alarms for unexpected patterns. If BlockedRequests suddenly spike 10x, that's worth investigating—either an active attack or a false positive cascade.

WAF's sampled requests feature lets you inspect individual requests in the console. For any rule, you can see a sample of requests matching it, including headers, cookies, and body data (up to 8KB). This is invaluable for debugging. If a rule is blocking unexpected traffic, looking at actual requests helps you understand why.

Integration with GuardDuty and Security Hub provides higher-level threat intelligence. These services analyze WAF events along with other security findings to identify coordinated attacks or patterns you might miss in isolation.

### Conclusion

Integrating AWS WAF with CloudFront represents a best-practice approach to defending applications at the edge of the AWS global network. By creating Web ACLs in us-east-1 and attaching them to your distributions, you gain immediate, globally-distributed protection against web-based attacks without the complexity of managing regional WAF instances across multiple services.

The combination of managed rule groups like the Core Rule Set, custom rules for rate limiting and IP-based controls, and comprehensive logging creates a defense-in-depth strategy that reduces attack surface while maintaining visibility into your security posture. The key to success lies in careful configuration, iterative testing in Count mode before enforcement, and ongoing monitoring as your application and threat landscape evolve.

As you design security for your AWS infrastructure, remember that WAF at the edge is just one layer. It works best as part of a comprehensive strategy that includes application-level security, network-level controls on your ALBs or API Gateways, and secure coding practices. Together, these layers transform security from a single point of failure into a resilient, defense-in-depth architecture that protects your applications and users against a constantly evolving threat landscape.
