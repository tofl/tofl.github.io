---
title: "Elastic Beanstalk Domain Names and Custom Domains with HTTPS"
---

## Elastic Beanstalk Domain Names and Custom Domains with HTTPS

When you deploy an application to AWS Elastic Beanstalk, you get a working environment with an automatically generated domain name within minutes. But that default `environment-name.region.elasticbeanstalk.com` URL isn't exactly what you'd put on your business card or in your marketing materials. For production deployments, you'll need a custom domain and the security that HTTPS provides. This guide walks you through the complete process—from understanding Beanstalk's default naming, to configuring custom domains, provisioning SSL/TLS certificates, and ensuring everything works securely at scale.

### Understanding Elastic Beanstalk's Default Domain Name

Every Elastic Beanstalk environment gets a unique, automatically assigned CNAME that follows a predictable pattern. Your environment URL looks something like `myapp-prod.us-east-1.elasticbeanstalk.com`, where `myapp-prod` is your environment name and `us-east-1` is your AWS region. This domain is globally routable and points to your environment's load balancer—so your application is accessible immediately after deployment without any additional DNS configuration.

This default CNAME is genuinely useful during development and testing. It's stable for the lifetime of your environment, and you don't have to manage DNS records yourself. However, there are several reasons why you'll almost always want to set up a custom domain for production workloads. First, it gives your users a memorable, branded URL. Second, it decouples your domain from your AWS infrastructure—if you ever migrate to a different cloud provider or change your Beanstalk configuration, your users' bookmarks and DNS caches don't break. Third, and most importantly for security-conscious deployments, you can only issue SSL/TLS certificates for domains you control, not for AWS-owned domains.

### Setting Up a Custom Domain: Route 53 Alias Records vs. CNAME Records

Before you can use a custom domain with your Beanstalk environment, you need to own that domain and be able to manage its DNS records. Route 53, AWS's managed DNS service, is the natural choice if you're building entirely within AWS, but you can use any DNS provider. The key decision is how to connect your domain to your Beanstalk environment: Route 53 alias records or traditional CNAME records.

A CNAME (Canonical Name) record is the standard DNS mechanism for pointing one domain to another. If you own `example.com` and want traffic to go to your Beanstalk environment at `myapp-prod.us-east-1.elasticbeanstalk.com`, you'd create a CNAME record for `www.example.com` that points to that Beanstalk URL. The process is straightforward: add a CNAME record with the name `www` and the value `myapp-prod.us-east-1.elasticbeanstalk.com`. Your DNS provider will handle the rest.

However, Route 53 offers a more elegant solution through alias records. An alias is a Route 53 extension that allows you to point one AWS resource directly to another without going through the standard DNS hierarchy. Instead of creating a CNAME, you create an alias record that directly targets your Beanstalk environment's load balancer. Alias records have several advantages: they work at the zone apex (the bare domain name `example.com` itself, not just `www.example.com`), they don't incur Route 53 query charges, and they automatically update if the underlying load balancer's IP address changes.

To create a Route 53 alias record pointing to your Beanstalk environment, you'll navigate to the Route 53 console, select your hosted zone, and create an alias record with the appropriate target type. Rather than pasting in an IP address or domain name, you'll select "Alias to Elastic Beanstalk environment" from a dropdown, choose your region, and then select your environment. Route 53 handles the technical details of translating this to the correct load balancer endpoint.

For most AWS-native deployments, the Route 53 alias approach is preferable. It's cleaner, more reliable, and integrates seamlessly with other AWS services. However, if your domain is registered with a third-party provider and you prefer to keep all your DNS there, a CNAME record works fine—just remember you won't be able to use it at the zone apex without tricks like a CNAME flattening service.

### Provisioning an SSL/TLS Certificate with AWS Certificate Manager

Once your custom domain is resolving to your Beanstalk environment, the next step is encryption. Users increasingly expect HTTPS everywhere, and browsers now warn loudly when they encounter unencrypted connections. Beyond the user experience, HTTPS is often a compliance requirement. AWS Certificate Manager (ACM) makes it trivial to provision free SSL/TLS certificates for your domains.

When you request a certificate through ACM, you specify the domain names you want to protect. You can include multiple domains if needed—for instance, both `example.com` and `www.example.com`, or even wildcard certificates like `*.example.com` to protect all subdomains. ACM will then ask you to prove you own those domains through domain validation.

The validation process comes in two flavors: email validation and DNS validation. Email validation is simpler conceptually—AWS sends an email to specific administrative addresses for your domain (like `admin@example.com`), and you click a link to confirm ownership. However, DNS validation is more reliable for automation and integrates better with infrastructure-as-code tools. With DNS validation, ACM gives you a DNS record to add to your domain's configuration. Once you add that record and ACM can query it, your certificate is instantly validated and issued. No email clicking required, no waiting for inbox checks.

Here's the practical workflow: You navigate to the ACM console, request a new certificate, enter your domain names, select DNS validation, and then add the provided DNS records to your Route 53 hosted zone (or your external DNS provider). Within minutes, your certificate status changes to "Issued." The entire process is free—ACM doesn't charge for certificate issuance or renewal. Certificates are valid for 13 months and automatically renewed 60 days before expiration, so once you've set it up, you typically never think about it again.

One important note: ACM certificates are regional resources. If you're using Beanstalk in multiple regions and want to support each with HTTPS, you'll need to request a certificate in each region. However, if you're using CloudFront in front of your Beanstalk environment (a common pattern for global distribution), you'll request your certificate in `us-east-1` since CloudFront only works with certificates from that region.

### Configuring the Application Load Balancer for HTTPS

With your certificate provisioned, you now need to tell your Beanstalk environment's load balancer to use it. Elastic Beanstalk environments typically use an Application Load Balancer (ALB) by default, though you might encounter Classic Load Balancers in older configurations or Network Load Balancers for specific use cases.

Beanstalk provides a configuration method for adding HTTPS listeners and SSL certificates. The cleanest approach is through Beanstalk's `.ebextensions` directory, a special folder in your application source code where you can commit configuration files that Beanstalk applies during environment creation and updates.

You'll create a file like `alb-https.config` in `.ebextensions/` with YAML that specifies your listener configuration. The configuration tells Beanstalk to add an HTTPS listener on port 443, attach your ACM certificate, and optionally redirect HTTP traffic (port 80) to HTTPS. Here's what that looks like in practice:

```yaml
option_settings:
  aws:elasticbeanstalk:environment:process:default:
    HealthCheckPath: /
    HealthCheckInterval: 15
    HealthCheckTimeout: 5
    HealthyThreshold: 3
    UnhealthyThreshold: 5
  aws:elbv2:listener:443:
    Protocol: HTTPS
    SSLPolicy: ELBSecurityPolicy-TLS-1-2-2017-01
    SSLCertificateArns: arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012
  aws:elbv2:listener:80:
    Protocol: HTTP
    Rules: Host/*: http_to_https
```

Replace the certificate ARN with your actual certificate from ACM. The `SSLPolicy` parameter controls which TLS versions and cipher suites are allowed—the default is secure and sufficient for most applications. If you need to support older clients, you can loosen it, though security best practices recommend staying with modern policies.

Once you deploy this configuration, Beanstalk will update your load balancer. If you're deploying to an existing environment, this triggers an update that momentarily stops accepting new requests but doesn't restart your application instances themselves—users might see a brief connection interruption while the load balancer reconfigures, but it's typically only a few seconds.

You can verify the configuration worked by checking the load balancer in the EC2 console—you should see listeners on both port 80 and 443, with the 443 listener using your certificate. Try accessing your custom domain via HTTPS in a browser, and you should see a secure connection with no certificate warnings.

### Understanding HTTP to HTTPS Redirection

A common question: should you redirect HTTP traffic to HTTPS, or support both? The answer for production is almost always "redirect." HTTPS is now the standard, and leaving port 80 (HTTP) open but redirecting to 443 (HTTPS) ensures that users who type `example.com` or click an old HTTP link still end up in a secure connection.

Redirecting at the load balancer level is more efficient than doing it in your application code. The ALB can perform the redirect without even touching your application instances. When a user connects to port 80, the load balancer immediately responds with a 301 (permanent) or 302 (temporary) redirect to the HTTPS equivalent of that URL.

Setting up the redirect through Beanstalk configuration is straightforward—you define a listener rule that matches all HTTP traffic and redirects it to HTTPS. The browser receives the redirect response, automatically follows it, and the user sees their connection is secure. Most users won't even notice this happened; the flow is seamless.

One nuance: if you're using a subdomain like `www.example.com`, ensure your redirect rules preserve the hostname. A common mistake is a listener rule that redirects `www.example.com:80` to `example.com:443`—a different domain entirely. Your configuration should preserve the original hostname, so `www.example.com:80` redirects to `www.example.com:443`.

### Implications of Domain Changes on Traffic and Caching

Once you've deployed an application on a domain and it's been public for any length of time, changing that domain or the infrastructure it points to has ripple effects you need to understand. DNS changes, in particular, don't propagate instantaneously across the internet. Different DNS resolvers cache records with different time-to-live (TTL) values, and while most modern systems respect shorter TTLs, some clients might hold onto stale records for hours or even days.

If you're testing a domain change or migrating to a new Beanstalk environment, lower your DNS TTL well before the change—ideally days in advance. A TTL of 60 seconds means resolvers will re-query your DNS every minute, so changes propagate faster. Once your migration is complete and you're confident everything is working, you can raise it back to something reasonable like 300 seconds for better caching performance.

Browsers also cache DNS resolutions locally and cache HTTP redirects aggressively. If you previously served HTTP and redirected to a different domain, users' browsers have cached that redirect response. Even if you change the redirect, some users won't see the new behavior until their browser cache expires. You can't control browser caches from the server, so be thoughtful about domain migrations—they should be rare events.

There's also the matter of SSL/TLS session caching and connection pooling. If you're doing a blue-green deployment where you temporarily point traffic to a different environment, clients with persistent connections might fail because the new endpoint has different certificate chains or isn't yet warmed up. Load balancers handle this gracefully with proper health checks, but it's something to keep in mind.

Another consideration is the relationship between your domain and any CDN or caching layers you've put in front of Beanstalk. If you're using CloudFront, your alias records and SSL certificates should be configured for your CloudFront distribution's domain, not the Beanstalk environment directly. The cloud distribution is the user-facing endpoint; the Beanstalk environment is internal infrastructure.

### Troubleshooting Certificate Errors and Mismatches

Despite best intentions, certificate issues do happen. The most common scenario is a certificate-domain mismatch: your domain isn't in the certificate's subject alternative names list, or the domain has changed but the certificate hasn't. Users see a big security warning, and rightfully, traffic dies.

When you request an ACM certificate, be precise about which domains you need. If you own `example.com` and want to serve both `example.com` and `www.example.com`, you must explicitly add both to your certificate. A wildcard certificate `*.example.com` covers subdomains but not the bare zone apex—you'd need to include both `example.com` and `*.example.com` to cover all bases. If you later add a new subdomain like `api.example.com` and it's not covered by your existing certificate, users get an error.

ACM makes it easy to fix this: simply request a new certificate for the additional domains, wait for DNS validation to complete, and update your load balancer configuration to use the new certificate ARN. For most of these changes, you won't incur additional costs beyond what you're already paying for Beanstalk, since ACM certificates themselves are free.

Another common issue is a certificate in the wrong region. If you request a certificate in `eu-west-1` but your Beanstalk environment and ALB are in `us-east-1`, the load balancer can't find or use it. The fix is straightforward: request a new certificate in the correct region or migrate your environment.

Mixed content warnings are subtly different from certificate errors but equally frustrating for users. If your HTTPS page loads JavaScript, stylesheets, or images over HTTP, browsers block those resources and warn the user about "insecure content." If your application generates any URLs—for links, form actions, or resource references—ensure they use relative paths (no protocol specified) or explicitly use HTTPS. A misconfigured application that assumes all traffic is HTTP and constructs URLs like `http://example.com/resource` will trigger these warnings even when served over HTTPS. This is an application-level problem, not a load balancer problem, but it manifests as a security error to users.

### Best Practices for Production Deployments

For a production setup, follow these principles to avoid headaches. First, use Route 53 for DNS if you're in the AWS ecosystem—alias records just work, and they integrate smoothly with everything else. Second, request your SSL/TLS certificate well before you need it, and use DNS validation for reliability. Third, always redirect HTTP to HTTPS at the load balancer level, not in your application code—it's faster and more consistent. Fourth, double-check that your certificate covers all the domain variants you'll serve, including any subdomains or zone apex variants. Fifth, monitor your certificate's expiration date even though ACM handles renewals automatically; redundant monitoring catches edge cases.

For zero-downtime deployments where you need to change domains or environments, use Route 53 weighted routing or failover routing to gradually shift traffic. You can point partial traffic to the new endpoint while monitoring for errors, then shift completely once you're confident. This requires coordinating your Beanstalk environment creation, certificate provisioning, and DNS changes, but it ensures your users don't experience downtime.

Finally, automate everything that can be automated. Use infrastructure-as-code tools to define your Beanstalk environment, its load balancer configuration, and your Route 53 records together. When you need to recreate an environment or migrate, having everything codified means you're not manually re-creating configuration and leaving something out.

### Conclusion

Connecting a custom domain to your Elastic Beanstalk environment with HTTPS is straightforward once you understand the pieces involved. Start with Beanstalk's default domain to get your application running, then layer on a custom domain through Route 53 or your DNS provider. Provision a free SSL/TLS certificate through ACM, configure your load balancer to use it, and set up HTTP-to-HTTPS redirection. Each step is relatively simple, but taken together, they ensure your users access your application over a secure, branded domain.

The key insight is that these components—DNS, SSL/TLS certificates, and load balancer configuration—are separate concerns that come together to form a cohesive system. Understanding how they interact helps you troubleshoot issues quickly and make confident changes to your infrastructure. As your application grows, this foundation will support increasingly complex deployments, from multi-region failover to content delivery networks, all built on the secure custom domain setup you've established here.
