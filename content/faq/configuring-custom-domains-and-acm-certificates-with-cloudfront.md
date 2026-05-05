---
title: "Configuring Custom Domains and ACM Certificates with CloudFront"
---

## Configuring Custom Domains and ACM Certificates with CloudFront

When you first create a CloudFront distribution, AWS assigns it a default domain name like `d111111abcdef8.cloudfront.net`. It works perfectly fine, but it doesn't exactly inspire confidence when you're directing your users there. The moment you want visitors accessing your content via your own custom domain—say, `cdn.example.com`—you're entering the world of SSL/TLS certificates, DNS validation, and distribution configuration. This process can feel intricate at first, but once you understand the moving parts and their interactions, it becomes a straightforward workflow that you'll repeat with confidence.

This article walks you through the entire process: requesting an ACM certificate, validating it through Route 53, configuring your CloudFront distribution to recognize your custom domain, and finally, wiring it all together with DNS alias records. We'll also explore the nuances of protocol versions and SNI support, and I'll share some troubleshooting tips for the errors you might encounter along the way.

### Understanding the Prerequisites and Architecture

Before diving into configuration, let's establish what you'll need and why the architecture matters. At its core, you're building a chain of trust: your custom domain points to CloudFront via DNS, CloudFront uses an SSL/TLS certificate to encrypt traffic to visitors, and that certificate must be issued for your specific domain name.

The key architectural insight is that **ACM certificates for CloudFront distributions must always be requested in the us-east-1 region**, regardless of where your origin infrastructure or your CloudFront distribution is configured. This is a CloudFront requirement that trips up many developers on their first attempt. AWS's reasoning centers on CloudFront's global nature and how edge locations access certificates—the us-east-1 region serves as the authoritative source for certificate management in CloudFront's ecosystem.

You'll also need a domain name that you control, ideally with DNS management accessible through Route 53 (though other DNS providers work too). If your domain is registered elsewhere but you manage DNS through Route 53, that's a completely valid setup.

### Step 1: Requesting an ACM Certificate

Let's begin by requesting your certificate. Navigate to the AWS Certificate Manager in the **us-east-1 region**. This is non-negotiable—if you're in any other region, you won't see the certificate option available when you later configure CloudFront.

In the ACM console, click "Request a certificate." You'll be offered two types: a public certificate (what you need here) or a private certificate. Choose public. On the next screen, you'll enter your domain name.

Here's where you need to think about scope. If you want to secure just `cdn.example.com`, enter that exactly. If you want a wildcard certificate that covers `cdn.example.com`, `api.example.com`, and any other subdomain under `example.com`, you'd enter `*.example.com`. For maximum flexibility, you can add both—specify `cdn.example.com` as the primary domain and then add `*.example.com` as an additional name. This covers the specific domain plus all subdomains in one certificate.

You'll also want to add the root domain (in this case, `example.com`) if it doesn't already appear, depending on your requirements. Keep in mind that adding additional names doesn't increase the cost—one certificate can cover multiple domain names.

For validation method, you have two choices: email validation or DNS validation. **DNS validation is strongly preferred** for several reasons. Email validation requires action from a person who can receive emails at specific addresses associated with your domain. DNS validation is fully automatable and integrates seamlessly with Route 53. Unless you have a specific reason not to use DNS validation, go with it.

Click "Request," and you'll see your certificate listed with a status of "Pending validation."

### Step 2: Validating Your Certificate via Route 53

Your certificate is now in a holding pattern. AWS has issued it, but it hasn't been activated because you haven't proven you control the domain. This is where DNS validation comes in.

Back in the ACM console, find your pending certificate and click on it. You'll see a section showing the validation details. If you're using DNS validation, AWS has generated a CNAME record that you need to add to your domain's DNS.

The CNAME record will look something like this:

```
Name: _abc123def456.cdn.example.com
Type: CNAME
Value: _xyz789uvw012.acm-validations.aws.
```

If your domain's DNS is managed in Route 53, this becomes remarkably simple. In many cases, AWS will offer a button labeled "Create record in Route 53" directly within the ACM console. Click it, and AWS will automatically create the necessary CNAME record for you. It's one of the most delightful examples of AWS services working together seamlessly.

If your DNS is managed elsewhere (GoDaddy, Namecheap, etc.), you'll need to manually add this CNAME record through your DNS provider's control panel. The process varies by provider, but you're essentially doing the same thing: creating a CNAME that proves to AWS that you control the domain.

Once the record is in place, validation typically occurs within minutes, though it can occasionally take up to an hour. You can refresh the ACM console to check the status. When it changes to "Issued," you're good to go.

### Step 3: Configuring Your CloudFront Distribution

Now that you have a valid certificate, it's time to tell CloudFront about your custom domain. You don't necessarily need to create a new distribution for this—you can update an existing one. Open your distribution's settings and look for the "Alternate domain names (CNAMEs)" field.

This is where you specify which custom domains your distribution should recognize. Add your domain name here (e.g., `cdn.example.com`). If you created a wildcard certificate, you could add `*.example.com` here, and any subdomain would route to your distribution.

Right below the alternate domain names, you'll see the "Custom SSL/TLS certificate" dropdown. Select the ACM certificate you just validated. AWS will automatically populate this dropdown with certificates in us-east-1, so as long as you requested your certificate in the right region, it'll appear here.

#### Selecting the Minimum TLS Protocol Version

AWS offers several options for the minimum TLS protocol version: TLS 1.0, 1.1, 1.2, or 1.3. Here's the thing: **you should almost always choose TLS 1.2 at minimum, and TLS 1.3 if you're certain your visitors' browsers support it.**

TLS 1.0 and 1.1 have known vulnerabilities and are considered obsolete by modern security standards. Many regulatory frameworks (PCI-DSS, for instance) forbid their use. TLS 1.2 has been the industry standard for years and is supported by every modern browser and client. TLS 1.3 is newer, faster (fewer round trips during the handshake), and more secure, but older clients might not support it—think IE 10 or ancient mobile browsers.

For most applications in 2024, TLS 1.2 is the sweet spot. It provides solid security without abandoning legacy clients entirely. If you're building something consumer-facing where traffic from older devices is negligible, TLS 1.3 is excellent.

#### Understanding SNI vs. Dedicated IP

CloudFront offers two ways to deliver HTTPS traffic for your custom domains: Server Name Indication (SNI) and dedicated IP.

**Server Name Indication (SNI)** is the modern approach and is enabled by default. It's a TLS extension that allows multiple SSL certificates to be served from a single IP address. The client indicates which domain it's trying to reach during the TLS handshake, and the server responds with the appropriate certificate. This is efficient, cost-effective, and supported by virtually all modern browsers and clients.

**Dedicated IP** is the legacy approach. You get an exclusive IP address for your distribution, eliminating the need for SNI. It's more expensive and is really only necessary if you need to support very old clients that don't support SNI (Internet Explorer 8 and earlier, for example). In practice, you'll almost never need this.

SNI is what you should use unless you have a very specific reason otherwise. Leave the default setting in place.

### Step 4: Creating a Route 53 Alias Record

Your CloudFront distribution now knows about your custom domain, but traffic heading to `cdn.example.com` doesn't know where to go yet. That's the job of DNS.

You need to create a DNS record that points your custom domain to CloudFront's domain. Open Route 53 and find the hosted zone for your domain. Create a new record with these settings:

- **Name**: `cdn.example.com` (or whatever your custom domain is)
- **Type**: A (or AAAA if you want IPv6 support; ideally both)
- **Alias**: Yes
- **Alias target**: Select your CloudFront distribution from the dropdown

This "Alias" setting is Route 53's special sauce. Instead of pointing to a static IP address, you're creating a dynamic reference to the CloudFront distribution. If AWS ever changes CloudFront's underlying IP addresses (which they do from time to time), your DNS record automatically stays current.

If you're using a wildcard certificate (`*.example.com`), you could create a wildcard DNS record as well:

- **Name**: `*.example.com`
- **Type**: A (and AAAA)
- **Alias**: Yes
- **Alias target**: Your CloudFront distribution

This way, `api.example.com`, `images.example.com`, and any other subdomain automatically route to your distribution.

### Testing Your Configuration

After everything is in place, give DNS a moment to propagate—typically just a few seconds to a few minutes—then test your setup. The simplest test is to open your browser and navigate to your custom domain.

From the command line, you can verify DNS resolution:

```bash
nslookup cdn.example.com
```

You should see it resolve to CloudFront's domain (the `d111111abcdef8.cloudfront.net` style name). You can also test the SSL certificate directly:

```bash
openssl s_client -connect cdn.example.com:443 -servername cdn.example.com
```

This command establishes a TLS connection and shows you the certificate details. Look for your domain in the certificate's Subject Alternative Names (SAN). If you see it there, you're good.

### Troubleshooting Common SSL Errors

Even with clear instructions, things occasionally go sideways. Here are the most common issues and how to resolve them:

**Certificate not showing in CloudFront dropdown**: This almost always means the certificate was requested in the wrong region. ACM certificates for CloudFront must be in us-east-1. Double-check the region you requested the certificate in, and if necessary, request a new one in us-east-1.

**SSL_ERROR_BAD_CERT_DOMAIN or similar browser errors**: Your browser is saying the certificate doesn't match the domain you're visiting. This typically happens if the domain in the browser doesn't match what's in the certificate's SAN list, or if you haven't updated CloudFront's alternate domain names. Verify that your custom domain is listed in the distribution's alternate domain names field, and ensure the certificate covers that domain.

**Validation stuck in "Pending"**: The CNAME validation record hasn't been created or hasn't propagated. If you're using Route 53, make sure the "Create record in Route 53" button actually created the record—sometimes it requires a second click or the page needs refreshing. If using an external DNS provider, double-check that the CNAME was created correctly. Remember that DNS propagation is usually instant for Route 53 but can take up to 48 hours for other providers (though typically much faster).

**The domain resolves but certificate errors persist**: This usually means CloudFront hasn't fully deployed your distribution changes yet. Distribution updates can take a few minutes to propagate to all edge locations globally. Check the distribution's status in the CloudFront console—it should show "Deployed" (not "In Progress"). If it's still deploying, wait a few minutes and try again.

**Mixed content warnings in the browser**: If your origin is serving HTTP but CloudFront is delivering HTTPS (which it should be), the origin might be returning HTML that references HTTP resources. This isn't a CloudFront certificate issue, but rather a configuration issue with your origin or your application. Ensure all resources are referenced as HTTPS or as protocol-relative URLs (`//example.com/image.png`).

**SNI-related errors from older clients**: If you have very old clients trying to access your distribution and they're getting TLS errors, they might not support SNI. The only solution is to enable dedicated IP (which is costly) or to upgrade those clients' software/browsers. In practice, this is increasingly rare.

### Best Practices and Considerations

As you work with CloudFront and ACM, keep a few principles in mind. First, use wildcard certificates if you anticipate serving multiple subdomains. A single `*.example.com` certificate can serve unlimited subdomains, making your infrastructure more flexible without certificate management overhead.

Second, monitor your certificate expiration dates. ACM can automatically renew public certificates, and this is enabled by default for certificates created through the console. However, it's worth verifying that renewal is enabled, especially if you imported a certificate rather than requesting one directly from AWS.

Third, consider using security headers and other CloudFront features alongside your custom domain setup. CloudFront can inject HSTS headers, set Strict-Transport-Security, and add other security measures that complement your SSL/TLS certificate. These aren't required, but they harden your distribution against attacks.

Finally, remember that CloudFront distributions themselves can take a few minutes to fully deploy changes globally. After configuring a new custom domain and certificate, give it five to ten minutes before concluding something is broken. Progress bars in the AWS console move slowly by design.

### Conclusion

Configuring a custom domain for CloudFront—from requesting an ACM certificate in us-east-1, validating it through Route 53, adding alternate domain names to your distribution, and creating alias records—is a straightforward process once you understand the sequence. The most critical detail is remembering that ACM certificates for CloudFront must be in us-east-1; everything else follows logically from there.

The combination of CloudFront's global edge locations with your own custom domain creates a powerful content delivery system that's both performant and professional. Your users see a domain they recognize and trust, while your content is served from servers geographically close to them with enterprise-grade SSL/TLS encryption. With the steps outlined here, you'll have that system up and running with confidence.
